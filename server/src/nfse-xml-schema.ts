import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { XmlDocument, XsdValidator, XmlBufferInputProvider, xmlRegisterInputProvider, ParseOption } from "libxml2-wasm";

export const nfseNamespace = "http://www.sped.fazenda.gov.br/nfse";
export const nfseParseOptions = Object.freeze({ option: ParseOption.XML_PARSE_NO_XXE | ParseOption.XML_PARSE_NONET | ParseOption.XML_PARSE_NO_SYS_CATALOG | ParseOption.XML_PARSE_NOERROR | ParseOption.XML_PARSE_NOWARNING });
const manifestHash = "f0d9064dac5fcb7a6aca80eaa7810aaf24799e53c9d378fb4508172dd8d287bc";
const files = ["DPS_v1.01.xsd", "NFSe_v1.01.xsd", "tiposComplexos_v1.01.xsd", "tiposSimples_v1.01.xsd", "xmldsig-core-schema.xsd"];
let schemas: Record<string, Buffer> | undefined;

export class NfseSchemaError extends Error {
  constructor() { super("NFSE_SCHEMA_UNAVAILABLE"); this.name = "NfseSchemaError"; }
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
    // One resolver for both validators. Unknown resources never use filesystem/network fallback.
    const provider = new XmlBufferInputProvider(data);
    if (!xmlRegisterInputProvider({ match: () => true, open: name => provider.open(name), read: (fd, buffer) => provider.read(fd, buffer), close: fd => provider.close(fd) })) throw new Error();
    schemas = data; return data;
  } catch { throw new NfseSchemaError(); }
}

/** Only bundled, hash-pinned public schemas; caller retains ownership of the input document. */
export function validateNfseSchema(doc: XmlDocument, name: "DPS_v1.01.xsd" | "NFSe_v1.01.xsd") {
  const data = officialSchemas();
  let schema: XmlDocument | undefined, validator: XsdValidator | undefined;
  try {
    schema = XmlDocument.fromBuffer(data[name], { ...nfseParseOptions, url: name });
    validator = XsdValidator.fromDoc(schema); validator.validate(doc);
  } finally { validator?.dispose(); schema?.dispose(); }
}
