import { XmlC14NMode, type XmlNode } from "libxml2-wasm";

// Closed processing profile shared by DPS and response checks. Not a declaration of SEFIN policy.
export const signatureNamespace = "http://www.w3.org/2000/09/xmldsig#";
export const canonicalizationAlgorithm = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
export const signatureAlgorithm = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
export const digestAlgorithm = "http://www.w3.org/2001/04/xmlenc#sha256";
export const envelopedTransform = signatureNamespace + "enveloped-signature";
export const canonicalizationOptions = Object.freeze({ mode: XmlC14NMode.XML_C14N_1_0, withComments: false });
const ns = { d: signatureNamespace };

export class NfseXmlSignatureError extends Error {
  constructor(readonly code: string) { super(code); this.name = "NfseXmlSignatureError"; }
}
function fail(code: string): never { throw new NfseXmlSignatureError(code); }
function decodeBase64(text: string, max: number) {
  if (!text || text.length > max || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) fail("INVALID_DPS_SIGNATURE");
  const bytes = Buffer.from(text, "base64");
  if (bytes.toString("base64") !== text) fail("INVALID_DPS_SIGNATURE");
  return bytes;
}

/** Shape only: returned KeyInfo certificate is untrusted until matched against an expected certificate.
 * Callers select the exact signature/reference nodes and independently verify digest/signature/policy.
 * No arbitrary algorithms, transforms, references or resource resolution are executed here.
 */
export function readRsaSha256Signature(sig: XmlNode, id: string) {
  const allowed: Record<string, string[]> = {
    Signature: [], SignedInfo: [], CanonicalizationMethod: ["Algorithm"], SignatureMethod: ["Algorithm"], Reference: ["URI"], Transforms: [], Transform: ["Algorithm"], DigestMethod: ["Algorithm"], DigestValue: [], SignatureValue: [], KeyInfo: [], X509Data: [], X509Certificate: [],
  };
  for (const node of [sig, ...sig.find(".//*")]) {
    const name = String(node.eval("local-name(.)")), attrs = allowed[name];
    if (String(node.eval("namespace-uri(.)")) !== signatureNamespace || !attrs) fail("INVALID_SIGNATURE_PROFILE");
    if (!["Signature", "SignedInfo", "Reference", "Transforms", "KeyInfo", "X509Data"].includes(name) && node.find("*").length) fail("INVALID_SIGNATURE_PROFILE");
    for (const attr of node.find("@*"))
      if (String(attr.eval("namespace-uri(.)")) !== "" || !attrs.includes(String(attr.eval("local-name(.)")))) fail("INVALID_SIGNATURE_PROFILE");
  }
  const one = (path: string) => {
    const nodes = sig.find(path, ns); if (nodes.length !== 1) fail("INVALID_SIGNATURE_PROFILE"); return nodes[0];
  };
  const info = one("d:SignedInfo"), ref = one("d:SignedInfo/d:Reference");
  if (ref.get("@URI")?.content !== "#" + id || sig.find(".//d:Reference", ns).length !== 1) fail("INVALID_SIGNATURE_REFERENCE");
  if (one("d:SignedInfo/d:CanonicalizationMethod").get("@Algorithm")?.content !== canonicalizationAlgorithm
    || one("d:SignedInfo/d:SignatureMethod").get("@Algorithm")?.content !== signatureAlgorithm
    || one("d:SignedInfo/d:Reference/d:DigestMethod").get("@Algorithm")?.content !== digestAlgorithm) fail("INVALID_SIGNATURE_ALGORITHM");
  const transforms = ref.find("d:Transforms/d:Transform", ns);
  if (transforms.length !== 2 || transforms[0].get("@Algorithm")?.content !== envelopedTransform || transforms[1].get("@Algorithm")?.content !== canonicalizationAlgorithm) fail("INVALID_SIGNATURE_TRANSFORMS");
  for (const path of ["d:SignedInfo/d:CanonicalizationMethod", "d:SignedInfo/d:SignatureMethod", "d:SignedInfo/d:Reference/d:DigestMethod", "d:SignedInfo/d:Reference/d:Transforms"])
    if (one(path).content.trim()) fail("INVALID_SIGNATURE_PROFILE");
  return { info, digest: decodeBase64(one("d:SignedInfo/d:Reference/d:DigestValue").content, 64),
    signature: decodeBase64(one("d:SignatureValue").content, 16384), certificate: decodeBase64(one("d:KeyInfo/d:X509Data/d:X509Certificate").content, 65536) };
}
