import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { planInstallments, type AgreementTerms } from "../../shared/finance-planner.mjs";
import { allowedKeys, inputRecord, requireUuid } from "./customers.js";
import { ApiError, conflict, forbidden, invalidInput, notFound, unavailable } from "./errors.js";
import type { Permission } from "./permissions.js";

type Json = Record<string, any>;
export type FinanceAccess = { tenantId: string; actorId: string; actorName?: string; tenantName?: string; pool: Pool; permissions: Permission[] };
export type FinanceKind = "account" | "shift" | "agreement" | "payment";
export type FinanceRecord = { entity_type: FinanceKind; id: string; body: Json; version: number; created_at: Date; updated_at: Date; created_by: string; updated_by: string };
export const financeKinds: readonly string[] = ["account", "shift", "agreement", "payment"];
export const financeCommands: Record<string, Permission> = { "account.create": "finance.accounts.manage", "shift.open": "finance.cash.manage", "shift.close": "finance.cash.manage", "agreement.create": "finance.agreements.create", "payment.receive": "finance.receive" };
export function financeNeed(access: FinanceAccess, permission: Permission) { if (!access.permissions.includes(permission)) throw forbidden(); }
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw invalidInput("Confira os valores informados.");
  return value as number;
}
function cents(value: unknown) { return integer(Number(value)); }
function text(value: unknown, max = 160, empty = false): string {
  if (typeof value !== "string" || value.includes("\u0000") || value.trim().length > max || (!empty && !value.trim())) throw invalidInput();
  return value.trim();
}
export function financialDay(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  return ["year", "month", "day"].map((key) => parts.find((part) => part.type === key)!.value).join("-");
}
function record(kind: FinanceKind, row: Json, body: Json, version = 1): FinanceRecord {
  const at = row.created_at ?? row.opened_at ?? row.at;
  const actor = row.created_by ?? row.opened_by ?? row.actor_id;
  return { entity_type: kind, id: row.id, body, version, created_at: at, updated_at: row.closed_at ?? at, created_by: actor, updated_by: row.closed_by ?? actor };
}
function dto(row: FinanceRecord) { return { id: row.id, ...row.body, version: row.version, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), createdBy: row.created_by, updatedBy: row.updated_by }; }
async function accountBalance(client: PoolClient, id: string) {
  return cents((await client.query("SELECT COALESCE(sum(amount_cents),0)::text AS balance FROM finance_movements WHERE account_id=$1", [id])).rows[0].balance);
}
export async function financeEntity(client: PoolClient, kind: string, id: string): Promise<FinanceRecord> {
  const tables: Record<string, string> = { account: "finance_accounts", shift: "finance_shifts", agreement: "finance_agreements", payment: "finance_payments" };
  const table = tables[kind];
  if (!table) throw notFound();
  const row = (await client.query(`SELECT * FROM ${table} WHERE id=$1`, [requireUuid(id)])).rows[0];
  if (!row) throw notFound();
  return projectFinance(kind, row, kind === "account" ? await accountBalance(client, row.id) : undefined);
}
function projectFinance(kind: string, row: Json, balanceCents = 0): FinanceRecord {
  if (kind === "account") return record("account", row, { name: row.name, type: row.type, active: row.active, balanceCents }, row.version);
  if (kind === "shift") return record("shift", row, { accountId: row.account_id, status: row.status, openedBy: row.opened_by, openedAt: row.opened_at.toISOString(), openingBalanceCents: cents(row.opening_balance_cents),
    ...(row.closed_at ? { closedAt: row.closed_at.toISOString(), closedBy: row.closed_by, countedCents: cents(row.counted_cents), expectedCents: cents(row.expected_cents), differenceCents: integer(Number(row.difference_cents), -Number.MAX_SAFE_INTEGER) } : {}) }, row.version);
  if (kind === "agreement") return record("agreement", row, { sourceType: row.source_type, sourceId: row.source_id, sourceLabel: row.source_label, customerId: row.customer_id, customerName: row.customer_name, principalCents: cents(row.principal_cents) });
  return record("payment", row, { customerId: row.customer_id, accountId: row.account_id, shiftId: row.shift_id, amountCents: cents(row.amount_cents), method: row.method, reference: row.reference, at: row.at.toISOString(), actorId: row.actor_id, receipt: row.receipt, allocations: row.receipt.allocations });
}
async function audit(client: PoolClient, access: FinanceAccess, row: FinanceRecord, action: string, now: Date, before: Json = {}) {
  const permitted = ["type", "status", "amountCents", "principalCents", "accountId", "sourceType", "sourceId", "openingBalanceCents", "countedCents", "expectedCents", "differenceCents"];
  const after = Object.fromEntries(permitted.filter((key) => Object.hasOwn(row.body, key)).map((key) => [key, row.body[key]]));
  await client.query("INSERT INTO audit_events(id,tenant_id,actor_id,action,entity_type,entity_id,entity_version,at,field_names,before_values,after_values) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    [randomUUID(), access.tenantId, access.actorId, action, row.entity_type, row.id, row.version, now, Object.keys(after), JSON.stringify(before), JSON.stringify(after)]);
}
export function agreementTerms(raw: unknown): AgreementTerms {
  const input = inputRecord(raw); allowedKeys(input, ["downPaymentCents", "downPaymentDue", "installmentCount", "firstDue", "installmentDueDates"]);
  return input as AgreementTerms;
}
export async function createAgreement(client: PoolClient, access: FinanceAccess, now: Date, source: { id: string; type: "sale" | "order"; number: number; customerId: string; customerName: string; amountCents: number }, rawTerms: unknown): Promise<FinanceRecord> {
  financeNeed(access, "finance.agreements.create");
  const terms = agreementTerms(rawTerms);
  let rows;
  try { rows = planInstallments(source.amountCents, terms, financialDay(now)); } catch { throw invalidInput("Confira a entrada, parcelas e vencimentos."); }
  if ((await client.query("SELECT 1 FROM finance_agreements WHERE source_type=$1 AND source_id=$2", [source.type, source.id])).rowCount) throw conflict();
  const id = randomUUID(), label = `${source.type === "sale" ? "Venda" : "OS"} ${source.number}`;
  await client.query("INSERT INTO finance_agreements(id,source_type,source_id,source_label,customer_id,customer_name,principal_cents,created_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", [id, source.type, source.id, label, source.customerId, source.customerName, source.amountCents, now, access.actorId]);
  const batch = rows.map((row) => ({ id: randomUUID(), agreement_id: id, kind: row.kind, number: row.number, count: row.count, amount_cents: row.amountCents, due: row.due, created_at: now.toISOString() }));
  await client.query("INSERT INTO finance_installments SELECT id,agreement_id,kind,number,count,amount_cents,due,created_at FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,agreement_id uuid,kind text,number integer,count integer,amount_cents bigint,due date,created_at timestamptz)", [JSON.stringify(batch)]);
  const result = await financeEntity(client, "agreement", id); await audit(client, access, result, "agreement.create", now); return result;
}
const installmentQuery = `SELECT i.id,i.agreement_id,i.kind,i.number,i.count,i.amount_cents::text,i.due::text,i.created_at,
  g.customer_id,g.customer_name,g.source_type,g.source_id,g.source_label,
  COALESCE(p.paid,0)::text AS paid_cents
  FROM finance_installments i JOIN finance_agreements g ON g.id=i.agreement_id
  LEFT JOIN (SELECT installment_id,sum(amount_cents) AS paid FROM finance_allocations GROUP BY installment_id) p ON p.installment_id=i.id`;
function installmentDto(row: Json) {
  const amountCents = cents(row.amount_cents), paidCents = cents(row.paid_cents);
  return { id: row.id, agreementId: row.agreement_id, customerId: row.customer_id, customerName: row.customer_name, sourceType: row.source_type, sourceId: row.source_id, sourceLabel: row.source_label, kind: row.kind, number: row.number, count: row.count, amountCents, paidCents, balanceCents: integer(amountCents - paidCents), due: row.due, createdAt: row.created_at.toISOString() };
}
function paymentSource(data: Json): { type: "order" | "sale"; id: string } | null {
  if (data.sourceType === undefined && data.sourceId === undefined) return null;
  if (data.sourceType !== "order" && data.sourceType !== "sale") throw invalidInput();
  return { type: data.sourceType, id: requireUuid(data.sourceId) };
}
export async function receivePayment(client: PoolClient, access: FinanceAccess, now: Date, raw: unknown): Promise<FinanceRecord> {
  financeNeed(access, "finance.receive");
  const data = inputRecord(raw); allowedKeys(data, ["customerId", "amountCents", "method", "accountId", "shiftId", "reference", "creditConfirmed", "tenderedCents", "allocations", "sourceType", "sourceId"]);
  const source = paymentSource(data);
  const customerId = requireUuid(data.customerId), amountCents = integer(data.amountCents, 1), accountId = requireUuid(data.accountId);
  const customer = (await client.query("SELECT id,name FROM customers WHERE id=$1", [customerId])).rows[0]; if (!customer) throw notFound();
  if (!["cash", "pix", "transfer"].includes(data.method as string) || typeof data.creditConfirmed !== "boolean") throw invalidInput();
  const account = (await client.query("SELECT * FROM finance_accounts WHERE id=$1 AND active=true", [accountId])).rows[0]; if (!account) throw conflict();
  let shiftId: string | null = null, reference = text(data.reference ?? "", 160, true), tenderedCents = amountCents;
  if (data.method === "cash") {
    if (account.type !== "cash" || data.shiftId === undefined) throw conflict();
    shiftId = requireUuid(data.shiftId);
    const shift = (await client.query("SELECT * FROM finance_shifts WHERE id=$1 AND account_id=$2 AND status='open'", [shiftId, accountId])).rows[0];
    if (!shift || shift.opened_by !== access.actorId || financialDay(shift.opened_at) !== financialDay(now) || +shift.opened_at > +now) throw conflict();
    const last = (await client.query("SELECT max(at) AS at FROM finance_movements WHERE shift_id=$1", [shiftId])).rows[0].at;
    if (last && +last > +now) throw conflict();
    tenderedCents = data.tenderedCents === undefined ? amountCents : integer(data.tenderedCents, amountCents);
    reference ||= "Recebimento em dinheiro";
  } else {
    if (account.type !== "bank" || data.creditConfirmed !== true || !reference || data.shiftId !== undefined) throw invalidInput("Confira o crédito e a conta de destino.");
    if (data.tenderedCents !== undefined && data.tenderedCents !== amountCents) throw invalidInput();
  }
  const rows = (await client.query(`${installmentQuery} WHERE g.customer_id=$1 ORDER BY i.due,i.created_at,i.id`, [customerId])).rows.map(installmentDto).filter((row) => row.balanceCents > 0);
  const outstanding = integer(rows.reduce((sum, row) => sum + row.balanceCents, 0));
  const eligibleRows = source ? rows.filter((row) => row.sourceType === source.type && row.sourceId === source.id) : rows;
  if (amountCents > integer(eligibleRows.reduce((sum, row) => sum + row.balanceCents, 0))) throw conflict();
  let allocations: { installmentId: string; amountCents: number }[];
  if (data.allocations !== undefined) {
    if (!Array.isArray(data.allocations) || !data.allocations.length || data.allocations.length > 100) throw invalidInput();
    const seen = new Set<string>(); allocations = data.allocations.map((rawLine) => {
      const line = inputRecord(rawLine); allowedKeys(line, ["installmentId", "amountCents"]); const id = requireUuid(line.installmentId), amount = integer(line.amountCents, 1);
      if (seen.has(id)) throw invalidInput(); seen.add(id); return { installmentId: id, amountCents: amount };
    });
    if (integer(allocations.reduce((sum, row) => sum + row.amountCents, 0)) !== amountCents) throw invalidInput();
  } else {
    let remaining = amountCents; allocations = [];
    for (const row of eligibleRows) { if (!remaining) break; const amount = Math.min(remaining, row.balanceCents); allocations.push({ installmentId: row.id, amountCents: amount }); remaining -= amount; }
    if (remaining || allocations.length > 100) throw invalidInput("Receba até 100 parcelas por operação.");
  }
  const details = allocations.map((allocation) => {
    const row = eligibleRows.find((entry) => entry.id === allocation.installmentId);
    if (!row || allocation.amountCents > row.balanceCents) throw conflict();
    return { ...allocation, sourceType: row.sourceType, sourceId: row.sourceId, sourceLabel: row.sourceLabel, due: row.due, remainingCents: row.balanceCents - allocation.amountCents };
  });
  integer(await accountBalance(client, accountId) + amountCents);
  const id = randomUUID();
  const receipt = { code: `REC-${id.toUpperCase()}`, companyName: access.tenantName ?? access.tenantId, customerName: customer.name, amountCents, method: data.method, accountName: account.name,
    receivedAt: now.toISOString(), receivedOn: financialDay(now), receivedBy: access.actorId, receivedByName: access.actorName ?? access.actorId, reference,
    tenderedCents, changeCents: tenderedCents - amountCents, allocations: details, remainingCents: outstanding - amountCents };
  await client.query("INSERT INTO finance_payments(id,customer_id,account_id,shift_id,amount_cents,method,reference,at,actor_id,receipt) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [id, customerId, accountId, shiftId, amountCents, data.method, reference, now, access.actorId, JSON.stringify(receipt)]);
  await client.query("INSERT INTO finance_allocations(payment_id,installment_id,amount_cents) SELECT $1,id,amount FROM jsonb_to_recordset($2::jsonb) AS x(id uuid,amount bigint)", [id, JSON.stringify(allocations.map((row) => ({ id: row.installmentId, amount: row.amountCents })))]);
  await client.query("INSERT INTO finance_movements(id,account_id,payment_id,shift_id,amount_cents,at) VALUES($1,$2,$3,$4,$5,$6)", [randomUUID(), accountId, id, shiftId, amountCents, now]);
  const result = await financeEntity(client, "payment", id); await audit(client, access, result, "payment.receive", now); return result;
}
export async function applyFinance(client: PoolClient, access: FinanceAccess, now: Date, type: string, data: Json): Promise<FinanceRecord> {
  if (type === "payment.receive") return receivePayment(client, access, now, data);
  if (type === "account.create") {
    allowedKeys(data, ["name", "type"]); const name = text(data.name, 120); if (!["cash", "bank"].includes(data.type)) throw invalidInput();
    const id = randomUUID(); await client.query("INSERT INTO finance_accounts(id,name,type,created_at,created_by) VALUES($1,$2,$3,$4,$5)", [id, name, data.type, now, access.actorId]);
    const result = await financeEntity(client, "account", id); await audit(client, access, result, type, now); return result;
  }
  if (type === "shift.open") {
    allowedKeys(data, ["accountId"]); const accountId = requireUuid(data.accountId);
    const account = (await client.query("SELECT * FROM finance_accounts WHERE id=$1 AND active=true", [accountId])).rows[0];
    if (!account || account.type !== "cash" || (await client.query("SELECT 1 FROM finance_shifts WHERE account_id=$1 AND status='open'", [accountId])).rowCount) throw conflict();
    const id = randomUUID(); await client.query("INSERT INTO finance_shifts(id,account_id,status,opening_balance_cents,opened_at,opened_by) VALUES($1,$2,'open',$3,$4,$5)", [id, accountId, await accountBalance(client, accountId), now, access.actorId]);
    const result = await financeEntity(client, "shift", id); await audit(client, access, result, type, now); return result;
  }
  if (type === "shift.close") {
    allowedKeys(data, ["id", "version", "countedCents"]); const id = requireUuid(data.id), version = integer(data.version, 1), counted = integer(data.countedCents);
    const row = (await client.query("SELECT * FROM finance_shifts WHERE id=$1", [id])).rows[0]; if (!row) throw notFound();
    if (row.opened_by !== access.actorId) throw forbidden(); if (row.status !== "open" || row.version !== version || +row.opened_at > +now) throw conflict();
    const last = (await client.query("SELECT max(at) AS at FROM finance_movements WHERE shift_id=$1", [row.id])).rows[0].at;
    if (last && +last > +now) throw conflict();
    const expected = await accountBalance(client, row.account_id);
    await client.query("UPDATE finance_shifts SET status='closed',closed_at=$2,closed_by=$3,counted_cents=$4,expected_cents=$5,difference_cents=$6,version=version+1 WHERE id=$1", [id, now, access.actorId, counted, expected, counted - expected]);
    const result = await financeEntity(client, "shift", id); await audit(client, access, result, type, now, { status: "open" }); return result;
  }
  throw invalidInput();
}
function pagination(query: Json) {
  const number = (value: unknown, fallback: number, min: number, max: number) => value === undefined ? fallback : typeof value === "string" && /^\d+$/.test(value) ? integer(Number(value), min, max) : (() => { throw invalidInput(); })();
  return { limit: number(query.limit, 25, 1, 100), offset: number(query.offset, 0, 0, 10000) };
}
export async function readFinance(access: FinanceAccess, resource: string, raw: unknown) {
  financeNeed(access, "finance.read"); const query = inputRecord(raw);
  allowedKeys(query, ["customerId", "accountId", "q", "status", "limit", "offset", "sourceType", "sourceId"]); const page = pagination(query);
  const source = paymentSource(query); if (source && resource !== "installments") throw invalidInput();
  const customerId = query.customerId === undefined ? null : requireUuid(query.customerId), accountId = query.accountId === undefined ? null : requireUuid(query.accountId);
  const q = query.q === undefined ? "" : text(query.q, 100, true), status = query.status ?? "all";
  if (typeof status !== "string" || !["all", "open", "overdue"].includes(status)) throw invalidInput();
  let client: PoolClient | undefined;
  try {
    client = await access.pool.connect(); await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const now = (await client.query("SELECT clock_timestamp() AS at")).rows[0].at as Date, asOf = financialDay(now);
    let result: Json;
    if (resource === "overview") {
      const aggregate = `WITH sums AS (SELECT g.customer_id,sum(i.amount_cents-COALESCE(a.paid,0)) AS outstanding,sum(CASE WHEN i.due<$1::date THEN i.amount_cents-COALESCE(a.paid,0) ELSE 0 END) AS overdue,sum(COALESCE(a.paid,0)) AS paid
        FROM finance_installments i JOIN finance_agreements g ON g.id=i.agreement_id LEFT JOIN (SELECT installment_id,sum(amount_cents) paid FROM finance_allocations GROUP BY installment_id) a ON a.installment_id=i.id GROUP BY g.customer_id)
        SELECT c.id,c.name,s.outstanding::text,s.overdue::text,s.paid::text FROM sums s JOIN customers c ON c.id=s.customer_id WHERE strpos(lower(c.name),lower($2))>0 AND ($3::uuid IS NULL OR c.id=$3) ${status === "open" ? "AND s.outstanding>0" : status === "overdue" ? "AND s.overdue>0" : ""}`;
      const values = [asOf, q, customerId];
      const count = (await client.query(`SELECT count(*)::int AS total FROM (${aggregate}) x`, values)).rows[0].total;
      const rows = (await client.query(`${aggregate} ORDER BY lower(c.name),c.id LIMIT $4 OFFSET $5`, [...values, page.limit, page.offset])).rows;
      const accounts = (await client.query("SELECT a.*,COALESCE(m.balance,0)::text AS balance_cents FROM finance_accounts a LEFT JOIN (SELECT account_id,sum(amount_cents) AS balance FROM finance_movements GROUP BY account_id) m ON m.account_id=a.id ORDER BY lower(a.name),a.id")).rows;
      const shifts = (await client.query("SELECT * FROM finance_shifts WHERE status='open' ORDER BY opened_at,id")).rows;
      const accountDtos = accounts.map((row) => dto(projectFinance("account", row, cents(row.balance_cents))));
      const shiftDtos = shifts.map((row) => dto(projectFinance("shift", row)));
      result = { items: rows.map((row) => ({ id: row.id, customerId: row.id, customerName: row.name, outstandingCents: cents(row.outstanding), overdueCents: cents(row.overdue), paidCents: cents(row.paid) })), total: count, ...page, accounts: accountDtos, shifts: shiftDtos, asOf };
    } else if (resource === "installments") {
      let clauses = "($1::uuid IS NULL OR g.customer_id=$1)" + (status === "open" ? " AND i.amount_cents>COALESCE(p.paid,0)" : status === "overdue" ? " AND i.amount_cents>COALESCE(p.paid,0) AND i.due<$2::date" : "");
      const values: unknown[] = status === "overdue" ? [customerId, asOf] : [customerId];
      if (source) { values.push(source.type, source.id); clauses += ` AND g.source_type=$${values.length - 1} AND g.source_id=$${values.length}::uuid`; }
      const count = (await client.query(`SELECT count(*)::int AS total FROM (${installmentQuery} WHERE ${clauses}) x`, values)).rows[0].total;
      const rows = (await client.query(`${installmentQuery} WHERE ${clauses} ORDER BY i.due,i.created_at,i.id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, page.limit, page.offset])).rows;
      result = { items: rows.map(installmentDto), total: count, ...page };
    } else if (resource === "payments" || resource === "movements") {
      const payments = resource === "payments", table = payments ? "finance_payments" : "finance_movements", column = payments ? "customer_id" : "account_id", value = payments ? customerId : accountId;
      const count = (await client.query(`SELECT count(*)::int AS total FROM ${table} WHERE ($1::uuid IS NULL OR ${column}=$1)`, [value])).rows[0].total;
      const rows = (await client.query(`SELECT * FROM ${table} WHERE ($1::uuid IS NULL OR ${column}=$1) ORDER BY at DESC,id DESC LIMIT $2 OFFSET $3`, [value, page.limit, page.offset])).rows;
      const items = rows.map((row) => payments ? dto(projectFinance("payment", row)) : { id: row.id, accountId: row.account_id, paymentId: row.payment_id, shiftId: row.shift_id, amountCents: cents(row.amount_cents), at: row.at.toISOString() });
      result = { items, total: count, ...page };
    } else if (resource.startsWith("payments/")) result = { payment: dto(await financeEntity(client, "payment", resource.slice(9))) };
    else throw notFound();
    await client.query("COMMIT"); return result;
  } catch (error) {
    if (client) { try { await client.query("ROLLBACK"); } catch { /* preserve error */ } }
    if (error instanceof ApiError) throw error; throw unavailable();
  } finally { client?.release(); }
}
