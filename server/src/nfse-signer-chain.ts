import { createHash, X509Certificate } from "node:crypto";
import forge from "node-forge";
import { allowedKeys, inputRecord } from "./customers.js";

/** Server-selected public trust context. Never populate from an emission body or XML KeyInfo. */
export type NfseSignerTrustPolicy = {
  rootCertificatePem: string;
  intermediateCertificatesPem: readonly string[];
};
export class NfseSignerChainError extends Error {
  constructor() { super("NFSE_CERTIFICATE_CHAIN_INVALID"); this.name = "NfseSignerChainError"; }
}
function fail(): never { throw new NfseSignerChainError(); }
const signatureOids = new Set(["1.2.840.113549.1.1.11", "1.2.840.113549.1.1.12", "1.2.840.113549.1.1.13"]);
const unsupportedConstraints = new Set(["2.5.29.30", "2.5.29.33", "2.5.29.36", "2.5.29.54"]);
const supportedCritical = new Set(["2.5.29.15", "2.5.29.19"]);
const pemPattern = /^-----BEGIN CERTIFICATE-----\r?\n(?:[A-Za-z0-9+/=]+\r?\n)+-----END CERTIFICATE-----\r?\n?$/;

function readCertificate(raw: string | X509Certificate, at: Date) {
  if (typeof raw === "string" && (Buffer.byteLength(raw) > 65536 || !pemPattern.test(raw))) fail();
  const certificate = typeof raw === "string" ? new X509Certificate(raw) : raw;
  if (!(certificate instanceof X509Certificate) || certificate.raw.length > 65536) fail();
  const bits = certificate.publicKey.asymmetricKeyDetails?.modulusLength ?? 0;
  const from = Date.parse(certificate.validFrom), to = Date.parse(certificate.validTo);
  if (certificate.publicKey.asymmetricKeyType !== "rsa" || bits < 2048 || bits > 8192 || !Number.isFinite(from) || !Number.isFinite(to) || at.getTime() < from || at.getTime() > to) fail();
  const parseDer = forge.asn1.fromDer as unknown as (der: string, options: { strict: boolean; parseAllBytes: boolean; decodeBitStrings: boolean; maxDepth: number }) => forge.asn1.Asn1;
  const parsed = forge.pki.certificateFromAsn1(parseDer(certificate.raw.toString("binary"), { strict: true, parseAllBytes: true, decodeBitStrings: true, maxDepth: 64 }));
  if (parsed.version !== 2 || !signatureOids.has(parsed.signatureOid)) fail();
  const extensionIds = parsed.extensions.map(extension => extension.id);
  if (new Set(extensionIds).size !== extensionIds.length) fail();
  for (const extension of parsed.extensions)
    if (unsupportedConstraints.has(extension.id) || (extension.critical && !supportedCritical.has(extension.id))) fail();
  return { certificate, parsed, fingerprint: createHash("sha256").update(certificate.raw).digest("hex") };
}

/** Closed linear path to one explicit anchor; no discovery, system roots, callbacks or network.
 * Forge's unsupported name/policy constraints are rejected before basic path validation.
 * Success does not check revocation, institution identity or the fiscal protocol/profile.
 */
export function verifyNfseSignerChain(leaf: X509Certificate, rawPolicy: unknown, at: Date) {
  try {
    if (!(at instanceof Date) || !Number.isFinite(at.getTime())) fail();
    const policy = inputRecord(rawPolicy); allowedKeys(policy, ["rootCertificatePem", "intermediateCertificatesPem"]);
    const rootPem = policy.rootCertificatePem, intermediates = policy.intermediateCertificatesPem;
    if (typeof rootPem !== "string" || !Array.isArray(intermediates) || intermediates.length > 4 || intermediates.some(value => typeof value !== "string")) fail();
    const path = [readCertificate(leaf, at), ...intermediates.map(value => readCertificate(value, at)), readCertificate(rootPem, at)];
    if (new Set(path.map(value => value.fingerprint)).size !== path.length) fail();
    for (const [depth, value] of path.entries()) {
      const constraints = value.parsed.extensions.find(extension => extension.id === "2.5.29.19") as { cA?: boolean } | undefined;
      const usage = value.parsed.getExtension("keyUsage") as { digitalSignature?: boolean; keyCertSign?: boolean } | null;
      if (depth === 0 ? constraints?.cA === true || value.certificate.ca || !usage?.digitalSignature : constraints?.cA !== true || !usage?.keyCertSign) fail();
      if (depth > 0 && depth < path.length - 1 && value.parsed.isIssuer(value.parsed)) fail();
      if (depth < path.length - 1) {
        const parent = path[depth + 1];
        if (!value.parsed.isIssuer(parent.parsed) || !value.certificate.verify(parent.certificate.publicKey)) fail();
      }
    }
    const root = path[path.length - 1];
    if (!root.parsed.isIssuer(root.parsed) || !root.certificate.verify(root.certificate.publicKey)) fail();
    const store = forge.pki.createCaStore([root.parsed]);
    if (forge.pki.verifyCertificateChain(store, path.map(value => value.parsed), { validityCheckDate: new Date(at.getTime()) }) !== true) fail();
    return { trustAnchorFingerprint256: root.fingerprint, chainLength: path.length };
  } catch { throw new NfseSignerChainError(); }
}
