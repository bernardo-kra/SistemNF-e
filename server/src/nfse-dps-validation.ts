import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { XmlDocument, XsdValidator, XmlBufferInputProvider, xmlRegisterInputProvider, ParseOption } from "libxml2-wasm";

export const dpsSchemaId = "nfse-prodrest-20261020" as const;
const namespace = "http://www.sped.fazenda.gov.br/nfse", ns = { n: namespace };
const manifestHash = "a7c8782e7213c648d7ecf40fd97ac13e4ae9db94e1488c267008290adbf1ca8e";
const files = ["DPS_v1.01.xsd", "tiposComplexos_v1.01.xsd", "tiposSimples_v1.01.xsd", "xmldsig-core-schema.xsd"];
const parseOptions = { option: ParseOption.XML_PARSE_NO_XXE | ParseOption.XML_PARSE_NONET | ParseOption.XML_PARSE_NO_SYS_CATALOG | ParseOption.XML_PARSE_NOERROR | ParseOption.XML_PARSE_NOWARNING };
let schemas: Record<string, Buffer> | undefined;

export class NfseDpsError extends Error {
  constructor(readonly code: string, readonly field?: string) { super(code); this.name = "NfseDpsError"; }
}
export function dpsFailure(code: string, field?: string): never { throw new NfseDpsError(code, field); }

function validDocument(type: string, text: string) {
  if (typeof text !== "string" || /^(.)\1+$/.test(text)) return false;
  if (type === "CNPJ" && /^[A-Z0-9]{12}\d{2}$/.test(text)) {
    const digit = (base: string) => {
      let weight = base.length - 7;
      const sum = [...base].reduce((total, c) => { const next = total + (c.charCodeAt(0) - 48) * weight; weight = weight === 2 ? 9 : weight - 1; return next; }, 0);
      return String(sum % 11 < 2 ? 0 : 11 - sum % 11);
    };
    const base = text.slice(0, 12), first = digit(base); return text === base + first + digit(base + first);
  }
  if (type === "CPF" && /^\d{11}$/.test(text)) {
    const digit = (base: string) => { const mod = [...base].reduce((sum, c, i) => sum + Number(c) * (base.length + 1 - i), 0) * 10 % 11; return String(mod === 10 ? 0 : mod); };
    const base = text.slice(0, 9), first = digit(base); return text === base + first + digit(base + first);
  }
  return false;
}
export function requireDpsDocument(type: string, value: string) {
  if (!validDocument(type, value)) dpsFailure("INVALID_DPS_DOCUMENT");
  return value;
}
export function createDpsId(input: { municipalityCode: string; documentType: "CNPJ" | "CPF"; document: string; series: string; number: string }) {
  if (!input || typeof input.municipalityCode !== "string" || !/^\d{7}$/.test(input.municipalityCode) || !validDocument(input.documentType, input.document) || typeof input.series !== "string" || !/^[1-9]\d{0,4}$/.test(input.series) || Number(input.series) > 49999 || typeof input.number !== "string" || !/^[1-9]\d{0,14}$/.test(input.number)) dpsFailure("INVALID_DPS_IDENTIFIER");
  return `DPS${input.municipalityCode}${input.documentType === "CPF" ? "1" : "2"}${input.document.padStart(14, "0")}${input.series.padStart(5, "0")}${input.number.padStart(15, "0")}`;
}

function officialSchemas() {
  if (schemas) return schemas;
  try {
    const root = new URL("../resources/nfse/prodrest-20261020/", import.meta.url);
    const raw = readFileSync(new URL("manifest.json", root));
    if (createHash("sha256").update(raw).digest("hex") !== manifestHash) throw new Error();
    const manifest = JSON.parse(raw.toString("utf8")), data: Record<string, Buffer> = Object.create(null);
    for (const name of files) {
      const buffer = readFileSync(new URL(name, root));
      if (createHash("sha256").update(buffer).digest("hex") !== manifest.files[name]) throw new Error();
      data[name] = buffer;
    }
    const provider = new XmlBufferInputProvider(data);
    // No filesystem/network resolver. Only these immutable public schemas can be opened.
    if (!xmlRegisterInputProvider({ match: () => true, open: name => provider.open(name), read: (fd, buffer) => provider.read(fd, buffer), close: fd => provider.close(fd) })) throw new Error();
    schemas = data; return data;
  } catch { dpsFailure("DPS_SCHEMA_UNAVAILABLE"); }
}

