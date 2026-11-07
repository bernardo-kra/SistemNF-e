import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { allowedKeys, inputRecord, requireUuid } from "./customers.js";
import { ApiError, forbidden, invalidInput, notFound, unavailable } from "./errors.js";
import { prepareOrderDpsDraft } from "./nfse-dps-draft.js";
import { NfseDpsError } from "./nfse-dps-validation.js";

/** Internal only: the caller must resolve the pool and authenticate/authorize current access. */
export type DpsJournalAccess = { pool: Pool; tenantId: string; actorId: string };
type DraftRow = {
  id: string; tenant_id: string; environment: "production-restricted"; order_id: string; order_version: number; customer_id: string;
  actor_id: string; at: Date; series: number; number: string; dps_id: string; schema_id: string; fingerprint: string; xml: string;
  service_amount_cents: string; excluded_parts_cents: string | null; pending_checks: string[];
};
const columns = "id,tenant_id,environment,order_id,order_version,customer_id,actor_id,at,series,number::text,dps_id,schema_id,fingerprint,xml,service_amount_cents::text,excluded_parts_cents::text,pending_checks";
const environment = "production-restricted";
const fail = (code: string) => new ApiError(409, code, "A preparação fiscal requer conferência. Nenhuma nova DPS foi criada.");
const canonical = (value: any): string => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);

function context(access: DpsJournalAccess): DpsJournalAccess {
  const tenantId = requireUuid(access.tenantId), actorId = access.actorId;
  if (typeof actorId !== "string" || !actorId.trim() || actorId.length > 200 || /[\u0000-\u001f]/.test(actorId)) throw invalidInput();
  return { tenantId, actorId, pool: access.pool };
}
function command(raw: unknown) {
  let snapshot: unknown;
  try {
    const serialized = JSON.stringify(raw);
    if (!serialized || Buffer.byteLength(serialized) > 131072) throw invalidInput();
    snapshot = JSON.parse(serialized);
  } catch { throw invalidInput(); }
  const body = inputRecord(snapshot); allowedKeys(body, ["requestId", "orderId", "orderVersion", "fiscal"]);
  const requestId = requireUuid(body.requestId), orderId = requireUuid(body.orderId), orderVersion = body.orderVersion;
  if (!Number.isSafeInteger(orderVersion) || Number(orderVersion) < 1 || Number(orderVersion) > 2147483647) throw invalidInput();
  const fiscal = inputRecord(body.fiscal); allowedKeys(fiscal, ["environment", "schemaId", "issuance", "issuer", "customer", "service", "taxation"]);
  const issuance = inputRecord(fiscal.issuance); allowedKeys(issuance, ["series", "issuedAt", "competence", "applicationVersion"]);
  const customer = inputRecord(fiscal.customer); allowedKeys(customer, ["document", "address"]);
  const fingerprint = createHash("sha256").update(canonical({ orderId, orderVersion, fiscal })).digest("hex");
  return { requestId, orderId, orderVersion: orderVersion as number, fiscal, issuance, customer, fingerprint };
}
async function transaction<T>(access: DpsJournalAccess, write: boolean, run: (client: PoolClient) => Promise<T>): Promise<T> {
  let client: PoolClient | undefined, broken = false;
  try {
    client = await access.pool.connect();
    await client.query(write ? "BEGIN" : "BEGIN READ ONLY");
    await client.query("SET LOCAL lock_timeout='5s'"); await client.query("SET LOCAL statement_timeout='10s'");
    // Same lock order as operational commands: no OS snapshot while an update is pending.
    if (write && !(await client.query("SELECT id FROM operational_coordination WHERE id=1 FOR UPDATE")).rowCount) throw unavailable();
    const binding = (await client.query("SELECT tenant_id FROM tenant_admission WHERE singleton=true")).rows[0];
    if (binding?.tenant_id !== access.tenantId) throw forbidden();
    const result = await run(client); await client.query("COMMIT"); return result;
  } catch (error) {
    if (client) { try { await client.query("ROLLBACK"); } catch { broken = true; } }
    if (error instanceof ApiError || error instanceof NfseDpsError) throw error;
    throw unavailable(); // Never propagate native SQL errors or the fiscal snapshot.
  } finally { client?.release(broken); }
}
function projection(row: DraftRow) {
  return { draftId: row.id, id: row.dps_id, orderId: row.order_id, orderVersion: row.order_version, customerId: row.customer_id,
    actorId: row.actor_id, createdAt: row.at.toISOString(), environment: row.environment, schemaId: row.schema_id,
    series: String(row.series), number: row.number, state: "unsigned_draft" as const, xml: row.xml,
    serviceAmountCents: Number(row.service_amount_cents), excludedPartsCents: row.excluded_parts_cents === null ? null : Number(row.excluded_parts_cents),
    numberReserved: true as const, readyForSubmission: false as const, pendingChecks: row.pending_checks };
}
async function load(client: PoolClient, tenantId: string, id: string) {
  const row = (await client.query<DraftRow>(`SELECT ${columns} FROM nfse_dps_drafts WHERE tenant_id=$1 AND id=$2`, [tenantId, id])).rows[0];
  if (!row) throw notFound(); return row;
}

