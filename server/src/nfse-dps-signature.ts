import { createHash, createPrivateKey, sign, timingSafeEqual, verify, X509Certificate } from "node:crypto";
import forge from "node-forge";
import { XmlDocument, ParseOption } from "libxml2-wasm";
import { NfseDpsError, requireDpsDocument, validateSignedDpsStructure, validateUnsignedDpsXml } from "./nfse-dps-validation.js";
import { readRsaSha256Signature, NfseXmlSignatureError, signatureNamespace, canonicalizationAlgorithm, signatureAlgorithm, digestAlgorithm, envelopedTransform, canonicalizationOptions } from "./nfse-xml-signature.js";
// Local cryptographic experiment. This profile is NOT confirmed by SEFIN and has no sender.
export const experimentalSignatureProfile = "experimental-rsa-sha256-c14n-v1" as const;
const nfseNamespace = "http://www.sped.fazenda.gov.br/nfse";
const namespaces = { n: nfseNamespace, d: signatureNamespace };
const xmlParseOptions = { option: ParseOption.XML_PARSE_NO_XXE | ParseOption.XML_PARSE_NONET | ParseOption.XML_PARSE_NO_SYS_CATALOG | ParseOption.XML_PARSE_NOERROR | ParseOption.XML_PARSE_NOWARNING };
type Common = {
  xml: string;
  issuerCnpj: string;
  at: Date;
  profile: string;
};
type SignInput = Common & {
  credentials: {
    pfx: Buffer;
    passphrase: string;
  };
};
type VerifyInput = Common & {
  certificatePem: string;
};
type InspectionInput = Omit<SignInput, "xml" | "profile">;
export class NfseDpsSignatureError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "NfseDpsSignatureError";
  }
}
function fail(code: string): never {
  throw new NfseDpsSignatureError(code);
}
function controlled<T>(run: () => T): T {
  try {
    return run();
  }
  catch (error) {
    if (error instanceof NfseDpsSignatureError)
      throw error;
    if (error instanceof NfseDpsError || error instanceof NfseXmlSignatureError)
      fail(error.code);
    fail("INVALID_DPS_SIGNATURE");
  }
}
function validateCommonInput(input: Common, keys: string[]) {
  if (!input || typeof input !== "object" || Object.keys(input).some(key => !keys.includes(key)) || input.profile !== experimentalSignatureProfile)
    fail("UNSUPPORTED_SIGNATURE_PROFILE");
  if (!(input.at instanceof Date) || !Number.isFinite(input.at.getTime()))
    fail("INVALID_SIGNATURE_TIME");
  requireDpsDocument("CNPJ", input.issuerCnpj);
}
function parseDps(xml: string, signed: boolean) {
  if (typeof xml !== "string" || !xml.trim() || Buffer.byteLength(xml) > 160 * 1024 || /<!\s*(?:DOCTYPE|ENTITY)|<\?(?!xml\s)/i.test(xml))
    fail("UNSAFE_DPS_XML");
  const doc = XmlDocument.fromString(xml, xmlParseOptions);
  try {
    if (doc.find("//comment()|//processing-instruction()").length)
      fail("UNSAFE_DPS_XML");
    if (signed)
      validateSignedDpsStructure(xml);
    else
      validateUnsignedDpsXml(xml);
    const ids = doc.find("//@*[translate(local-name(),'ID','id')='id']");
    const id = doc.get("/n:DPS/n:infDPS/@Id", namespaces);
    if (ids.length !== 1 || !id || !ids[0].isSameNode(id))
      fail("UNSAFE_DPS_IDENTIFIER");
    return doc;
  }
  catch (error) {
    doc.dispose();
    throw error;
  }
}
function requireIssuerIdentity(doc: XmlDocument, cnpj: string) {
  if (doc.get("/n:DPS/n:infDPS/n:prest/n:CNPJ", namespaces)?.content !== cnpj)
    fail("DPS_SIGNER_IDENTITY_MISMATCH");
  return doc.get("/n:DPS/n:infDPS/@Id", namespaces)!.content;
}
function fromDer(bytes: string) {
  // Per-call limit: never change forge's global recursion configuration.
  const reader = forge.asn1.fromDer as unknown as (bytes: string, options: {
    strict: boolean;
    parseAllBytes: boolean;
    decodeBitStrings: boolean;
    maxDepth: number;
  }) => forge.asn1.Asn1;
  return reader(bytes, {
    strict: true, parseAllBytes: true, decodeBitStrings: true, maxDepth: 64
  });
}
function children(node: forge.asn1.Asn1): forge.asn1.Asn1[] {
  return Array.isArray(node.value) ? node.value : [];
}
function oid(node: forge.asn1.Asn1 | undefined) {
  return node?.tagClass === forge.asn1.Class.UNIVERSAL && node.type === forge.asn1.Type.OID && typeof node.value === "string" ? forge.asn1.derToOid(node.value) : "";
}
function requireBoundedIterations(node: forge.asn1.Asn1) {
  if (node.tagClass !== forge.asn1.Class.UNIVERSAL || node.type !== forge.asn1.Type.INTEGER || node.constructed || typeof node.value !== "string" || !node.value.length || node.value.length > 4 || (node.value.charCodeAt(0) & 0x80) !== 0)
    fail("PFX_WORK_LIMIT_EXCEEDED");
  let value = 0;
  for (const c of node.value)
    value = value * 256 + c.charCodeAt(0);
  if (value < 1 || value > 100000)
    fail("PFX_WORK_LIMIT_EXCEEDED");
}
function pfxWorkGuard(root: forge.asn1.Asn1) {
  // MAC and visible PBKDF/PBE parameters are checked before password derivation.
  const mac = children(root)[2];
  if (mac && children(mac)[2])
    requireBoundedIterations(children(mac)[2]);
  let count = 0;
  function visit(node: forge.asn1.Asn1, depth: number) {
    if (++count > 20000 || depth > 64)
      fail("PFX_WORK_LIMIT_EXCEEDED");
    const nodes = children(node);
    const algorithm = oid(nodes[0]);
    if (algorithm === "1.2.840.113549.1.5.12" || algorithm.startsWith("1.2.840.113549.1.12.1.")) {
      const iteration = children(nodes[1])[1];
      if (!iteration)
        fail("INVALID_SIGNING_CERTIFICATE");
      requireBoundedIterations(iteration);
    }
    for (const child of nodes)
      visit(child, depth + 1);
    if (node.tagClass === forge.asn1.Class.UNIVERSAL && node.type === forge.asn1.Type.OCTETSTRING && typeof node.value === "string" && node.value.charCodeAt(0) === 0x30) {
      let inner: forge.asn1.Asn1;
      try {
        inner = fromDer(node.value);
      }
      catch {
        return;
      }
      visit(inner, depth + 1);
    }
  }
  visit(root, 0);
}
function certificateIdentity(parsed: forge.pki.Certificate) {
  const extension = parsed.getExtension("subjectAltName") as {
    value?: string;
  } | undefined;
  if (!extension?.value)
    fail("CERTIFICATE_IDENTITY_REQUIRED");
  const matches: string[] = [];
  for (const name of children(fromDer(extension.value))) {
    if (name.tagClass !== forge.asn1.Class.CONTEXT_SPECIFIC || name.type !== 0)
      continue;
    const nodes = children(name);
    if (oid(nodes[0]) !== "2.16.76.1.3.3")
      continue;
    const wrapped = nodes[1];
    const values = wrapped && children(wrapped);
    const value = values?.[0];
    if (nodes.length !== 2 || wrapped.tagClass !== forge.asn1.Class.CONTEXT_SPECIFIC || wrapped.type !== 0 || !values || values.length !== 1 || !value || value.tagClass !== forge.asn1.Class.UNIVERSAL || ![forge.asn1.Type.UTF8, forge.asn1.Type.PRINTABLESTRING, forge.asn1.Type.IA5STRING, forge.asn1.Type.OCTETSTRING].includes(value.type) || typeof value.value !== "string")
      fail("INVALID_CERTIFICATE_IDENTITY");
    matches.push(value.value);
  }
  if (matches.length !== 1)
    fail("CERTIFICATE_IDENTITY_REQUIRED");
  return requireDpsDocument("CNPJ", matches[0]);
}
function validateCertificate(certificatePem: string, cnpj: string, at: Date) {
  if (typeof certificatePem !== "string" || Buffer.byteLength(certificatePem) > 65536 || (certificatePem.match(/-----BEGIN CERTIFICATE-----/g) ?? []).length !== 1 || /PRIVATE KEY/.test(certificatePem))
    fail("INVALID_SIGNING_CERTIFICATE");
  const cert = new X509Certificate(certificatePem);
  const bits = cert.publicKey.asymmetricKeyDetails?.modulusLength ?? 0;
  if (cert.publicKey.asymmetricKeyType !== "rsa" || bits < 2048 || bits > 8192)
    fail("UNSUPPORTED_SIGNING_KEY");
  const validFrom = Date.parse(cert.validFrom), validTo = Date.parse(cert.validTo);
  if (!Number.isFinite(validFrom) || !Number.isFinite(validTo) || at.getTime() < validFrom || at.getTime() > validTo)
    fail("CERTIFICATE_NOT_VALID_AT_TIME");
  const parsed = forge.pki.certificateFromAsn1(fromDer(cert.raw.toString("binary")));
  const constraints = parsed.getExtension("basicConstraints") as {
    cA?: boolean;
  } | undefined;
  const usage = parsed.getExtension("keyUsage") as {
    digitalSignature?: boolean;
    nonRepudiation?: boolean;
  } | undefined;
  if (parsed.version !== 2 || cert.ca || constraints?.cA === true || !usage?.digitalSignature || !usage.nonRepudiation)
    fail("INVALID_CERTIFICATE_USAGE");
  if (certificateIdentity(parsed) !== cnpj)
    fail("CERTIFICATE_IDENTITY_MISMATCH");
  return cert;
}
function readSigningMaterial(credentials: SignInput["credentials"]) {
  if (!credentials || !Buffer.isBuffer(credentials.pfx) || !credentials.pfx.length)
    fail("CERTIFICATE_REQUIRED");
  if (credentials.pfx.length > 1024 * 1024 || typeof credentials.passphrase !== "string" || credentials.passphrase.length > 1024 || Object.keys(credentials).some(key => !["pfx", "passphrase"].includes(key)))
    fail("INVALID_SIGNING_CERTIFICATE");
  const copy = Buffer.from(credentials.pfx);
  let pem: Buffer | undefined;
  try {
    const asn1 = fromDer(copy.toString("binary"));
    pfxWorkGuard(asn1);
    const pfx = forge.pkcs12.pkcs12FromAsn1(asn1, true, credentials.passphrase);
    const bags = (type: string) => pfx.getBags({ bagType: type })[type] ?? [];
    const keys = [...bags(forge.pki.oids.pkcs8ShroudedKeyBag), ...bags(forge.pki.oids.keyBag)];
    if (keys.length !== 1 || !keys[0].key)
      fail("INVALID_SIGNING_CERTIFICATE");
    pem = Buffer.from(forge.pki.privateKeyToPem(keys[0].key));
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048)
      fail("UNSUPPORTED_SIGNING_KEY");
    const candidates = bags(forge.pki.oids.certBag).filter(bag => bag.cert).map(bag => forge.pki.certificateToPem(bag.cert!)).filter(value => new X509Certificate(value).checkPrivateKey(key));
    if (candidates.length !== 1)
      fail(candidates.length ? "AMBIGUOUS_SIGNING_CERTIFICATE" : "CERTIFICATE_KEY_MISMATCH");
    return { key, certificatePem: candidates[0] };
  }
  finally {
    copy.fill(0);
    pem?.fill(0);
  }
}
function offlineSignatureStatus(id: string) {
  return {
    id, profile: experimentalSignatureProfile, environment: "production-restricted" as const, structurallyValid: true as const, cryptographicSignatureValid: true as const, officialProfileConfirmed: false as const, trustChainVerified: false as const, revocationChecked: false as const, readyForSubmission: false as const,
    pendingChecks: ["OFFICIAL_SIGNATURE_PROFILE_UNCONFIRMED", "ICP_BRASIL_CHAIN_UNVERIFIED", "CERTIFICATE_REVOCATION_UNVERIFIED", "CERTIFICATE_CUSTODY_AND_ISOLATION_REQUIRED", "NUMBER_RESERVATION_AND_SOURCE_UNVERIFIED", "MUNICIPAL_AND_TAXPAYER_DATA_UNVERIFIED", "SERVICE_CLASSIFICATION_UNVERIFIED", "RTC_RULES_UNVERIFIED"]
  };
}
/** Internal offline experiment with trusted/pre-controlled PFX only. No upload/HTTP handler.
 * Visible KDF parameters are bounded; encrypted nested parameters are NOT fully bounded.
 * Use signDpsIsolated for interruptible execution; this primitive stays synchronous.
 * Neither entrypoint supplies public uploads, certificate custody or a sandbox.
 * Only public bundled schemas are read through the validator; no credential filesystem
 * access/writes, database, network or certificate custody. Buffer cleanup is best-effort;
 * forge and JS immutable strings/KeyObjects cannot guarantee erasure of every key copy.
 */
