import { createHash, timingSafeEqual, verify, X509Certificate } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { XmlDocument, XmlC14NMode } from "libxml2-wasm";
import { allowedKeys, inputRecord } from "./customers.js";
import { validateSignedDpsStructure, NfseDpsError, dpsSchemaId } from "./nfse-dps-validation.js";
import { nfseNamespace, nfseParseOptions, validateNfseSchema, NfseSchemaError } from "./nfse-xml-schema.js";
import { readRsaSha256Signature, canonicalizationOptions } from "./nfse-xml-signature.js";
import forge from "node-forge";
import { verifyNfseSignerChain, NfseSignerChainError, type NfseSignerTrustPolicy } from "./nfse-signer-chain.js";

const ns = { n: nfseNamespace, d: "http://www.w3.org/2000/09/xmldsig#" };
const maxBytes = 512 * 1024;
const c14n = { mode: XmlC14NMode.XML_C14N_EXCLUSIVE_1_0, withComments: false };
const keyPattern = /^\d{9}[A-Z0-9]{14}\d{27}$/; // infNFSe/@Id suffix, not the API's independently documented key type.
type ErrorCode = "NFSE_CANDIDATE_INVALID" | "NFSE_SOURCE_MISMATCH" | "NFSE_SCHEMA_UNAVAILABLE" | "NFSE_SIGNATURE_INVALID" | "NFSE_SIGNER_MISMATCH" | "NFSE_CERTIFICATE_CHAIN_INVALID";
export class NfseResponseError extends Error {
  constructor(readonly code: ErrorCode) { super(code); this.name = "NfseResponseError"; }
}

/** Mathematical signature check against an independently supplied public leaf certificate.
 * The caller, not KeyInfo/XML, supplies that expected signer and the time policy.
 * Matching bytes and a valid signature still do not establish government identity/trust/revocation.
 */
