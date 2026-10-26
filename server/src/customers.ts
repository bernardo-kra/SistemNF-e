import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { ApiError, conflict, invalidInput, notFound, unavailable } from "./errors.js";

type CustomerType = "Pessoa física" | "Empresa";
type CustomerFields = { name: string; email: string; phone: string; type: CustomerType };
type CustomerRow = CustomerFields & { id: string; active: boolean; version: number; created_at: Date; updated_at: Date };
export type CustomerDto = CustomerFields & { id: string; active: boolean; version: number; createdAt: string; updatedAt: string };
export type WriteContext = { tenantId: string; actorId: string };
type CustomerPatch = Partial<CustomerFields> & { active?: boolean };
const columns = "id,name,email,phone,type,active,version,created_at,updated_at";
const fields = ["name", "email", "phone", "type", "active"] as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUuid(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value)) throw invalidInput("Informe uma identificação válida.");
  return value.toLowerCase();
}

export function inputRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidInput();
  return value as Record<string, unknown>;
}

export function allowedKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw invalidInput("O pedido contém campos não permitidos.");
}

function stringField(value: unknown, maximum: number, required = false): string {
  if (typeof value !== "string") throw invalidInput("Confira o formato dos campos de texto.");
  const text = value.trim();
  if (text.length > maximum || (required && !text)) throw invalidInput("Confira os campos obrigatórios e seus limites.");
  return text;
}

function customerFields(body: Record<string, unknown>, partial: boolean): CustomerPatch {
  const result: CustomerPatch = {};
  if (!partial || Object.hasOwn(body, "name")) result.name = stringField(body.name, 120, true);
  if (!partial || Object.hasOwn(body, "email")) {
    const email = !partial && body.email === undefined ? "" : stringField(body.email, 254);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) throw invalidInput("Informe um e-mail válido ou deixe o campo vazio.");
    result.email = email;
  }
  if (!partial || Object.hasOwn(body, "phone")) result.phone = !partial && body.phone === undefined ? "" : stringField(body.phone, 32);
  if (!partial || Object.hasOwn(body, "type")) {
    const type = stringField(body.type, 20, true);
    if (type !== "Pessoa física" && type !== "Empresa") throw invalidInput("Selecione um tipo de cliente válido.");
    result.type = type;
  }
  if (partial && Object.hasOwn(body, "active")) {
    if (typeof body.active !== "boolean") throw invalidInput("Informe uma situação válida para o cadastro.");
    result.active = body.active;
  }
  return result;
}