/** Atomically reserves and persists a validated UNSIGNED DPS. Never sends an HTTP request. */
export async function prepareDpsRequest(rawAccess: DpsJournalAccess, raw: unknown) {
  const access = context(rawAccess), body = command(raw);
  return transaction(access, true, client => prepareLocked(access, client, body));
}
/** Internal composition only: requires the client/lock supplied by withDpsTransaction. */
export function prepareDpsWithinTransaction(access: DpsJournalAccess, client: PoolClient, raw: unknown) {
  return prepareLocked(context(access), client, command(raw));
}
/** One connection/transaction for settings + journal. Never call a nested journal transaction. */
export function withDpsTransaction<T>(rawAccess: DpsJournalAccess, write: boolean, run: (client: PoolClient) => Promise<T>) {
  return transaction(context(rawAccess), write, run);
}
export async function readDpsWithinTransaction(access: DpsJournalAccess, client: PoolClient, id: string) {
  return projection(await load(client, access.tenantId, id));
}
async function prepareLocked(access: DpsJournalAccess, client: PoolClient, body: ReturnType<typeof command>) {
    const previous = (await client.query("SELECT tenant_id,actor_id,fingerprint,draft_id FROM nfse_dps_requests WHERE id=$1", [body.requestId])).rows[0];
    if (previous) {
      if (previous.tenant_id !== access.tenantId || previous.actor_id !== access.actorId || previous.fingerprint !== body.fingerprint) throw fail("DPS_REQUEST_CONFLICT");
      return projection(await load(client, access.tenantId, previous.draft_id));
    }
    const existing = (await client.query<DraftRow>(`SELECT ${columns} FROM nfse_dps_drafts WHERE tenant_id=$1 AND environment=$2 AND order_id=$3`, [access.tenantId, environment, body.orderId])).rows[0];
    if (existing) {
      if (existing.fingerprint !== body.fingerprint) throw fail("DPS_REQUEST_CONFLICT");
      await client.query("INSERT INTO nfse_dps_requests(id,tenant_id,actor_id,fingerprint,draft_id) VALUES($1,$2,$3,$4,$5)", [body.requestId, access.tenantId, access.actorId, body.fingerprint, existing.id]);
      return projection(existing);
    }
    const order = (await client.query("SELECT version,body->>'customerId' AS customer_id,body->'approved' AS approved,body->'laborCents' AS labor_cents FROM operational_records WHERE entity_type='order' AND id=$1 FOR SHARE", [body.orderId])).rows[0];
    if (!order) throw notFound();
    if (order.version !== body.orderVersion || order.approved !== true || typeof order.customer_id !== "string") throw fail("DPS_SOURCE_CONFLICT");
    const buyer = (await client.query("SELECT id,name,type,active FROM customers WHERE id=$1 FOR SHARE", [requireUuid(order.customer_id)])).rows[0];
    const doc = inputRecord(body.customer.document);
    if (!buyer?.active || (buyer.type === "Empresa" ? doc.type !== "CNPJ" : doc.type !== "CPF")) throw fail("DPS_SOURCE_CONFLICT");
    const input = { ...body.fiscal, issuance: { ...body.issuance, number: "1" }, customer: { ...body.customer, name: buyer.name },
      source: { type: "order", id: body.orderId, version: order.version, approved: true, laborCents: order.labor_cents } };
    // Validate all fiscal declarations BEFORE reserving; unknown parts stay unknown.
    prepareOrderDpsDraft(input);
    const issuer = inputRecord(body.fiscal.issuer), series = Number(body.issuance.series);
    const scope = [environment, issuer.municipalityCode, issuer.cnpj, series];
    await client.query("INSERT INTO nfse_dps_counters(environment,municipality_code,issuer_cnpj,series,last_number) VALUES($1,$2,$3,$4,0) ON CONFLICT DO NOTHING", scope);
    const counter = (await client.query("SELECT last_number::text AS number FROM nfse_dps_counters WHERE environment=$1 AND municipality_code=$2 AND issuer_cnpj=$3 AND series=$4 FOR UPDATE", scope)).rows[0];
    if (!counter || BigInt(counter.number) >= 999999999999999n) throw fail("DPS_NUMBER_EXHAUSTED");
    const number = (BigInt(counter.number) + 1n).toString();
    const draft = prepareOrderDpsDraft({ ...input, issuance: { ...input.issuance, number } });
    await client.query("UPDATE nfse_dps_counters SET last_number=$5 WHERE environment=$1 AND municipality_code=$2 AND issuer_cnpj=$3 AND series=$4", [...scope, number]);
    const draftId = randomUUID(), pendingChecks = draft.pendingChecks.filter(code => code !== "DPS_NUMBER_NOT_RESERVED");
    const saved = (await client.query<DraftRow>(`INSERT INTO nfse_dps_drafts(id,tenant_id,environment,order_id,order_version,customer_id,actor_id,municipality_code,issuer_cnpj,series,number,dps_id,schema_id,fingerprint,xml,service_amount_cents,excluded_parts_cents,pending_checks)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING ${columns}`,
      [draftId, access.tenantId, environment, body.orderId, order.version, buyer.id, access.actorId, issuer.municipalityCode, issuer.cnpj, series, number, draft.id, draft.schemaId, body.fingerprint, draft.xml, draft.serviceAmountCents, draft.excludedPartsCents, pendingChecks])).rows[0];
    await client.query("INSERT INTO nfse_dps_requests(id,tenant_id,actor_id,fingerprint,draft_id) VALUES($1,$2,$3,$4,$5)", [body.requestId, access.tenantId, access.actorId, body.fingerprint, draftId]);
    await client.query("INSERT INTO nfse_dps_events(draft_id,kind,actor_id) VALUES($1,'prepared',$2)", [draftId, access.actorId]);
    await client.query("INSERT INTO audit_events(id,tenant_id,actor_id,action,entity_type,entity_id,entity_version,field_names,after_values) VALUES($1,$2,$3,'nfse.dps.prepare','nfse_dps',$4,1,$5,$6)",
      [randomUUID(), access.tenantId, access.actorId, draftId, ["orderId", "state", "numberReserved"], JSON.stringify({ orderId: body.orderId, state: "unsigned_draft", environment, numberReserved: true, readyForSubmission: false })]);
    return projection(saved);
}
export async function getDpsRequest(rawAccess: DpsJournalAccess, rawId: unknown) {
  const access = context(rawAccess), id = requireUuid(rawId);
  return transaction(access, false, async client => projection(await load(client, access.tenantId, id)));
}
export async function readDpsHistory(rawAccess: DpsJournalAccess, rawId: unknown) {
  const access = context(rawAccess), id = requireUuid(rawId);
  return transaction(access, false, async client => {
    // Select only the identifier: the history does not need customer XML.
    if (!(await client.query("SELECT id FROM nfse_dps_drafts WHERE tenant_id=$1 AND id=$2", [access.tenantId, id])).rowCount) throw notFound();
    const events = (await client.query("SELECT sequence::text,kind,actor_id,at FROM nfse_dps_events WHERE draft_id=$1 ORDER BY sequence", [id])).rows;
    return { draftId: id, events: events.map(row => ({ sequence: row.sequence as string, kind: row.kind as "prepared", actorId: row.actor_id as string, at: (row.at as Date).toISOString() })) };
  });
}