export function verifyNfseCandidateSignature(raw: unknown, trustPolicy?: NfseSignerTrustPolicy) {
  let received: XmlDocument | undefined, bytes: Buffer | undefined;
  try {
    const body = inputRecord(raw); allowedKeys(body, ["expectedDpsXml", "nfseXmlGZipB64", "expectedAccessKey", "expectedSignerCertificatePem", "at"]);
    const { expectedDpsXml, nfseXmlGZipB64, expectedAccessKey, expectedSignerCertificatePem, at } = body;
    if (!(at instanceof Date) || !Number.isFinite(at.getTime()) || typeof expectedSignerCertificatePem !== "string"
      || Buffer.byteLength(expectedSignerCertificatePem) > 65536 || /PRIVATE KEY/.test(expectedSignerCertificatePem)
      || !/^-----BEGIN CERTIFICATE-----\r?\n(?:[A-Za-z0-9+/=]+\r?\n)+-----END CERTIFICATE-----\r?\n?$/.test(expectedSignerCertificatePem)) fail();
    const verifiedAt = new Date(at.getTime());
    const candidate = inspectNfseCandidate({ expectedDpsXml, nfseXmlGZipB64, expectedAccessKey });
    const certificate = new X509Certificate(expectedSignerCertificatePem), bits = certificate.publicKey.asymmetricKeyDetails?.modulusLength ?? 0;
    const validFrom = Date.parse(certificate.validFrom), validTo = Date.parse(certificate.validTo);
    if (certificate.ca || certificate.publicKey.asymmetricKeyType !== "rsa" || bits < 2048 || bits > 8192
      || !Number.isFinite(validFrom) || !Number.isFinite(validTo)
      || verifiedAt.getTime() < validFrom || verifiedAt.getTime() > validTo) fail("NFSE_SIGNATURE_INVALID");
    // X509_check_ca may be false when CA:true lacks keyCertSign. Reject the declared CA constraint too.
    const parseDer = forge.asn1.fromDer as unknown as (der: string, options: { strict: boolean; parseAllBytes: boolean; decodeBitStrings: boolean; maxDepth: number }) => forge.asn1.Asn1;
    const parsedCertificate = forge.pki.certificateFromAsn1(parseDer(certificate.raw.toString("binary"), { strict: true, parseAllBytes: true, decodeBitStrings: true, maxDepth: 64 }));
    if ((parsedCertificate.getExtension("basicConstraints") as { cA?: boolean } | undefined)?.cA === true) fail("NFSE_SIGNATURE_INVALID");
    // Parse the same bounded, inspected bytes again; do not expose private documents/callbacks via inspection DTOs.
    bytes = decompress(nfseXmlGZipB64);
    received = XmlDocument.fromString(new TextDecoder("utf-8", { fatal: true }).decode(bytes), nfseParseOptions);
    const signature = received.get("/n:NFSe/d:Signature", ns), reference = received.get("/n:NFSe/n:infNFSe", ns);
    if (!signature || !reference) fail("NFSE_SIGNATURE_INVALID");
    const signed = readRsaSha256Signature(signature, "NFS" + candidate.candidateAccessKey);
    if (!certificate.raw.equals(signed.certificate)) fail("NFSE_SIGNER_MISMATCH");
    // The outer signature is a sibling of infNFSe. Its digest includes the embedded DPS signature.
    const digest = createHash("sha256").update(reference.canonicalizeToString(canonicalizationOptions)).digest();
    if (signed.digest.length !== digest.length || !timingSafeEqual(signed.digest, digest)
      || !verify("RSA-SHA256", Buffer.from(signed.info.canonicalizeToString(canonicalizationOptions)), certificate.publicKey, signed.signature)) fail("NFSE_SIGNATURE_INVALID");
    const chain = trustPolicy === undefined ? null : verifyNfseSignerChain(certificate, trustPolicy, verifiedAt);
    return { ...candidate, ...chain, state: "candidate_signature_verified" as const, signatureVerified: true as const, trustChainVerified: chain !== null,
      certificateMatched: true as const, signerFingerprint256: createHash("sha256").update(certificate.raw).digest("hex"),
      verifiedAt: verifiedAt.toISOString(), officialProfileConfirmed: false as const, revocationChecked: false as const };
  } catch (error) {
    if (error instanceof NfseResponseError) throw error;
    if (error instanceof NfseSignerChainError) fail("NFSE_CERTIFICATE_CHAIN_INVALID");
    fail("NFSE_SIGNATURE_INVALID");
  } finally { received?.dispose(); bytes?.fill(0); }
}
function fail(code: ErrorCode = "NFSE_CANDIDATE_INVALID"): never { throw new NfseResponseError(code); }

function decompress(raw: unknown) {
  if (typeof raw !== "string" || !raw.length || raw.length > maxBytes || raw.length % 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw)) fail();
  const compressed = Buffer.from(raw, "base64");
  if (compressed.toString("base64") !== raw || compressed[0] !== 0x1f || compressed[1] !== 0x8b || compressed[2] !== 8) fail();
  return gunzipSync(compressed, { maxOutputLength: maxBytes });
}

/** Internal candidate inspection only. Expected bytes must come from the persisted signed artifact.
 * XSD/correlation are not cryptographic verification, government authenticity or fiscal authorization.
 * No transport, database, custody or document writes. Never return private XML or native errors.
 */
