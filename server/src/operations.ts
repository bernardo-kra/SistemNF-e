import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { buildPurchasePlan, extractProductIdentity, mixedColors, type PurchaseDocument, type ProductAttributes, type PurchasePlan, type SupplierProductLink } from "../../shared/purchase-planner.mjs";
import { allowedKeys, inputRecord, requireUuid } from "./customers.js";
import { ApiError, conflict, forbidden, invalidInput, notFound, unavailable } from "./errors.js";
import type { Permission } from "./permissions.js";
import { applyFinance, createAgreement, financeCommands, financeEntity, financeKinds, financeNeed, receivePayment, type FinanceRecord } from "./finance.js";

type Kind = "product" | "sale" | "order" | "purchase" | "technician" | "link";
type Body = Record<string, any>;
type RecordRow = { entity_type: Kind; id: string; body: Body; version: number; created_at: Date; updated_at: Date; created_by: string; updated_by: string };
type Balance = { product_id: string; physical: number; reserved: number; version: number; updated_at: Date | null; updated_by: string | null };
export type OperationAccess = { tenantId: string; actorId: string; actorName?: string; tenantName?: string; pool: Pool; permissions: Permission[] };
type ResultRow = RecordRow | FinanceRecord;
const resources = { products: "product", sales: "sale", orders: "order", purchases: "purchase", technicians: "technician", stock: "stock" } as const;
const readPermissions: Record<string, Permission> = { product: "products.read", stock: "stock.read", sale: "sales.read", order: "orders.read", purchase: "purchases.read", technician: "orders.read" };
export const commandPermissions: Record<string, Permission> = {
  ...financeCommands, "sale.checkout": "sales.create",
  "product.create": "products.create", "product.update": "products.update", "product.prices": "products.update", "stock.receive": "stock.receive",
  "sale.confirm": "sales.create", "sale.deliver": "sales.deliver", "technician.create": "orders.create",
  "order.create": "orders.create", "order.update": "orders.update", "order.advance": "orders.advance", "order.deliver": "orders.deliver", "purchase.confirm": "purchases.import",
};
export function resourcePermission(resource: string): Permission { const kind = resources[resource as keyof typeof resources]; if (!kind) throw notFound(); return readPermissions[kind]; }
function need(access: OperationAccess, permission: Permission) { if (!access.permissions.includes(permission)) throw forbidden(); }
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Body)[key])}`).join(",")}}`; return JSON.stringify(value); }
function text(value: unknown, max = 120, empty = false): string { if (typeof value !== "string" || value.trim().length > max || (!empty && !value.trim()) || value.includes("\u0000")) throw invalidInput(); return value.trim(); }
function integer(value: unknown, min = 0, max = 1_000_000_000_000): number { if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw invalidInput(); return value as number; }
function total(value: number): number { if (!Number.isSafeInteger(value) || value < 0) throw invalidInput("O total excede o limite suportado."); return value; }
function nullableMoney(value: unknown): number | null { return value === null || value === undefined ? null : integer(value); }
function bool(value: unknown): boolean { if (typeof value !== "boolean") throw invalidInput(); return value; }
function civil(value: unknown): string { const s = text(value, 10); if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(s)) throw invalidInput(); const date = new Date(`${s}T12:00:00Z`); if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== s) throw invalidInput(); return s; }
function attrs(value: unknown = {}): ProductAttributes {
  const input = inputRecord(value); const result: Body = {};
  const strings = ["material", "finish", "color", "border"], booleans = ["magsafe", "lensProtection"], arrays = ["compatibleModels", "connectors"], numbers = ["lengthMeters", "powerWatts"];
  allowedKeys(input, [...strings, ...booleans, ...arrays, ...numbers]);
  for (const key of Object.keys(input)) {
    if (strings.includes(key)) result[key] = text(input[key], 120);
    else if (booleans.includes(key)) result[key] = bool(input[key]);
    else if (arrays.includes(key)) { if (!Array.isArray(input[key]) || input[key].length > 30) throw invalidInput(); result[key] = input[key].map((item: unknown) => text(item, 80)); }
    else { if (typeof input[key] !== "number" || !Number.isFinite(input[key]) || input[key] < 0 || input[key] > 100000) throw invalidInput(); result[key] = input[key]; }
  }
  return result;
}
function document(raw: unknown): PurchaseDocument {
  const input = inputRecord(raw); allowedKeys(input, ["key", "supplierId", "supplierName", "number", "items", "totalCents", "totalsAdjustmentCents"]);
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 500) throw invalidInput();
  const seen = new Set<string>(); let amount = 0;
  const items = input.items.map((rawLine) => {
    const line = inputRecord(rawLine); allowedKeys(line, ["id", "code", "description", "unit", "quantity", "costCents", "ncm", "gtin", "totalCents", "rawQuantity", "rawUnitCost"]);
    const id = text(line.id, 80); if (seen.has(id)) throw invalidInput(); seen.add(id);
    const quantity = integer(line.quantity, 1, 1000000), costCents = integer(line.costCents);
    const value = total(quantity * costCents);
    if (line.totalCents !== undefined && integer(line.totalCents) !== value) throw invalidInput("Confira os totais dos itens.");
    amount = total(amount + value);
    return { id, code: text(line.code, 120), description: text(line.description, 1000), unit: text(line.unit, 16), quantity, costCents,
      ncm: text(line.ncm ?? "", 8, true), ...(line.gtin === undefined ? {} : { gtin: text(line.gtin, 16, true) }), ...(line.totalCents === undefined ? {} : { totalCents: value }) };
  });
  let adjustment: number | undefined;
  if (input.totalsAdjustmentCents !== undefined) adjustment = integer(input.totalsAdjustmentCents, -1_000_000_000_000);
  if (input.totalCents !== undefined && integer(input.totalCents) !== total(amount + (adjustment ?? 0))) throw invalidInput("Confira o total declarado do documento.");
  return { key: text(input.key, 160), supplierId: text(input.supplierId, 160), supplierName: text(input.supplierName, 160), number: text(input.number, 80), items,
    ...(input.totalCents === undefined ? {} : { totalCents: input.totalCents as number }), ...(adjustment === undefined ? {} : { totalsAdjustmentCents: adjustment }) };
}
function compatible(source: ProductAttributes, target: ProductAttributes) {
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (source.compatibleModels?.length && target.compatibleModels?.length && !source.compatibleModels.some((model) => target.compatibleModels?.map(normalize).includes(normalize(model)))) return false;
  for (const key of ["material", "finish", "color", "magsafe", "connectors", "lengthMeters", "powerWatts"] as const)
    if (source[key] !== undefined && target[key] !== undefined && canonical(source[key]).toLowerCase() !== canonical(target[key]).toLowerCase()) return false;
  return true;
}