function dto(row: CustomerRow): CustomerDto {
  return { id: row.id, name: row.name, email: row.email, phone: row.phone, type: row.type, active: row.active,
    version: row.version, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
}

async function transact<T>(pool: Pool, action: (client: PoolClient) => Promise<T>, readOnly = false): Promise<T> {
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query(readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN");
    const result = await action(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    if (client) { try { await client.query("ROLLBACK"); } catch { /* Preserve the controlled result below. */ } }
    if (error instanceof ApiError) throw error;
    throw unavailable();
  } finally { client?.release(); }
}

function pagination(raw: unknown, defaultValue: number, minimum: number, maximum: number): number {
  if (raw === undefined) return defaultValue;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) throw invalidInput("Confira os parâmetros da paginação.");
  const number = Number(raw);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw invalidInput("Confira os limites da paginação.");
  return number;
}

export async function listCustomers(pool: Pool, rawQuery: unknown) {
  const query = inputRecord(rawQuery);
  allowedKeys(query, ["q", "limit", "offset"]);
  const q = query.q === undefined ? "" : stringField(query.q, 100);
  const limit = pagination(query.limit, 25, 1, 100);
  const offset = pagination(query.offset, 0, 0, 10000);
  return transact(pool, async (client) => {
    // strpos treats %, _ and SQL-looking text literally. Values never become SQL.
    const where = "strpos(lower(name || ' ' || email || ' ' || phone), lower($1)) > 0";
    const count = await client.query<{ total: string }>(`SELECT count(*)::text AS total FROM customers WHERE ${where}`, [q]);
    const total = Number(count.rows[0].total);
    if (!Number.isSafeInteger(total)) throw unavailable();
    const selected = await client.query<CustomerRow>(`SELECT ${columns} FROM customers WHERE ${where} ORDER BY lower(name),id LIMIT $2 OFFSET $3`, [q, limit, offset]);
    return { items: selected.rows.map(dto), total, limit, offset };
  }, true);
}

export async function getCustomer(pool: Pool, id: string): Promise<CustomerDto> {
  return transact(pool, async (client) => {
    const selected = await client.query<CustomerRow>(`SELECT ${columns} FROM customers WHERE id=$1`, [id]);
    if (!selected.rows[0]) throw notFound();
    return dto(selected.rows[0]);
  }, true);
}

async function recordAudit(client: PoolClient, context: WriteContext, row: CustomerRow, action: string, changed: readonly string[]) {
  await client.query("INSERT INTO audit_events (id,tenant_id,actor_id,action,entity_type,entity_id,entity_version,field_names) VALUES ($1,$2,$3,$4,'customer',$5,$6,$7)",
    [randomUUID(), context.tenantId, context.actorId, action, row.id, row.version, changed]);
}

export async function createCustomerRecord(pool: Pool, raw: unknown, context: WriteContext): Promise<CustomerDto> {
  const body = inputRecord(raw);
  allowedKeys(body, ["name", "email", "phone", "type", "requestId"]);
  const data = customerFields(body, false) as CustomerFields;
  const requestId = body.requestId === undefined ? undefined : requireUuid(body.requestId);
  const fingerprint = createHash("sha256").update(JSON.stringify(data)).digest("hex");
  return transact(pool, async (client) => {
    if (requestId) {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`customer:${requestId}`]);
      const prior = await client.query("SELECT fingerprint,customer_id FROM customer_requests WHERE request_id=$1", [requestId]);
      if (prior.rows[0]) {
        if (prior.rows[0].fingerprint !== fingerprint) throw conflict();
        const existing = await client.query<CustomerRow>(`SELECT ${columns} FROM customers WHERE id=$1`, [prior.rows[0].customer_id]);
        if (!existing.rows[0]) throw unavailable(); return dto(existing.rows[0]);
      }
    }
    const created = await client.query<CustomerRow>(`INSERT INTO customers (id,name,email,phone,type) VALUES ($1,$2,$3,$4,$5) RETURNING ${columns}`,
      [randomUUID(), data.name, data.email, data.phone, data.type]);
    const row = created.rows[0];
    await recordAudit(client, context, row, "customer.created", fields);
    if (requestId) await client.query("INSERT INTO customer_requests(request_id,fingerprint,customer_id) VALUES($1,$2,$3)", [requestId, fingerprint, row.id]);
    return dto(row);
  });
}

export async function updateCustomerRecord(pool: Pool, id: string, raw: unknown, context: WriteContext): Promise<CustomerDto> {
  const body = inputRecord(raw);
  allowedKeys(body, ["version", ...fields]);
  if (!Number.isSafeInteger(body.version) || (body.version as number) <= 0) throw invalidInput("Informe a versão atual do cadastro.");
  const patch = customerFields(body, true);
  if (!Object.keys(patch).length) throw invalidInput("Informe ao menos um campo para atualizar.");
  return transact(pool, async (client) => {
    const selected = await client.query<CustomerRow>(`SELECT ${columns} FROM customers WHERE id=$1 FOR UPDATE`, [id]);
    const current = selected.rows[0];
    if (!current) throw notFound();
    if (current.version !== body.version) throw conflict();
    const changed = fields.filter((key) => Object.hasOwn(patch, key) && patch[key] !== current[key]);
    if (!changed.length) return dto(current);
    if (current.version >= 2147483647) throw conflict();
    const next = { ...current, ...patch };
    const updated = await client.query<CustomerRow>(`UPDATE customers SET name=$2,email=$3,phone=$4,type=$5,active=$6,version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING ${columns}`,
      [id, next.name, next.email, next.phone, next.type, next.active]);
    const row = updated.rows[0];
    await recordAudit(client, context, row, "customer.updated", changed);
    return dto(row);
  });
}