/** Structural/identity guard for unsigned 2026 test drafts. NEVER fiscal authorization. */
export function validateUnsignedDpsXml(xml: string) {
  return validateDpsStructure(xml, false);
}
/** Structure only: callers must separately verify the signature and certificate policy. */
export function validateSignedDpsStructure(xml: string) {
  return validateDpsStructure(xml, true);
}
function validateDpsStructure(xml: string, signed: boolean) {
  if (typeof xml !== "string" || !xml.trim() || Buffer.byteLength(xml, "utf8") > (signed ? 160 : 128) * 1024 || /<!\s*(?:DOCTYPE|ENTITY)|<\?(?!xml\s)/i.test(xml) || /encoding\s*=\s*["'](?!utf-8["'])/i.test(xml)) dpsFailure("UNSAFE_DPS_XML");
  let doc: XmlDocument | undefined, schema: XmlDocument | undefined, validator: XsdValidator | undefined;
  try {
    doc = XmlDocument.fromString(xml, parseOptions);
    if (doc.find("//*[namespace-uri()='http://www.w3.org/2001/XInclude']|//@*[namespace-uri()='http://www.w3.org/2001/XMLSchema-instance']").length) dpsFailure("UNSAFE_DPS_XML");
    if (doc.eval("name(/*)") !== "DPS" || doc.eval("namespace-uri(/*)") !== namespace || doc.find("//*[contains(name(), ':')]").length) dpsFailure("INVALID_DPS_XML");
    const dsig = "http://www.w3.org/2000/09/xmldsig#";
    if (!signed && doc.find(`//*[namespace-uri()='${dsig}']`).length) dpsFailure("SIGNED_DPS_NOT_SUPPORTED");
    if (signed && doc.find(`/*/*[local-name()='Signature' and namespace-uri()='${dsig}']`).length !== 1) dpsFailure("DPS_SIGNATURE_REQUIRED");
    const value = (path: string) => doc!.get(path, ns)?.content ?? "";
    if (value("/n:DPS/@versao") !== "1.01") dpsFailure("UNSUPPORTED_DPS_SCHEMA");
    if (value("/n:DPS/n:infDPS/n:tpAmb") !== "2") dpsFailure("UNSUPPORTED_DPS_ENVIRONMENT");
    if (!value("/n:DPS/n:infDPS/n:dhEmi").startsWith("2026-") || !value("/n:DPS/n:infDPS/n:dCompet").startsWith("2026-")) dpsFailure("UNSUPPORTED_DPS_PERIOD");
    const data = officialSchemas();
    schema = XmlDocument.fromBuffer(data["DPS_v1.01.xsd"], { ...parseOptions, url: "DPS_v1.01.xsd" });
    validator = XsdValidator.fromDoc(schema); validator.validate(doc);
    const cnpj = value("/n:DPS/n:infDPS/n:prest/n:CNPJ"), cpf = value("/n:DPS/n:infDPS/n:prest/n:CPF");
    const expected = createDpsId({ municipalityCode: value("/n:DPS/n:infDPS/n:cLocEmi"), documentType: cnpj ? "CNPJ" : "CPF", document: cnpj || cpf, series: value("/n:DPS/n:infDPS/n:serie"), number: value("/n:DPS/n:infDPS/n:nDPS") });
    if (value("/n:DPS/n:infDPS/@Id") !== expected) dpsFailure("DPS_IDENTITY_MISMATCH");
    return { schemaId: dpsSchemaId, structurallyValid: true as const, readyForSubmission: false as const };
  } catch (error) { if (error instanceof NfseDpsError) throw error; dpsFailure("INVALID_DPS_XML"); }
  finally { validator?.dispose(); schema?.dispose(); doc?.dispose(); }
}