class Domain {
  numbers: { sale: number; order: number } = { sale: 0, order: 0 };
  records = new Map<string, RecordRow>(); balances = new Map<string, Balance>();
  changed = new Map<string, { before?: RecordRow; after: RecordRow }>(); stockChanged = new Map<string, { before: Balance; after: Balance; reference: string }>();
  constructor(readonly access: OperationAccess, readonly now: Date, rows: RecordRow[], balances: Balance[]) { for (const row of rows) this.records.set(`${row.entity_type}:${row.id}`, row); for (const row of balances) this.balances.set(row.product_id, { ...row, physical: Number(row.physical), reserved: Number(row.reserved) }); }
  all(kind: Kind) { return [...this.records.values()].filter((row) => row.entity_type === kind); }
  nextNumber(kind: "sale" | "order") { return integer(++this.numbers[kind], 1, 2147483646); }
  get(kind: Kind, id: unknown) { const row = this.records.get(`${kind}:${requireUuid(id)}`); if (!row) throw notFound(); return row; }
  put(kind: Kind, body: Body, existing?: RecordRow) {
    if (existing && canonical(existing.body) === canonical(body)) return existing;
    if (this.records.size >= 10000 && !existing) throw new ApiError(409, "CAPACITY_LIMIT", "O limite deste recorte foi atingido.");
    const initial = existing ? this.changed.get(`${kind}:${existing.id}`) : undefined;
    const row: RecordRow = { entity_type: kind, id: existing?.id ?? randomUUID(), body, version: initial && !initial.before ? initial.after.version : existing ? existing.version + 1 : 1,
      created_at: existing?.created_at ?? this.now, updated_at: this.now, created_by: existing?.created_by ?? this.access.actorId, updated_by: this.access.actorId };
    if (row.version >= 2147483647) throw conflict();
    this.records.set(`${kind}:${row.id}`, row); const key = `${kind}:${row.id}`;
    this.changed.set(key, { before: this.changed.has(key) ? this.changed.get(key)!.before : existing, after: row });
    return row;
  }
  balance(id: string): Balance { return this.balances.get(id) ?? { product_id: id, physical: 0, reserved: 0, version: 0, updated_at: null, updated_by: null }; }
  move(id: string, physical: number, reserved: number, reference: string) {
    const previous = this.balance(id), first = this.stockChanged.get(id)?.before ?? previous;
    const next = { ...previous, physical: previous.physical + physical, reserved: previous.reserved + reserved, version: first.version + 1, updated_at: this.now, updated_by: this.access.actorId };
    if (!Number.isSafeInteger(next.physical) || next.physical > 1000000000 || next.physical < next.reserved || next.reserved < 0) throw new ApiError(409, "STOCK_CONFLICT", "O conjunto não possui saldo disponível.");
    this.balances.set(id, next); this.stockChanged.set(id, { before: first, after: next, reference });
  }
  version(row: RecordRow, value: unknown) { if (integer(value, 1, 2147483646) !== row.version) throw conflict(); }
  planner(doc: PurchaseDocument): PurchasePlan {
    return buildPurchasePlan({ products: this.all("product").filter((row) => row.body.active).map((row) => ({ id: row.id, ...row.body })) as any,
      purchasing: { links: this.all("link").map((row) => ({ id: row.id, ...row.body })) as SupplierProductLink[] } }, doc);
  }
  dto(row: ResultRow): Body {
    const body = structuredClone(row.body);
    if (row.entity_type === "product") {
      if (!this.access.permissions.includes("products.cost.read")) delete body.costCents;
      if (this.access.permissions.includes("stock.read")) { const b = this.balance(row.id); body.stock = { physical: b.physical, reserved: b.reserved, available: b.physical - b.reserved, version: b.version }; }
    }
    return { id: row.id, ...body, version: row.version, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), createdBy: row.created_by, updatedBy: row.updated_by };
  }
}

