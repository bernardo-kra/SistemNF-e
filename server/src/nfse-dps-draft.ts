import { createDpsId, dpsFailure, dpsSchemaId, NfseDpsError, requireDpsDocument, validateUnsignedDpsXml } from "./nfse-dps-validation.js";

type RecordValue = Record<string, unknown>;
function record(value: unknown, keys: string[], field: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) dpsFailure("DPS_INPUT_REQUIRED", field);
  const data = value as RecordValue;
  if (Object.keys(data).some(key => !keys.includes(key))) dpsFailure("UNSUPPORTED_DPS_INPUT", field);
  return data;
}
function text(value: unknown, max: number, field: string) {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) dpsFailure("INVALID_DPS_INPUT", field);
  return value.trim();
}
function code(value: unknown, length: number, field: string) {
  const result = text(value, length, field); if (!new RegExp(`^\\d{${length}}$`).test(result)) dpsFailure("INVALID_DPS_INPUT", field); return result;
}
function cents(value: unknown, field: string, positive = false) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < (positive ? 1 : 0) || value > 1_000_000_000_000) dpsFailure("INVALID_DPS_AMOUNT", field);
  return value;
}
function civil(value: unknown, field: string) {
  const result = text(value, 10, field), match = /^(2026)-(\d{2})-(\d{2})$/.exec(result);
  if (!match) dpsFailure("UNSUPPORTED_DPS_PERIOD", field);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.toISOString().slice(0, 10) !== result) dpsFailure("INVALID_DPS_DATE", field);
  return result;
}
const esc = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
const element = (name: string, value: string) => `<${name}>${esc(value)}</${name}>`;
const money = (value: number) => `${BigInt(value) / 100n}.${(BigInt(value) % 100n).toString().padStart(2, "0")}`;