/** Certificate inspection only: no fabricated XML, signature or trust-chain claim. */
export function inspectA1Offline(input: InspectionInput) {
  return controlled(() => {
    if (!input || typeof input !== "object" || Object.keys(input).some(key => !["credentials", "issuerCnpj", "at"].includes(key))) fail("INVALID_CERTIFICATE_INPUT");
    if (!(input.at instanceof Date) || !Number.isFinite(input.at.getTime())) fail("INVALID_SIGNATURE_TIME");
    requireDpsDocument("CNPJ", input.issuerCnpj);
    const material = readSigningMaterial(input.credentials);
    const cert = validateCertificate(material.certificatePem, input.issuerCnpj, input.at);
    return {
      issuerCnpj: input.issuerCnpj,
      certificateFingerprint256: createHash("sha256").update(cert.raw).digest("hex"),
      validFrom: new Date(cert.validFrom).toISOString(),
      validTo: new Date(cert.validTo).toISOString(),
      keyBits: cert.publicKey.asymmetricKeyDetails!.modulusLength!,
      readyForSubmission: false as const,
      officialProfileConfirmed: false as const,
      trustChainVerified: false as const,
      revocationChecked: false as const,
    };
  });
}

export function signDpsOffline(input: SignInput) {
  return controlled(() => {
    validateCommonInput(input, ["xml", "credentials", "issuerCnpj", "at", "profile"]);
    const doc = parseDps(input.xml, false);
    try {
      const id = requireIssuerIdentity(doc, input.issuerCnpj);
      const keys = readSigningMaterial(input.credentials);
      const cert = validateCertificate(keys.certificatePem, input.issuerCnpj, input.at);
      if (!cert.checkPrivateKey(keys.key))
        fail("CERTIFICATE_KEY_MISMATCH");
      const digest = createHash("sha256").update(doc.get("/n:DPS/n:infDPS", namespaces)!.canonicalizeToString(canonicalizationOptions)).digest("base64");
      const block = `<Signature xmlns="${signatureNamespace}"><SignedInfo><CanonicalizationMethod Algorithm="${canonicalizationAlgorithm}"/><SignatureMethod Algorithm="${signatureAlgorithm}"/><Reference URI="#${id}"><Transforms><Transform Algorithm="${envelopedTransform}"/><Transform Algorithm="${canonicalizationAlgorithm}"/></Transforms><DigestMethod Algorithm="${digestAlgorithm}"/><DigestValue>${digest}</DigestValue></Reference></SignedInfo><SignatureValue>AA==</SignatureValue><KeyInfo><X509Data><X509Certificate>${cert.raw.toString("base64")}</X509Certificate></X509Data></KeyInfo></Signature>`;
      const end = input.xml.lastIndexOf("</DPS>");
      if (end < 0)
        fail("INVALID_DPS_XML");
      const placeholder = input.xml.slice(0, end) + block + input.xml.slice(end);
      const signingDoc = XmlDocument.fromString(placeholder, xmlParseOptions);
      let signature: string;
      try {
        signature = sign("RSA-SHA256", Buffer.from(signingDoc.get("/n:DPS/d:Signature/d:SignedInfo", namespaces)!.canonicalizeToString(canonicalizationOptions)), keys.key).toString("base64");
      }
      finally {
        signingDoc.dispose();
      }
      const xml = placeholder.replace("<SignatureValue>AA==</SignatureValue>", `<SignatureValue>${signature}</SignatureValue>`);
      const verified = verifyDpsOffline({
        xml, certificatePem: keys.certificatePem, issuerCnpj: input.issuerCnpj, at: input.at, profile: input.profile
      });
      return { ...verified, state: "signed_offline" as const, xml };
    }
    finally {
      doc.dispose();
    }
  });
}
export function verifyDpsOffline(input: VerifyInput) {
  return controlled(() => {
    validateCommonInput(input, ["xml", "certificatePem", "issuerCnpj", "at", "profile"]);
    const doc = parseDps(input.xml, true);
    try {
      const id = requireIssuerIdentity(doc, input.issuerCnpj);
      const signature = doc.get("/n:DPS/d:Signature", namespaces);
      if (!signature) fail("DPS_SIGNATURE_REQUIRED");
      const signed = readRsaSha256Signature(signature, id);
      const cert = validateCertificate(input.certificatePem, input.issuerCnpj, input.at);
      if (!cert.raw.equals(signed.certificate))
        fail("SIGNER_CERTIFICATE_MISMATCH");
      const verifiedInfDpsXml = doc.get("/n:DPS/n:infDPS", namespaces)!.canonicalizeToString(canonicalizationOptions);
      const digest = createHash("sha256").update(verifiedInfDpsXml).digest();
      if (signed.digest.length !== digest.length || !timingSafeEqual(signed.digest, digest))
        fail("DPS_DIGEST_MISMATCH");
      if (!verify("RSA-SHA256", Buffer.from(signed.info.canonicalizeToString(canonicalizationOptions)), cert.publicKey, signed.signature))
        fail("DPS_SIGNATURE_MISMATCH");
      return { ...offlineSignatureStatus(id), verifiedInfDpsXml, certificateFingerprint256: createHash("sha256").update(cert.raw).digest("hex") };
    }
    finally {
      doc.dispose();
    }
  });
}
