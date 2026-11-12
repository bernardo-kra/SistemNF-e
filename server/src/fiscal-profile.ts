import { createHash, randomUUID } from "node:crypto";
import type { NfseReadiness } from "../../shared/nfse-readiness.js";
import { readA1Certificate } from "./nfse-a1-custody.js";
import type { PoolClient } from "pg";
import { allowedKeys, inputRecord, requireUuid } from "./customers.js";
import { ApiError, conflict, invalidInput, notFound } from "./errors.js";
import { NfseDpsError, dpsSchemaId, requireDpsDocument } from "./nfse-dps-validation.js";
import { prepareDpsWithinTransaction, readDpsWithinTransaction, withDpsTransaction, type DpsJournalAccess } from "./nfse-dps-journal.js";
type Kind = "profile" | "customer";
// JSON fields enter through validation; only the structured fields are accessed as objects.
type Fields = Record<string, unknown> & {
  document?: ReturnType<typeof normalizeDocument> | null;
  address?: ReturnType<typeof normalizeAddress> | null;
};
type Row = {
  version: number;
  body: Fields;
  actor_id: string;
  at: Date;
};
const profileKeys = [
  "cnpj", "municipalityCode", "serviceMunicipalityCode", "legalName", "regime", "simplesAssessment", "specialRegime", "series", "nationalTaxCode", "municipalTaxCode", "nbsCode", "serviceDescription", "approxSimplesRate", "issTaxation", "issWithholding"
];
const requiredProfileFields = [
  "cnpj", "municipalityCode", "serviceMunicipalityCode", "regime", "simplesAssessment", "specialRegime", "series", "nationalTaxCode", "serviceDescription", "approxSimplesRate", "issTaxation", "issWithholding"
];
function canonicalJson(value: unknown): string | undefined {
  if (Array.isArray(value))
    return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const fields = value as Record<string, unknown>;
    return `{${Object.keys(fields).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(fields[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
const requestFingerprint = (value: Record<string, unknown>) => createHash("sha256").update(canonicalJson(value)!).digest("hex");
function requiredText(raw: unknown, max: number) {
  if (typeof raw !== "string" || !raw.trim() || raw.trim().length > max || /[\u0000-\u001f]/.test(raw))
    throw invalidInput();
  return raw.trim();
}
function fixedDigits(raw: unknown, length: number) {
  const value = requiredText(raw, length);
  if (!new RegExp(`^\\d{${length}}$`).test(value))
    throw invalidInput();
  return value;
}
function requireVersion(raw: unknown) {
  if (!Number.isSafeInteger(raw) || Number(raw) < 0 || Number(raw) > 2147483646)
    throw invalidInput();
  return raw as number;
}
function requireOption(raw: unknown, values: string[]) {
  if (typeof raw !== "string" || !values.includes(raw))
    throw invalidInput();
  return raw;
}
function normalizeDocument(raw: unknown) {
  const data = inputRecord(raw);
  allowedKeys(data, ["type", "value"]);
  const type = requireOption(data.type, ["CPF", "CNPJ"]);
  return { type, value: requireDpsDocument(type, requiredText(data.value, 14)) };
}
function normalizeAddress(raw: unknown) {
  const data = inputRecord(raw);
  allowedKeys(data, ["municipalityCode", "postalCode", "street", "number", "district", "complement"]);
  return {
    municipalityCode: fixedDigits(data.municipalityCode, 7),
    postalCode: fixedDigits(data.postalCode, 8),
    street: requiredText(data.street, 255),
    number: requiredText(data.number, 60),
    district: requiredText(data.district, 60),
    ...(data.complement === undefined ? {} : { complement: requiredText(data.complement, 156) })
  };
}
function normalizeFiscalPatch(body: Record<string, unknown>) {
  const fields: Fields = {};
  for (const [key, raw] of Object.entries(body)) {
    if (key === "requestId" || key === "version")
      continue;
    if (raw === null) {
      fields[key] = null;
      continue;
    }
    if (key === "document")
      fields[key] = normalizeDocument(raw);
    else if (key === "address")
      fields[key] = normalizeAddress(raw);
    else if (key === "cnpj")
      fields[key] = requireDpsDocument("CNPJ", requiredText(raw, 14));
    else if (key === "municipalityCode" || key === "serviceMunicipalityCode")
      fields[key] = fixedDigits(raw, 7);
    else if (key === "nationalTaxCode")
      fields[key] = fixedDigits(raw, 6);
    else if (key === "municipalTaxCode")
      fields[key] = fixedDigits(raw, 3);
    else if (key === "nbsCode")
      fields[key] = fixedDigits(raw, 9);
    else if (key === "regime")
      fields[key] = requireOption(raw, ["simples_me_epp", "mei", "normal"]);
    else if (key === "simplesAssessment" || key === "issWithholding")
      fields[key] = requireOption(raw, ["1", "2", "3"]);
    else if (key === "issTaxation")
      fields[key] = requireOption(raw, ["1", "2", "3", "4"]);
    else if (key === "specialRegime")
      fields[key] = requireOption(raw, ["0", "1", "2", "3", "4", "5", "6"]);
    else if (key === "series") {
      const value = requiredText(raw, 5);
      if (!/^[1-9]\d{0,4}$/.test(value) || Number(value) > 49999)
        throw invalidInput();
      fields[key] = value;
    }
    else if (key === "approxSimplesRate") {
      const value = requiredText(raw, 5);
      if (!/^(?:0|[1-9]\d?)\.\d{2}$/.test(value))
        throw invalidInput();
      fields[key] = value;
    }
    else
      fields[key] = requiredText(raw, key === "serviceDescription" ? 2000 : 150);
  }
  return fields;
}
function fiscalRecordView(kind: Kind, row?: Row) {
  const fields: Fields = { ...Object.fromEntries((kind === "profile" ? profileKeys : ["document", "address"]).map(k => [k, null])), ...row?.body };
  const missingFields = kind === "profile" ? requiredProfileFields.filter(k => fields[k] === null) : fields.document === null ? ["document"] : [];
  const supported: Fields = {
    regime: "simples_me_epp", simplesAssessment: "1", specialRegime: "0", issTaxation: "1", issWithholding: "1"
  };
  const unsupportedFields = kind === "profile" ? Object.keys(supported).filter(k => fields[k] !== null && fields[k] !== supported[k]) : [];
  return {
    version: row?.version ?? 0, fields, missingFields, unsupportedFields, preparationReady: missingFields.length === 0 && unsupportedFields.length === 0, readyForSubmission: false, updatedAt: row?.at.toISOString() ?? null, updatedBy: row?.actor_id ?? null
  };
}
async function handleFiscalErrors<T>(run: () => Promise<T>) {
  try {
    return await run();
  }
  catch (error) {
    if (error instanceof NfseDpsError)
      throw new ApiError(400, error.code, "Confira os dados fiscais informados.");
    throw error;
  }
}
async function loadFiscalRecord(client: PoolClient, access: DpsJournalAccess, kind: Kind, id: string) {
  return (await client.query<Row>("SELECT version,body,actor_id,at FROM fiscal_records WHERE tenant_id=$1 AND kind=$2 AND entity_id=$3", [access.tenantId, kind, id])).rows[0];
}
async function readCustomer(client: PoolClient, id: string, lock = false) {
  const row = (await client.query(`SELECT id,type,active FROM customers WHERE id=$1${lock ? " FOR SHARE" : ""}`, [id])).rows[0];
  if (!row)
    throw notFound();
  return row;
}
/** Advisory read only. Local setup never certifies fiscal authorization or enables transport. */
export async function readFiscalReadiness(access: DpsJournalAccess, storageConfigured: boolean): Promise<NfseReadiness> {
  const profile = await readFiscalRecord(access, "profile");
  const certificate = await readA1Certificate(access);
  const now = Date.now();
  return {
    tenantId: access.tenantId, environment: "production-restricted", readyForSubmission: false,
    setup: {
      profileComplete: profile.preparationReady,
      certificateRegistered: Boolean(certificate), storageConfigured,
      certificateCurrentForIssuer: Boolean(certificate && certificate.issuerCnpj === profile.fields.cnpj
        && Date.parse(certificate.validFrom) <= now && now < Date.parse(certificate.validTo)),
    },
    technicalBlockers: ["OFFICIAL_SIGNATURE_PROFILE_UNCONFIRMED", "OFFICIAL_TRANSPORT_CONTRACT_UNCONFIRMED", "SUBMISSION_JOURNAL_REQUIRED", "OFFICIAL_HOMOLOGATION_REQUIRED"],
  };
}

export async function readFiscalRecord(access: DpsJournalAccess, kind: Kind, rawId?: unknown) {
  const id = kind === "profile" ? access.tenantId : requireUuid(rawId);
  return withDpsTransaction(access, false, async (client) => {
    if (kind === "customer")
      await readCustomer(client, id);
    return fiscalRecordView(kind, await loadFiscalRecord(client, access, kind, id));
  });
}
export async function saveFiscalRecord(access: DpsJournalAccess, kind: Kind, raw: unknown, rawId?: unknown) {
  return handleFiscalErrors(async () => {
    const id = kind === "profile" ? access.tenantId : requireUuid(rawId);
    const body = inputRecord(structuredClone(raw));
    allowedKeys(body, ["requestId", "version", ...(kind === "profile" ? profileKeys : ["document", "address"])]);
    const requestId = requireUuid(body.requestId);
    const expected = requireVersion(body.version);
    const patch = normalizeFiscalPatch(body);
    const hash = requestFingerprint({
      kind, id, expected, patch
    });
    return withDpsTransaction(access, true, async (client) => {
      const previous = (await client.query("SELECT tenant_id,actor_id,fingerprint,result FROM fiscal_settings_requests WHERE id=$1", [requestId])).rows[0];
      if (previous) {
        if (previous.tenant_id !== access.tenantId || previous.actor_id !== access.actorId || previous.fingerprint !== hash)
          throw conflict();
        return previous.result as ReturnType<typeof fiscalRecordView>;
      }
      if (kind === "customer") {
        const buyer = await readCustomer(client, id, true);
        if (!buyer.active || (patch.document && patch.document.type !== (buyer.type === "Empresa" ? "CNPJ" : "CPF")))
          throw conflict();
      }
      const old = await loadFiscalRecord(client, access, kind, id);
      const current = fiscalRecordView(kind, old);
      if (current.version !== expected)
        throw conflict();
      const changed = Object.keys(patch).filter(key => canonicalJson(current.fields[key]) !== canonicalJson(patch[key]));
      let result = current;
      if (changed.length) {
        const fields = { ...current.fields, ...patch };
        const saved = (await client.query<Row>("INSERT INTO fiscal_records(kind,entity_id,tenant_id,version,body,actor_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(kind,entity_id) DO UPDATE SET version=EXCLUDED.version,body=EXCLUDED.body,actor_id=EXCLUDED.actor_id,at=clock_timestamp() RETURNING version,body,actor_id,at", [kind, id, access.tenantId, expected + 1, JSON.stringify(fields), access.actorId])).rows[0];
        await client.query("INSERT INTO fiscal_record_versions(kind,entity_id,tenant_id,version,body,field_names,actor_id,at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [kind, id, access.tenantId, saved.version, JSON.stringify(fields), changed, access.actorId, saved.at]);
        await client.query("INSERT INTO audit_events(id,tenant_id,actor_id,action,entity_type,entity_id,entity_version,field_names) VALUES($1,$2,$3,'fiscal.settings.update',$4,$5,$6,$7)", [randomUUID(), access.tenantId, access.actorId, kind === "profile" ? "fiscal_profile" : "customer_fiscal", id, saved.version, changed]);
        result = fiscalRecordView(kind, saved);
      }
      await client.query("INSERT INTO fiscal_settings_requests(id,tenant_id,actor_id,fingerprint,result) VALUES($1,$2,$3,$4,$5)", [requestId, access.tenantId, access.actorId, hash, JSON.stringify(result)]);
      return result;
    });
  });
}
function draftMetadata(draft: Awaited<ReturnType<typeof readDpsWithinTransaction>>, profileVersion: number, customerFiscalVersion: number) {
  const { xml: _, ...rest } = draft;
  return { ...rest, profileVersion, customerFiscalVersion };
}
export async function prepareFiscalOrder(access: DpsJournalAccess, rawId: unknown, raw: unknown) {
  return handleFiscalErrors(async () => {
    const orderId = requireUuid(rawId);
    const body = inputRecord(structuredClone(raw));
    allowedKeys(body, ["requestId", "orderVersion", "profileVersion", "customerFiscalVersion", "competence", "description", "serviceMunicipalityCode"]);
    const requestId = requireUuid(body.requestId);
    const orderVersion = requireVersion(body.orderVersion);
    const profileVersion = requireVersion(body.profileVersion);
    const customerFiscalVersion = requireVersion(body.customerFiscalVersion);
    const competence = requiredText(body.competence, 10);
    const description = body.description === undefined ? undefined : requiredText(body.description, 2000);
    const serviceMunicipalityCode = body.serviceMunicipalityCode === undefined ? undefined : fixedDigits(body.serviceMunicipalityCode, 7);
    const hash = requestFingerprint({
      orderId, orderVersion, profileVersion, customerFiscalVersion, competence, ...(description === undefined ? {} : { description }), ...(serviceMunicipalityCode === undefined ? {} : { serviceMunicipalityCode })
    });
    return withDpsTransaction(access, true, async (client) => {
      const previous = (await client.query("SELECT tenant_id,actor_id,fingerprint,draft_id,profile_version,customer_fiscal_version FROM fiscal_prepare_requests WHERE id=$1", [requestId])).rows[0];
      if (previous) {
        if (previous.tenant_id !== access.tenantId || previous.actor_id !== access.actorId || previous.fingerprint !== hash)
          throw conflict();
        return draftMetadata(await readDpsWithinTransaction(access, client, previous.draft_id), previous.profile_version, previous.customer_fiscal_version);
      }
      const source = (await client.query("SELECT body->>'customerId' AS customer_id FROM operational_records WHERE entity_type='order' AND id=$1 FOR SHARE", [orderId])).rows[0];
      if (!source)
        throw notFound();
      const profile = fiscalRecordView("profile", await loadFiscalRecord(client, access, "profile", access.tenantId));
      const recipient = fiscalRecordView("customer", await loadFiscalRecord(client, access, "customer", requireUuid(source.customer_id)));
      if (profile.version !== profileVersion || recipient.version !== customerFiscalVersion)
        throw conflict();
      if (profile.missingFields.some(field => field !== "serviceMunicipalityCode" || !serviceMunicipalityCode) || profile.unsupportedFields.length || !recipient.preparationReady)
        throw new ApiError(409, "FISCAL_CONFIGURATION_PENDING", "Complete e confira os dados fiscais antes de preparar o rascunho.");
      const issuerFields = profile.fields;
      const recipientFields = recipient.fields;
      const draft = await prepareDpsWithinTransaction(access, client, {
        requestId,
        orderId,
        orderVersion,
        fiscal: {
          environment: "production-restricted",
          schemaId: dpsSchemaId,
          issuance: {
            series: issuerFields.series,
            competence,
            issuedAt: new Date().toISOString().slice(0, 19) + "+00:00",
            applicationVersion: "Sistem-0.1"
          },
          issuer: {
            cnpj: issuerFields.cnpj,
            municipalityCode: issuerFields.municipalityCode,
            regime: {
              opSimpNac: "3",
              regApTribSN: issuerFields.simplesAssessment,
              regEspTrib: issuerFields.specialRegime
            }
          },
          customer: {
            document: recipientFields.document,
            ...(recipientFields.address === null ? {} : { address: recipientFields.address })
          },
          service: {
            municipalityCode: serviceMunicipalityCode ?? issuerFields.serviceMunicipalityCode,
            nationalTaxCode: issuerFields.nationalTaxCode,
            description: description ?? issuerFields.serviceDescription,
            ...(issuerFields.municipalTaxCode === null ? {} : { municipalTaxCode: issuerFields.municipalTaxCode }),
            ...(issuerFields.nbsCode === null ? {} : { nbsCode: issuerFields.nbsCode })
          },
          taxation: {
            issTaxation: issuerFields.issTaxation,
            issWithholding: issuerFields.issWithholding,
            approxSimplesRate: issuerFields.approxSimplesRate
          }
        }
      });
      await client.query("INSERT INTO fiscal_prepare_requests(id,tenant_id,actor_id,fingerprint,draft_id,profile_version,customer_fiscal_version) VALUES($1,$2,$3,$4,$5,$6,$7)", [requestId, access.tenantId, access.actorId, hash, draft.draftId, profileVersion, customerFiscalVersion]);
      return draftMetadata(draft, profileVersion, customerFiscalVersion);
    });
  });
}
export async function findFiscalOrderDraft(access: DpsJournalAccess, rawId: unknown) {
  const orderId = requireUuid(rawId);
  return withDpsTransaction(access, false, async (client) => {
    if (!(await client.query("SELECT id FROM operational_records WHERE entity_type='order' AND id=$1", [orderId])).rowCount)
      throw notFound();
    const found = (await client.query("SELECT d.id,r.profile_version,r.customer_fiscal_version FROM nfse_dps_drafts d LEFT JOIN fiscal_prepare_requests r ON r.draft_id=d.id AND r.tenant_id=d.tenant_id WHERE d.tenant_id=$1 AND d.order_id=$2 AND d.environment='production-restricted' ORDER BY r.at LIMIT 1", [access.tenantId, orderId])).rows[0];
    if (!found)
      return null;
    return draftMetadata(await readDpsWithinTransaction(access, client, found.id), found.profile_version ?? null, found.customer_fiscal_version ?? null);
  });
}