type Scope = { where: string; values?: unknown[] };
async function transact<T>(access: OperationAccess, write: boolean, work: (client: PoolClient, domain: Domain) => Promise<T>, scope: Scope | ((client: PoolClient) => Promise<Scope>) = { where: "false" }): Promise<T> {
  let client: PoolClient | undefined;
  try {
    client = await access.pool.connect(); await client.query(write ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    let coordination: { sale_number: number; order_number: number } | undefined;
    if (write) { coordination = (await client.query("SELECT sale_number,order_number FROM operational_coordination WHERE id=1 FOR UPDATE")).rows[0]; if (!coordination) throw unavailable(); }
    const now = (await client.query("SELECT clock_timestamp() AS at")).rows[0].at as Date;
    const selected = typeof scope === "function" ? await scope(client) : scope;
    const records = selected.where === "false" ? { rows: [] as RecordRow[] } : await client.query<RecordRow>(`SELECT * FROM operational_records WHERE ${selected.where}`, selected.values);
    const productIds = [...new Set(records.rows.flatMap((row) => row.entity_type === "product" ? [row.id] : row.entity_type === "sale" ? row.body.items.map((item: Body) => item.productId) : []))];
    const balances = productIds.length ? await client.query<Balance>("SELECT * FROM stock_balances WHERE product_id=ANY($1::uuid[])", [productIds]) : { rows: [] as Balance[] };
    const domain = new Domain(access, now, records.rows, balances.rows); if (coordination) domain.numbers = { sale: coordination.sale_number, order: coordination.order_number };
    const result = await work(client, domain);
    await client.query("COMMIT"); return result;
  } catch (error) {
    if (client) { try { await client.query("ROLLBACK"); } catch { /* preserve controlled error */ } }
    if (error instanceof ApiError) throw error;
    throw unavailable();
  } finally { client?.release(); }
}

async function customer(client: PoolClient, id: unknown) {
  const found = await client.query("SELECT id,name,phone FROM customers WHERE id=$1 AND active=true", [requireUuid(id)]);
  if (!found.rows[0]) throw notFound(); return found.rows[0];
}
function productBody(input: Body, old?: Body): Body {
  const fields = ["sku", "name", "category", "unit", "costCents", "salePriceCents", "serialized", "active", "attributes", "gtin", "ncm"];
  allowedKeys(input, old ? ["id", "version", ...fields] : fields);
  const combined: Body = { category: "Geral", unit: "UN", costCents: null, salePriceCents: null, serialized: false, active: true, attributes: {}, gtin: "", ncm: "", ...old, ...input };
  const sku = !old && (input.sku === undefined || (typeof input.sku === "string" && !input.sku.trim())) ? `AUTO-${randomUUID()}` : combined.sku;
  return { sku: text(sku, 80), name: text(combined.name, 160), category: text(combined.category, 80), unit: text(combined.unit, 16), costCents: nullableMoney(combined.costCents), salePriceCents: nullableMoney(combined.salePriceCents), serialized: bool(combined.serialized), active: bool(combined.active), attributes: attrs(!old && input.attributes === undefined ? extractProductIdentity(combined.name).attributes : combined.attributes), gtin: text(combined.gtin, 16, true), ncm: text(combined.ncm, 8, true) };
}
function putProduct(domain: Domain, input: Body, old?: RecordRow) {
  if (Object.hasOwn(input, "costCents")) need(domain.access, "products.cost.read");
  if (Object.hasOwn(input, "active") && old) need(domain.access, "products.archive");
  const body = productBody(input, old?.body);
  if (domain.all("product").some((row) => row.id !== old?.id && row.body.sku.toLowerCase() === body.sku.toLowerCase())) throw new ApiError(409, "DUPLICATE_SKU", "O SKU já está cadastrado.");
  return domain.put("product", body, old);
}
function identityFields(body: Body, permitted: string[]) { return Object.fromEntries(permitted.filter((key) => Object.hasOwn(body, key)).map((key) => [key, body[key]])); }
const auditValues: Record<Kind, string[]> = { product: ["sku", "name", "category", "unit", "costCents", "salePriceCents", "active", "serialized", "attributes", "gtin", "ncm"], sale: ["status", "grossCents", "discountCents", "totalCents"], order: ["stage", "technicianId", "laborCents", "approved", "tested", "due"], purchase: ["status"], technician: [], link: [] };

async function persist(client: PoolClient, domain: Domain, requestId: string, type: string, fingerprint: string, result: ResultRow) {
  await client.query("UPDATE operational_coordination SET sale_number=$1,order_number=$2 WHERE id=1", [domain.numbers.sale, domain.numbers.order]);
  const rows = [...domain.changed.values()].map(({ after: row }) => ({ ...row, created_at: row.created_at.toISOString(), updated_at: row.updated_at.toISOString() }));
  if (rows.length) await client.query(`INSERT INTO operational_records SELECT entity_type,id,body,version,created_at,updated_at,created_by,updated_by FROM jsonb_to_recordset($1::jsonb) AS x(entity_type text,id uuid,body jsonb,version integer,created_at timestamptz,updated_at timestamptz,created_by text,updated_by text) ON CONFLICT(entity_type,id) DO UPDATE SET body=excluded.body,version=excluded.version,updated_at=excluded.updated_at,updated_by=excluded.updated_by`, [JSON.stringify(rows)]);
  const stockRows = [...domain.stockChanged.values()].map(({ after: b }) => ({ ...b, updated_at: b.updated_at?.toISOString() }));
  if (stockRows.length) await client.query(`INSERT INTO stock_balances SELECT product_id,physical,reserved,version,updated_at,updated_by FROM jsonb_to_recordset($1::jsonb) AS x(product_id uuid,physical bigint,reserved bigint,version integer,updated_at timestamptz,updated_by text) ON CONFLICT(product_id) DO UPDATE SET physical=excluded.physical,reserved=excluded.reserved,version=excluded.version,updated_at=excluded.updated_at,updated_by=excluded.updated_by`, [JSON.stringify(stockRows)]);
  const events: Body[] = [...domain.changed.values()].map(({ before, after }) => ({ id: randomUUID(), tenant_id: domain.access.tenantId, actor_id: domain.access.actorId, action: type, entity_type: after.entity_type, entity_id: after.id, entity_version: after.version, at: domain.now.toISOString(), field_names: Object.keys(after.body).filter((key) => !before || canonical(before.body[key]) !== canonical(after.body[key])), before_values: identityFields(before?.body ?? {}, auditValues[after.entity_type]), after_values: identityFields(after.body, auditValues[after.entity_type]) }));
  for (const { before, after } of domain.stockChanged.values()) events.push({ id: randomUUID(), tenant_id: domain.access.tenantId, actor_id: domain.access.actorId, action: type, entity_type: "stock", entity_id: after.product_id, entity_version: after.version, at: domain.now.toISOString(), field_names: ["physical", "reserved"], before_values: { physical: before.physical, reserved: before.reserved }, after_values: { physical: after.physical, reserved: after.reserved } });
  if (events.length) await client.query(`INSERT INTO audit_events(id,tenant_id,actor_id,action,entity_type,entity_id,entity_version,at,field_names,before_values,after_values) SELECT id,tenant_id,actor_id,action,entity_type,entity_id,entity_version,at,field_names,before_values,after_values FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,tenant_id uuid,actor_id text,action text,entity_type text,entity_id uuid,entity_version integer,at timestamptz,field_names text[],before_values jsonb,after_values jsonb)`, [JSON.stringify(events)]);
  const movements = [...domain.stockChanged.values()].map(({ before, after, reference }) => ({ id: randomUUID(), request_id: requestId, product_id: after.product_id, physical_delta: after.physical - before.physical, reserved_delta: after.reserved - before.reserved, reference, at: domain.now.toISOString() }));
  if (movements.length) await client.query(`INSERT INTO stock_movements SELECT id,request_id,product_id,physical_delta,reserved_delta,reference,at FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,request_id uuid,product_id uuid,physical_delta bigint,reserved_delta bigint,reference text,at timestamptz)`, [JSON.stringify(movements)]);
  await client.query("INSERT INTO operational_requests(id,command,fingerprint,entity_type,entity_id) VALUES($1,$2,$3,$4,$5)", [requestId, type, fingerprint, result.entity_type, result.id]);
}

async function apply(client: PoolClient, domain: Domain, type: string, data: Body): Promise<ResultRow> {
  const access = domain.access;
  if (type === "sale.checkout") {
    allowedKeys(data, ["customerId", "items", "deliver", "terms", "payment"]);
    if (typeof data.deliver !== "boolean") throw invalidInput();
    const sale = await apply(client, domain, "sale.confirm", { customerId: data.customerId, items: data.items }) as RecordRow;
    const agreement = await createAgreement(client, access, domain.now, { id: sale.id, type: "sale", number: sale.body.number, customerId: sale.body.customerId, customerName: sale.body.customerName, amountCents: sale.body.totalCents }, data.terms);
    let payment: FinanceRecord | undefined;
    if (data.payment !== undefined) {
      const input = inputRecord(data.payment), terms = inputRecord(data.terms);
      allowedKeys(input, ["amountCents", "method", "accountId", "shiftId", "reference", "creditConfirmed", "tenderedCents"]);
      if (input.amountCents !== terms.downPaymentCents || !input.amountCents) throw invalidInput("O recebimento deve corresponder à entrada.");
      const down = (await client.query("SELECT id FROM finance_installments WHERE agreement_id=$1 AND kind='down_payment'", [agreement.id])).rows[0];
      if (!down) throw invalidInput();
      payment = await receivePayment(client, access, domain.now, { ...input, customerId: sale.body.customerId, allocations: [{ installmentId: down.id, amountCents: input.amountCents }] });
    }
    if (data.deliver) for (const item of sale.body.items) domain.move(item.productId, -item.quantity, -item.quantity, "Venda com entrega imediata");
    return domain.put("sale", { ...sale.body, status: data.deliver ? "delivered" : "confirmed", financeStatus: "integrated", agreementId: agreement.id, ...(payment ? { checkoutPaymentId: payment.id } : {}) }, sale);
  }
  if (type === "agreement.create") {
    allowedKeys(data, ["sourceType", "sourceId", "sourceVersion", "downPaymentCents", "downPaymentDue", "installmentCount", "firstDue", "installmentDueDates"]);
    if (!["sale", "order"].includes(data.sourceType)) throw invalidInput();
    const kind = data.sourceType as "sale" | "order", row = domain.get(kind, data.sourceId); domain.version(row, data.sourceVersion);
    if (kind === "order" && !row.body.approved) throw conflict();
    financeNeed(access, kind === "order" ? "orders.read" : "sales.read");
    const { sourceType: _type, sourceId: _id, sourceVersion: _version, ...terms } = data;
    const agreement = await createAgreement(client, access, domain.now, { id: row.id, type: kind, number: row.body.number, customerId: row.body.customerId, customerName: row.body.customerName, amountCents: kind === "sale" ? row.body.totalCents : row.body.laborCents }, terms);
    domain.put(kind, { ...row.body, financeStatus: "integrated", agreementId: agreement.id }, row); return agreement;
  }
  if (financeCommands[type]) return applyFinance(client, access, domain.now, type, data);
  if (type === "product.create") return putProduct(domain, data);
  if (type === "product.update") { const row = domain.get("product", data.id); domain.version(row, data.version); return putProduct(domain, data, row); }
  if (type === "product.prices") {
    allowedKeys(data, ["items"]); if (!Array.isArray(data.items) || !data.items.length || data.items.length > 500) throw invalidInput();
    const seen = new Set<string>(); let result: RecordRow | undefined;
    for (const input of data.items) { const item = inputRecord(input); allowedKeys(item, ["id", "version", "salePriceCents"]); const row = domain.get("product", item.id); if (seen.has(row.id)) throw invalidInput(); seen.add(row.id); domain.version(row, item.version); result = putProduct(domain, { id: row.id, version: row.version, salePriceCents: integer(item.salePriceCents) }, row); }
    return result!;
  }
  if (type === "stock.receive") {
    allowedKeys(data, ["productId", "quantity", "reference"]); const row = domain.get("product", data.productId);
    const quantity = integer(data.quantity, 1, 1000000), reference = text(data.reference, 160);
    if (row.body.serialized || !row.body.active) throw conflict();
    domain.move(row.id, quantity, 0, reference); return row;
  }
  if (type === "sale.confirm") {
    allowedKeys(data, ["customerId", "items"]); const buyer = await customer(client, data.customerId);
    if (!Array.isArray(data.items) || !data.items.length || data.items.length > 100) throw invalidInput();
    const grouped = new Map<string, Body>();
    for (const value of data.items) {
      const item = inputRecord(value); allowedKeys(item, ["productId", "quantity", "version", "discountCents"]);
      const product = domain.get("product", item.productId); domain.version(product, item.version); const quantity = integer(item.quantity, 1, 1000000);
      if (!product.body.active || product.body.serialized || product.body.salePriceCents === null) throw conflict();
      const grossCents = total(quantity * product.body.salePriceCents), discountCents = item.discountCents === undefined ? 0 : integer(item.discountCents, 0, grossCents);
      if (discountCents > 0) need(access, "sales.discount");
      const previous = grouped.get(product.id);
      grouped.set(product.id, { productId: product.id, name: product.body.name, quantity: integer((previous?.quantity ?? 0) + quantity, 1, 1000000), unitPriceCents: product.body.salePriceCents,
        grossCents: total((previous?.grossCents ?? 0) + grossCents), discountCents: total((previous?.discountCents ?? 0) + discountCents), totalCents: total((previous?.totalCents ?? 0) + grossCents - discountCents) });
    }
    const items = [...grouped.values()]; let amount = 0, grossCents = 0, discountCents = 0;
    for (const item of items) { amount = total(amount + item.totalCents); grossCents = total(grossCents + item.grossCents); discountCents = total(discountCents + item.discountCents); domain.move(item.productId, 0, item.quantity, "Reserva de venda"); }
    return domain.put("sale", { number: domain.nextNumber("sale"), customerId: buyer.id, customerName: buyer.name, items, grossCents, discountCents, totalCents: amount, status: "confirmed", financeStatus: "not_integrated" });
  }
  if (type === "sale.deliver") {
    allowedKeys(data, ["id", "version"]); const row = domain.get("sale", data.id); if (row.body.status === "delivered") return row; domain.version(row, data.version);
    for (const item of row.body.items) domain.move(item.productId, -item.quantity, -item.quantity, "Entrega de venda");
    return domain.put("sale", { ...row.body, status: "delivered" }, row);
  }
  if (type === "technician.create") {
    allowedKeys(data, ["name"]); const name = text(data.name); return domain.all("technician").find((row) => row.body.name.toLowerCase() === name.toLowerCase()) ?? domain.put("technician", { name });
  }
  if (type === "order.create") {
    allowedKeys(data, ["customerId", "technicianId", "equipment", "issue", "due", "laborCents"]); const buyer = await customer(client, data.customerId), technician = domain.get("technician", data.technicianId);
    return domain.put("order", { number: domain.nextNumber("order"), customerId: buyer.id, customerName: buyer.name, customerPhone: buyer.phone, technicianId: technician.id, technicianName: technician.body.name, equipment: text(data.equipment, 160), issue: text(data.issue, 2000), diagnosis: "", due: civil(data.due), laborCents: integer(data.laborCents), approved: false, tested: false, stage: "received", financeStatus: "not_integrated" });
  }
  if (type.startsWith("order.")) {
    const row = domain.get("order", data.id); domain.version(row, data.version);
    if (row.body.stage === "delivered") throw conflict();
    if (type === "order.update") {
      allowedKeys(data, ["id", "version", "technicianId", "diagnosis", "due", "laborCents", "approved", "tested"]); const next = { ...row.body };
      if (row.body.agreementId && ((data.approved !== undefined && data.approved !== row.body.approved) || (data.laborCents !== undefined && data.laborCents !== row.body.laborCents))) throw conflict();
      if (data.technicianId !== undefined) { const technician = domain.get("technician", data.technicianId); next.technicianId = technician.id; next.technicianName = technician.body.name; }
      if (data.diagnosis !== undefined) next.diagnosis = text(data.diagnosis, 4000, true);
      if (data.due !== undefined) next.due = civil(data.due);
      if (data.laborCents !== undefined) { const amount = integer(data.laborCents); if (row.body.approved && amount !== row.body.laborCents) throw conflict(); next.laborCents = amount; }
      if (data.approved !== undefined) { if (row.body.stage !== "awaiting_approval") throw conflict(); next.approved = bool(data.approved); }
      if (data.tested !== undefined) { if (row.body.stage !== "quality_check") throw conflict(); next.tested = bool(data.tested); }
      return domain.put("order", next, row);
    }
    if (type === "order.advance") {
      allowedKeys(data, ["id", "version"]); const stages = ["received", "diagnosing", "awaiting_approval", "in_progress", "quality_check", "ready_for_pickup"];
      const index = stages.indexOf(row.body.stage);
      if (index < 0 || index === stages.length - 1 || (row.body.stage === "awaiting_approval" && !row.body.approved) || (row.body.stage === "quality_check" && !row.body.tested)) throw conflict();
      return domain.put("order", { ...row.body, stage: stages[index + 1] }, row);
    }
    allowedKeys(data, ["id", "version", "allowUnsettled"]);
    if (row.body.stage !== "ready_for_pickup" || !row.body.approved || !row.body.tested || data.allowUnsettled !== true) throw new ApiError(409, "DELIVERY_CHECK_REQUIRED", "Confirme a entrega sem conferência financeira integrada.");
    return domain.put("order", { ...row.body, stage: "delivered" }, row);
  }
  if (type === "purchase.confirm") return purchase(domain, data);
  throw invalidInput();
}

function purchase(domain: Domain, data: Body): RecordRow {
  allowedKeys(data, ["document", "decisions", "receive"]); const doc = document(data.document), decisions = inputRecord(data.decisions), receive = bool(data.receive);
  if (receive) { need(domain.access, "purchases.receive"); need(domain.access, "stock.receive"); }
  allowedKeys(decisions, doc.items.map((item) => item.id));
  const old = domain.all("purchase").find((row) => row.body.document.key === doc.key && row.body.document.supplierId === doc.supplierId);
  if (old && canonical(old.body.document) !== canonical(doc)) throw conflict();
  const plan = domain.planner(doc); const lines: Body[] = [], groups = new Map<string, RecordRow>(); let anyReceived = false;
  for (const planned of plan.lines) {
    const source = planned.source, previous = old?.body.lines.find((line: Body) => line.source.id === source.id);
    const decision = decisions[source.id] === undefined ? {} : inputRecord(decisions[source.id]);
    allowedKeys(decision, ["action", "productId", "conversion", "receivedQuantity", "priceCents", "name", "category", "attributes"]);
    const action = decision.action ?? previous?.action ?? (planned.resolution === "known" ? "link" : planned.resolution === "new" ? "new" : undefined);
    if (!["link", "new", "ignore"].includes(action as string)) throw new ApiError(409, "PURCHASE_REVIEW_REQUIRED", "Resolva somente os itens com dúvida antes de confirmar.");
    if (action === "ignore") { if (previous && previous.action !== "ignore") throw conflict(); lines.push({ source, action, conversion: 1, receivedQuantity: 0 }); continue; }
    const conversion = decision.conversion === undefined ? previous?.conversion ?? planned.conversion : integer(decision.conversion, 1, 1000000);
    let product: RecordRow;
    if (previous?.productId) product = domain.get("product", previous.productId);
    else if (action === "link") product = domain.get("product", decision.productId ?? planned.productId);
    else {
      need(domain.access, "products.create"); const attributes = attrs(decision.attributes ?? planned.attributes), name = text(decision.name ?? planned.name, 160), category = text(decision.category ?? planned.category, 80);
      const group = canonical({ name, category, attributes, unit: "UN", cost: Math.floor((source.costCents + Math.floor(conversion / 2)) / conversion), price: decision.priceCents ?? null });
      product = groups.get(group) ?? putProduct(domain, { sku: `AUTO-${randomUUID().slice(0, 12)}`, name, category, unit: "UN", attributes, gtin: source.gtin ?? "", ncm: source.ncm, costCents: Math.floor((source.costCents + Math.floor(conversion / 2)) / conversion), salePriceCents: nullableMoney(decision.priceCents) });
      groups.set(group, product);
    }
    if (previous && (action !== previous.action || conversion !== previous.conversion || (decision.productId && decision.productId !== previous.productId))) throw conflict();
    const unitKey = (unit: string) => unit.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/^(unidade|unidades|und|unid|pc|peca)$/, "un");
    if (!previous && planned.resolution !== "known" && decision.conversion === undefined && unitKey(source.unit) !== unitKey(product.body.unit)) throw new ApiError(409, "PURCHASE_REVIEW_REQUIRED", "Informe a conversão da embalagem.");
    if (!compatible(extractProductIdentity(source.description).attributes, product.body.attributes ?? {})) throw conflict();
    if (!product.body.active || (receive && (product.body.serialized || mixedColors(source.description)))) throw conflict();
    const receivedBefore = previous?.receivedQuantity ?? 0;
    const incoming = receive ? decision.receivedQuantity === undefined ? source.quantity - receivedBefore : integer(decision.receivedQuantity, 0, 1000000) : 0;
    if (receivedBefore + incoming > source.quantity || incoming < 0) throw conflict();
    if (incoming) { domain.move(product.id, integer(incoming * conversion, 1, 1000000), 0, `Recebimento ${doc.number}`); anyReceived = true; }
    const link = domain.all("link").find((row) => row.body.supplierId === doc.supplierId && row.body.supplierCode === source.code && row.body.unit.toUpperCase() === source.unit.toUpperCase());
    const linkBody = { supplierId: doc.supplierId, supplierCode: source.code, unit: source.unit, productId: product.id, description: source.description, conversion, attributes: attrs(product.body.attributes), confirmedAt: link?.body.confirmedAt ?? domain.now.toISOString(), ...(source.gtin ? { gtin: source.gtin } : {}) };
    if (link && link.body.productId !== product.id) throw conflict(); domain.put("link", linkBody, link);
    lines.push({ source, action, productId: product.id, conversion, receivedQuantity: receivedBefore + incoming });
  }
  if (receive && !anyReceived) throw conflict();
  const included = lines.filter((line) => line.action !== "ignore"), status = included.length && included.every((line) => line.receivedQuantity === line.source.quantity) ? "received" : included.some((line) => line.receivedQuantity > 0) ? "partial" : "pending";
  return domain.put("purchase", { document: doc, supplierName: doc.supplierName, number: doc.number, lines, status, financeStatus: "not_integrated" }, old);
}