/** Offline subset only. No HTTP, certificate, number reservation, DB write or inference of payment. */
export function prepareOrderDpsDraft(input: unknown) {
  try { return prepare(structuredClone(input)); }
  catch (error) { if (error instanceof NfseDpsError) throw error; dpsFailure("INVALID_DPS_INPUT"); }
}
function prepare(input: unknown) {
  const data = record(input, ["environment", "schemaId", "issuance", "source", "issuer", "customer", "service", "taxation"], "draft");
  if (data.environment !== "production-restricted" || data.schemaId !== dpsSchemaId) dpsFailure("UNSUPPORTED_DPS_ENVIRONMENT");
  const issuance = record(data.issuance, ["series", "number", "issuedAt", "competence", "applicationVersion"], "issuance");
  const source = record(data.source, ["type", "id", "version", "approved", "laborCents", "partsCents"], "source");
  const issuer = record(data.issuer, ["cnpj", "municipalityCode", "regime"], "issuer");
  const regime = record(issuer.regime, ["opSimpNac", "regApTribSN", "regEspTrib"], "issuer.regime");
  const customer = record(data.customer, ["document", "name", "address"], "customer");
  const doc = record(customer.document, ["type", "value"], "customer.document");
  const service = record(data.service, ["municipalityCode", "nationalTaxCode", "municipalTaxCode", "nbsCode", "description"], "service");
  const tax = record(data.taxation, ["issTaxation", "issWithholding", "approxSimplesRate"], "taxation");
  if (regime.opSimpNac !== "3" || regime.regApTribSN !== "1" || regime.regEspTrib !== "0" || tax.issTaxation !== "1" || tax.issWithholding !== "1") dpsFailure("UNSUPPORTED_DPS_TAX_SCENARIO");
  if (source.type !== "order" || source.approved !== true || typeof source.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(source.id) || !Number.isSafeInteger(source.version) || Number(source.version) < 1) dpsFailure("INVALID_DPS_SOURCE");
  const amount = cents(source.laborCents, "source.laborCents", true), parts = source.partsCents === undefined ? null : cents(source.partsCents, "source.partsCents");
  const municipality = code(issuer.municipalityCode, 7, "issuer.municipalityCode");
  const cnpj = requireDpsDocument("CNPJ", text(issuer.cnpj, 14, "issuer.cnpj"));
  const id = createDpsId({ municipalityCode: municipality, documentType: "CNPJ", document: cnpj, series: issuance.series as string, number: issuance.number as string });
  const issuedAt = text(issuance.issuedAt, 25, "issuance.issuedAt"), competence = civil(issuance.competence, "issuance.competence");
  civil(issuedAt.slice(0, 10), "issuance.issuedAt");
  if (!/^2026-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d[+-]\d{2}:00$/.test(issuedAt) || !Number.isFinite(Date.parse(issuedAt)) || competence > issuedAt.slice(0, 10)) dpsFailure("INVALID_DPS_DATE");
  const buyerType = text(doc.type, 4, "customer.document.type"), buyerDocument = requireDpsDocument(buyerType, text(doc.value, 14, "customer.document.value"));
  const buyerName = text(customer.name, 150, "customer.name");
  let address = "";
  if (customer.address !== undefined) {
    const a = record(customer.address, ["municipalityCode", "postalCode", "street", "number", "district", "complement"], "customer.address");
    address = `<end><endNac>${element("cMun", code(a.municipalityCode, 7, "customer.address.municipalityCode"))}${element("CEP", code(a.postalCode, 8, "customer.address.postalCode"))}</endNac>${element("xLgr", text(a.street, 255, "customer.address.street"))}${element("nro", text(a.number, 60, "customer.address.number"))}${a.complement === undefined ? "" : element("xCpl", text(a.complement, 156, "customer.address.complement"))}${element("xBairro", text(a.district, 60, "customer.address.district"))}</end>`;
  }
  const rate = text(tax.approxSimplesRate, 5, "taxation.approxSimplesRate");
  if (!/^(?:0|[1-9]\d?)\.\d{2}$/.test(rate)) dpsFailure("INVALID_DPS_INPUT", "taxation.approxSimplesRate");
  const national = code(service.nationalTaxCode, 6, "service.nationalTaxCode"), place = code(service.municipalityCode, 7, "service.municipalityCode"), description = text(service.description, 2000, "service.description");
  const optionalService = (service.municipalTaxCode === undefined ? "" : element("cTribMun", code(service.municipalTaxCode, 3, "service.municipalTaxCode"))) + (service.nbsCode === undefined ? "" : element("cNBS", code(service.nbsCode, 9, "service.nbsCode")));
  const xml = `<?xml version="1.0" encoding="UTF-8"?><DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infDPS Id="${id}"><tpAmb>2</tpAmb>${element("dhEmi", issuedAt)}${element("verAplic", text(issuance.applicationVersion, 20, "issuance.applicationVersion"))}${element("serie", issuance.series as string)}${element("nDPS", issuance.number as string)}${element("dCompet", competence)}<tpEmit>1</tpEmit><finNFSe>0</finNFSe>${element("cLocEmi", municipality)}<prest>${element("CNPJ", cnpj)}<regTrib><opSimpNac>3</opSimpNac><regApTribSN>1</regApTribSN><regEspTrib>0</regEspTrib></regTrib></prest><toma>${element(buyerType, buyerDocument)}${element("xNome", buyerName)}${address}</toma><serv><locPrest>${element("cLocPrestacao", place)}</locPrest><cServ>${element("cTribNac", national)}${optionalService}${element("xDescServ", description)}</cServ></serv><valores><vServPrest>${element("vServ", money(amount))}</vServPrest><trib><tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>1</tpRetISSQN></tribMun><totTrib>${element("pTotTribSN", rate)}</totTrib></trib></valores></infDPS></DPS>`;
  validateUnsignedDpsXml(xml);
  return { state: "unsigned_draft" as const, environment: "production-restricted" as const, schemaId: dpsSchemaId, id, xml, serviceAmountCents: amount, excludedPartsCents: parts, source: { id: source.id, version: source.version as number }, readyForSubmission: false as const,
    pendingChecks: ["CERTIFICATE_AND_SIGNATURE_REQUIRED", "DPS_NUMBER_NOT_RESERVED", "MUNICIPAL_AND_TAXPAYER_DATA_UNVERIFIED", "SERVICE_CLASSIFICATION_UNVERIFIED", "RTC_RULES_UNVERIFIED"] };
}