export function inspectNfseCandidate(raw: unknown) {
  let received: XmlDocument | undefined, expected: XmlDocument | undefined, bytes: Buffer | undefined;
  try {
    const body = inputRecord(raw); allowedKeys(body, ["expectedDpsXml", "nfseXmlGZipB64", "expectedAccessKey"]);
    if (typeof body.expectedDpsXml !== "string" || (body.expectedAccessKey !== undefined
      && (typeof body.expectedAccessKey !== "string" || !keyPattern.test(body.expectedAccessKey)))) fail();
    validateSignedDpsStructure(body.expectedDpsXml);
    expected = XmlDocument.fromString(body.expectedDpsXml, nfseParseOptions);
    bytes = decompress(body.nfseXmlGZipB64);
    const xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!xml.trim() || /<!\s*(?:DOCTYPE|ENTITY)|<\?(?!xml\s)/i.test(xml) || /encoding\s*=\s*["'](?!utf-8["'])/i.test(xml)) fail();
    received = XmlDocument.fromString(xml, nfseParseOptions);
    if (received.eval("local-name(/*)") !== "NFSe" || received.eval("namespace-uri(/*)") !== nfseNamespace
      || received.find("//*[namespace-uri()='http://www.w3.org/2001/XInclude']|//@*[namespace-uri()='http://www.w3.org/2001/XMLSchema-instance']").length) fail();
    const value = (path: string) => received!.get(path, ns)?.content ?? "";
    if (value("/n:NFSe/@versao") !== "1.01") fail();
    validateNfseSchema(received, "NFSe_v1.01.xsd");
    const outerId = value("/n:NFSe/n:infNFSe/@Id"), key = outerId.slice(3);
    if (!keyPattern.test(key)) fail();
    const embedded = received.get("/n:NFSe/n:infNFSe/n:DPS", ns), source = expected.get("/n:DPS", ns);
    if (!embedded || !source) fail();
    const ids = received.find("//@*[local-name()='Id' or local-name()='ID' or local-name()='id']").map(attribute => attribute.content);
    if (new Set(ids).size !== ids.length || received.find("//d:Signature", ns).length !== 2
      || received.find("/n:NFSe/d:Signature", ns).length !== 1
      || received.find("/n:NFSe/n:infNFSe/n:DPS/d:Signature", ns).length !== 1
      || received.find("//d:Object|//d:RetrievalMethod", ns).length || received.find("//d:Reference", ns).length !== 2) fail();
    const dpsId = value("/n:NFSe/n:infNFSe/n:DPS/n:infDPS/@Id");
    if (value("/n:NFSe/d:Signature/d:SignedInfo/d:Reference/@URI") !== "#" + outerId
      || value("/n:NFSe/n:infNFSe/n:DPS/d:Signature/d:SignedInfo/d:Reference/@URI") !== "#" + dpsId) fail();
    if (embedded.canonicalizeToString(c14n) !== source.canonicalizeToString(c14n)) fail("NFSE_SOURCE_MISMATCH");
    const issuer = expected.get("/n:DPS/n:infDPS/n:prest/n:CNPJ", ns)?.content || expected.get("/n:DPS/n:infDPS/n:prest/n:CPF", ns)?.content;
    if (!issuer || (value("/n:NFSe/n:infNFSe/n:emit/n:CNPJ") || value("/n:NFSe/n:infNFSe/n:emit/n:CPF")) !== issuer
      || (body.expectedAccessKey !== undefined && body.expectedAccessKey !== key)) fail("NFSE_SOURCE_MISMATCH");
    return {
      state: "candidate_correlated" as const, schemaId: dpsSchemaId, environment: "production-restricted" as const,
      dpsId, candidateAccessKey: key, candidateNumber: value("/n:NFSe/n:infNFSe/n:nNFSe"),
      xmlSha256: createHash("sha256").update(bytes).digest("hex"), structurallyValid: true as const, sourceMatches: true as const,
      signatureVerified: false as const, trustChainVerified: false as const, contractConfirmed: false as const,
      officialAuthorization: false as const, readyForSubmission: false as const,
    };
  } catch (error) {
    if (error instanceof NfseResponseError) throw error;
    if (error instanceof NfseSchemaError || (error instanceof NfseDpsError && error.code === "DPS_SCHEMA_UNAVAILABLE")) fail("NFSE_SCHEMA_UNAVAILABLE");
    fail();
  } finally { received?.dispose(); expected?.dispose(); bytes?.fill(0); }
}