export async function executeOperation(access: OperationAccess, raw: unknown) {
  const input = inputRecord(raw); allowedKeys(input, ["requestId", "type", "data"]);
  const requestId = requireUuid(input.requestId), type = text(input.type, 40), data = inputRecord(input.data);
  const permission = commandPermissions[type]; if (!permission) throw invalidInput(); need(access, permission);
  if (type === "sale.checkout") { need(access, "finance.agreements.create"); if (data.deliver === true) need(access, "sales.deliver"); if (data.payment !== undefined) need(access, "finance.receive"); }
  // Revalidate discount authority before replay; an old request is not a lasting grant.
  if (["sale.confirm", "sale.checkout"].includes(type) && Array.isArray(data.items)) {
    for (const item of data.items) {
      const discount = inputRecord(item).discountCents;
      if (discount !== undefined && integer(discount, 0, Number.MAX_SAFE_INTEGER) > 0) need(access, "sales.discount");
    }
  }
  if (type === "agreement.create") { if (data.sourceType === "order") need(access, "orders.read"); else if (data.sourceType === "sale") need(access, "sales.read"); }
  const fingerprint = createHash("sha256").update(canonical({ type, data })).digest("hex");
  let previous: Body | undefined;
  return transact(access, true, async (client, domain) => {
    if (previous) {
      const row = financeKinds.includes(previous.entity_type) ? await financeEntity(client, previous.entity_type, previous.entity_id) : domain.get(previous.entity_type, previous.entity_id);
      // Replays still require the currently applicable compound permissions.
      if (type === "purchase.confirm" && data.receive) { need(access, "purchases.receive"); need(access, "stock.receive"); }
      if (Object.hasOwn(data, "costCents")) need(access, "products.cost.read");
      if (type === "product.update" && Object.hasOwn(data, "active")) need(access, "products.archive");
      return { entityType: row.entity_type, entity: domain.dto(row) };
    }
    const row = await apply(client, domain, type, data); await persist(client, domain, requestId, type, fingerprint, row);
    return { entityType: row.entity_type, entity: domain.dto(row) };
  }, async (client) => {
    previous = (await client.query("SELECT command,fingerprint,entity_type,entity_id FROM operational_requests WHERE id=$1", [requestId])).rows[0];
    if (previous) { if (previous.command !== type || previous.fingerprint !== fingerprint) throw conflict(); return { where: "entity_type=$1 AND id=$2", values: [previous.entity_type, previous.entity_id] }; }
    if (type.startsWith("product.")) return { where: "entity_type='product'" };
    if (type === "stock.receive") return { where: "entity_type='product' AND id=$1", values: [requireUuid(data.productId)] };
    if (type === "sale.confirm" || type === "sale.checkout") {
      if (!Array.isArray(data.items) || !data.items.length || data.items.length > 100) throw invalidInput();
      return { where: "entity_type='product' AND id=ANY($1::uuid[])", values: [data.items.map((item: unknown) => requireUuid(inputRecord(item).productId))] };
    }
    if (type === "sale.deliver") return { where: "entity_type='sale' AND id=$1", values: [requireUuid(data.id)] };
    if (type === "technician.create") return { where: "entity_type='technician'" };
    if (type === "order.create") return { where: "entity_type='technician' AND id=$1", values: [requireUuid(data.technicianId)] };
    if (type.startsWith("order.")) return { where: "(entity_type='order' AND id=$1) OR (entity_type='technician' AND id=$2)", values: [requireUuid(data.id), data.technicianId === undefined ? null : requireUuid(data.technicianId)] };
    if (type === "agreement.create") { if (data.sourceType !== "sale" && data.sourceType !== "order") throw invalidInput(); return { where: "entity_type=$1 AND id=$2", values: [data.sourceType, requireUuid(data.sourceId)] }; }
    if (financeCommands[type]) return { where: "false" };
    const doc = document(data.document);
    return { where: "entity_type='product' OR (entity_type='link' AND body->>'supplierId'=$1) OR (entity_type='purchase' AND body->'document'->>'supplierId'=$1 AND body->'document'->>'key'=$2)", values: [doc.supplierId, doc.key] };
  });
}

export async function purchasePlan(access: OperationAccess, raw: unknown) {
  need(access, "purchases.import"); const input = inputRecord(raw); allowedKeys(input, ["document"]); const doc = document(input.document);
  return transact(access, false, async (_client, domain) => {
    const plan = domain.planner(doc), ids = new Set(plan.lines.flatMap((line) => line.candidates));
    const candidates = domain.all("product").filter((row) => ids.has(row.id)).map((row) => ({ id: row.id, name: row.body.name as string, sku: row.body.sku as string }));
    return { plan, candidates };
  }, { where: "entity_type='product' OR (entity_type='link' AND body->>'supplierId'=$1)", values: [doc.supplierId] });
}

function pagination(query: Body) {
  const parse = (raw: unknown, fallback: number, min: number, max: number) => raw === undefined ? fallback : typeof raw === "string" && /^\d+$/.test(raw) ? integer(Number(raw), min, max) : (() => { throw invalidInput(); })();
  return { limit: parse(query.limit, 25, 1, 100), offset: parse(query.offset, 0, 0, 10000) };
}
export async function listOperations(access: OperationAccess, resource: string, raw: unknown) {
  const kind = resources[resource as keyof typeof resources]; if (!kind) throw notFound(); need(access, readPermissions[kind]);
  const query = inputRecord(raw); allowedKeys(query, ["q", "code", "status", "sort", "dateField", "from", "to", "limit", "offset"]); const page = pagination(query);
  if (query.code !== undefined && kind !== "product") throw invalidInput();
  const code = query.code === undefined ? undefined : text(query.code, 100);
  const q = query.q === undefined ? "" : text(query.q, 100, true).toLowerCase();
  const sort = query.sort ?? "name", dateField = query.dateField ?? "created";
  if (!["name", "created", "updated"].includes(sort as string) || !["created", "updated"].includes(dateField as string)) throw invalidInput();
  const from = query.from === undefined ? undefined : civil(query.from), to = query.to === undefined ? undefined : civil(query.to);
  if (from && to && from > to) throw invalidInput();
  const status = query.status === undefined ? "all" : text(query.status, 40);
  const statuses: Record<string, string[]> = { product: ["all", "active", "inactive", "pending", "low"], stock: ["all", "available", "reserved"], sale: ["all", "confirmed", "delivered"], order: ["all", "received", "diagnosing", "awaiting_approval", "in_progress", "quality_check", "ready_for_pickup", "delivered"], purchase: ["all", "pending", "partial", "received"], technician: ["all"] };
  if (!statuses[kind].includes(status)) throw invalidInput();
  if (kind === "product" && status === "low") need(access, "stock.read");
  // Filter and page in PostgreSQL: opening Products must not read every invoice and OS.
  const values: unknown[] = [kind === "stock" ? "product" : kind, q];
  const clauses = ["r.entity_type=$1", "strpos(lower(concat_ws(' ',r.body->>'name',r.body->>'sku',r.body->>'gtin',r.body->>'number',r.body->>'customerName',r.body->>'equipment',r.body->>'supplierName')),lower($2))>0"];
  if (code !== undefined) { values.push(code); clauses.push(`(lower(r.body->>'sku')=lower($${values.length}) OR r.body->>'gtin'=$${values.length})`); }
  const available = "COALESCE(b.physical,0)-COALESCE(b.reserved,0)";
  if (kind === "product" && status !== "all") clauses.push(status === "active" ? "(r.body->>'active')::boolean=true" : status === "inactive" ? "(r.body->>'active')::boolean=false" : status === "pending" ? "r.body->>'salePriceCents' IS NULL" : `${available}<=0`);
  else if (kind === "stock" && status !== "all") clauses.push(status === "available" ? `${available}>0` : "COALESCE(b.reserved,0)>0");
  else if (status !== "all") { values.push(status); clauses.push(`r.body->>'${kind === "order" ? "stage" : "status"}'=$${values.length}`); }
  const updatedColumn = kind === "stock" ? "b.updated_at" : "r.updated_at", dateColumn = dateField === "created" ? "r.created_at" : updatedColumn;
  if (from) { values.push(from); clauses.push(`${dateColumn}>=($${values.length}::date::timestamp AT TIME ZONE 'America/Sao_Paulo')`); }
  if (to) { values.push(to); clauses.push(`${dateColumn}<(($${values.length}::date+INTERVAL '1 day')::timestamp AT TIME ZONE 'America/Sao_Paulo')`); }
  const where = clauses.join(" AND "), join = "FROM operational_records r LEFT JOIN stock_balances b ON r.entity_type='product' AND b.product_id=r.id";
  const order = sort === "name" ? "lower(COALESCE(r.body->>'name',r.body->>'number','')),r.id" : `${sort === "created" ? "r.created_at" : updatedColumn} DESC NULLS LAST,r.id`;
  return transact(access, false, async (client, empty) => {
    const count = await client.query(`SELECT count(*)::int AS total ${join} WHERE ${where}`, values);
    const selected = await client.query<RecordRow & { physical: string | null; reserved: string | null; balance_version: number | null; balance_updated_at: Date | null; balance_updated_by: string | null }>(
      `SELECT r.entity_type,r.id,CASE WHEN r.entity_type='purchase' THEN (r.body-'lines'-'document')||jsonb_build_object('document',(r.body->'document')-'items') ELSE r.body END AS body,r.version,r.created_at,r.updated_at,r.created_by,r.updated_by,b.physical,b.reserved,b.version AS balance_version,b.updated_at AS balance_updated_at,b.updated_by AS balance_updated_by ${join} WHERE ${where} ORDER BY ${order} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, page.limit, page.offset]);
    const balances = selected.rows.filter((row) => row.entity_type === "product").map((row) => ({ product_id: row.id, physical: Number(row.physical ?? 0), reserved: Number(row.reserved ?? 0), version: row.balance_version ?? 0, updated_at: row.balance_updated_at, updated_by: row.balance_updated_by }));
    const domain = new Domain(access, empty.now, selected.rows, balances);
    const agreementIds = access.permissions.includes("finance.read") ? selected.rows.filter((row) => row.body.agreementId).map((row) => row.body.agreementId) : [];
    const summaries = agreementIds.length ? (await client.query("SELECT g.id,g.principal_cents::text AS principal,COALESCE(sum(a.amount_cents),0)::text AS paid FROM finance_agreements g LEFT JOIN finance_installments i ON i.agreement_id=g.id LEFT JOIN finance_allocations a ON a.installment_id=i.id WHERE g.id=ANY($1::uuid[]) GROUP BY g.id", [agreementIds])).rows : [];
    const financeById = new Map(summaries.map((row) => [row.id, { agreementId: row.id, paidCents: integer(Number(row.paid)), outstandingCents: integer(Number(row.principal) - Number(row.paid)) }]));
    const items = selected.rows.map((row) => {
      if (kind !== "stock") return { ...domain.dto(row), ...(financeById.has(row.body.agreementId) ? { finance: financeById.get(row.body.agreementId) } : {}) };
      const balance = domain.balance(row.id); return { productId: row.id, id: row.id, name: row.body.name, sku: row.body.sku, physical: balance.physical, reserved: balance.reserved, available: balance.physical - balance.reserved, version: balance.version, createdAt: row.created_at.toISOString(), updatedAt: balance.updated_at?.toISOString() ?? null, updatedBy: balance.updated_by };
    });
    return { items, total: count.rows[0].total, ...page };
  });
}

export async function operationHistory(access: OperationAccess, raw: unknown) {
  need(access, "audit.read"); const query = inputRecord(raw); allowedKeys(query, ["entityType", "id", "limit", "offset"]);
  const kind = text(query.entityType, 20), financial = financeKinds.includes(kind);
  if (!["product", "stock", "sale", "order", "purchase", ...financeKinds].includes(kind)) throw invalidInput();
  need(access, financial ? "finance.read" : readPermissions[kind]);
  const id = requireUuid(query.id), page = pagination(query);
  return transact(access, false, async (client, domain) => {
    if (financial) await financeEntity(client, kind, id); else domain.get(kind === "stock" ? "product" : kind as Kind, id);
    const result = await client.query("SELECT id,entity_type,entity_id,entity_version,action,actor_id,at,field_names,before_values,after_values FROM audit_events WHERE tenant_id=$1 AND entity_type=$2 AND entity_id=$3 ORDER BY at DESC,id DESC LIMIT $4 OFFSET $5", [access.tenantId, kind, id, page.limit, page.offset]);
    const count = await client.query("SELECT count(*)::int AS total FROM audit_events WHERE tenant_id=$1 AND entity_type=$2 AND entity_id=$3", [access.tenantId, kind, id]);
    return { items: result.rows.map((row) => {
      const before = { ...row.before_values }, after = { ...row.after_values };
      const fields = (row.field_names as string[]).filter((key) => access.permissions.includes("products.cost.read") || key !== "costCents");
      if (!access.permissions.includes("products.cost.read")) { delete before.costCents; delete after.costCents; }
      return { id: row.id, entityType: row.entity_type, entityId: row.entity_id, version: row.entity_version, action: row.action, actorId: row.actor_id, at: row.at.toISOString(), fields, before, after };
    }), total: count.rows[0].total, ...page };
  }, financial ? { where: "false" } : { where: "entity_type=$1 AND id=$2", values: [kind === "stock" ? "product" : kind, id] });
}
