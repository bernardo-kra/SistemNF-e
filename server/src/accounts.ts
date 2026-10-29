import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { ApiConfig } from "./config.js";
import { createAuth } from "./auth.js";
import { allowedKeys, inputRecord, requireUuid } from "./customers.js";
import { ApiError, conflict, forbidden, invalidInput, notFound, unavailable } from "./errors.js";
import { assignablePermissions, customerPermissions, operationalPermissions, financePermissions, permissionsForRole, type AssignablePermission, type PermissionOverrides } from "./permissions.js";

type Role = "owner" | "operator" | "viewer";
export type AccountContext = { tenantId: string; actorId: string };
type MemberRow = { id: string; name: string; email: string; role: Role; active: boolean; version: number;
  overrides: PermissionOverrides; created_at: Date | null; updated_at: Date | null };
type Creation = { requestId: string; name: string; email: string; password: string; role: Role; overrides: PermissionOverrides };
type Intent = { request_id: string; tenant_id: string; actor_id: string; fingerprint: string; provisioning_key: string; user_id: string | null };
const memberColumns = 'm.user_id AS id,u.name,u.email,m.role,m.active,m.version,m.permission_overrides AS overrides,m.created_at,m.updated_at';
const joinMembers = 'FROM memberships m JOIN "user" u ON u.id=m.user_id';

function memberDto(row: MemberRow) {
  return { id: row.id, name: row.name, email: row.email, role: row.role, active: row.active, version: row.version,
    permissions: permissionsForRole(row.role, row.overrides), overrides: row.overrides,
    createdAt: row.created_at?.toISOString() ?? null, updatedAt: row.updated_at?.toISOString() ?? null };
}

function text(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.trim().length > maximum || !value.trim()) throw invalidInput();
  return value.trim();
}
function role(value: unknown): Role {
  if (value !== "owner" && value !== "operator" && value !== "viewer") throw invalidInput("Selecione um perfil válido.");
  return value;
}
function overrides(value: unknown = {}): PermissionOverrides {
  const input = inputRecord(value);
  allowedKeys(input, assignablePermissions);
  const result: PermissionOverrides = {};
  for (const permission of assignablePermissions) if (Object.hasOwn(input, permission)) {
    if (typeof input[permission] !== "boolean") throw invalidInput("Informe permissões válidas.");
    result[permission] = input[permission];
  }
  return result;
}
function coherent(memberRole: Role, custom: PermissionOverrides) {
  if (memberRole === "owner") {
    if (Object.keys(custom).length) throw invalidInput("Gestores mantêm os acessos do perfil.");
    return;
  }
  const configured = new Set<AssignablePermission>(memberRole === "operator" ? customerPermissions : ["customers.read"]);
  for (const permission of assignablePermissions) {
    if (custom[permission] === true) configured.add(permission);
    if (custom[permission] === false) configured.delete(permission);
  }
  const effective = new Set(permissionsForRole(memberRole, custom));
  if ([...configured].some((permission) => !effective.has(permission))) throw invalidInput("Confira as permissões de consulta necessárias para as ações escolhidas.");
}
function creation(raw: unknown): Creation {
  const body = inputRecord(raw);
  allowedKeys(body, ["requestId", "name", "email", "password", "role", "overrides"]);
  const email = text(body.email, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) throw invalidInput("Informe um e-mail válido.");
  if (typeof body.password !== "string" || body.password.length < 12 || body.password.length > 128 || !body.password.trim())
    throw invalidInput("Informe uma senha inicial entre 12 e 128 caracteres.");
  const result = { requestId: requireUuid(body.requestId), name: text(body.name, 120), email, password: body.password,
    role: role(body.role), overrides: overrides(body.overrides) };
  coherent(result.role, result.overrides);
  return result;
}
function fingerprint(input: Creation): string {
  // A retry may carry another password, but never changes the credential already created by Better Auth.
  // Credentials and credential-derived digests are absent from the durable intention.
  return createHash("sha256").update(JSON.stringify({ name: input.name, email: input.email, role: input.role, overrides: input.overrides })).digest("hex");
}
function pageNumber(value: unknown, fallback: number, minimum: number, maximum: number) {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw invalidInput();
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw invalidInput();
  return number;
}
function page(query: Record<string, unknown>) {
  return { limit: pageNumber(query.limit, 25, 1, 100), offset: pageNumber(query.offset, 0, 0, 10000) };
}
function date(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) throw invalidInput("Confira o período informado.");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw invalidInput("Confira o período informado.");
  return value;
}
function targetId(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) throw invalidInput();
  return value;
}

async function transaction<T>(client: PoolClient, action: () => Promise<T>, readOnly = false): Promise<T> {
  await client.query(readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN");
  try {
    await client.query("SET LOCAL statement_timeout='5000ms'");
    const result = await action();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* Preserve the controlled error below. */ }
    throw error;
  }
}

// Borrow a pool client only after obtaining a bounded local slot. A queued lock waiter must
// never consume the second connection needed by Better Auth's own transaction.
class AdministrationGate {
  private busy = false;
  private waiting: { resolve: () => void; reject: () => void; timer: ReturnType<typeof setTimeout> }[] = [];
  async acquire(): Promise<void> {
    if (!this.busy) { this.busy = true; return; }
    if (this.waiting.length >= 16) throw unavailable();
    await new Promise<void>((resolve, reject) => {
      const entry = { resolve, reject: () => reject(unavailable()), timer: undefined as unknown as ReturnType<typeof setTimeout> };
      entry.timer = setTimeout(() => {
        const index = this.waiting.indexOf(entry);
        if (index >= 0) this.waiting.splice(index, 1);
        entry.reject();
      }, 2000);
      this.waiting.push(entry);
    });
  }
  release() {
    const next = this.waiting.shift();
    if (next) { clearTimeout(next.timer); next.resolve(); }
    else this.busy = false;
  }
}
const gates = new WeakMap<Pool, AdministrationGate>();

export function createAccountsService(pool: Pool, config: ApiConfig) {
  const gate = gates.get(pool) ?? new AdministrationGate();
  gates.set(pool, gate);

  async function manager(connection: Pick<Pool, "query"> | PoolClient, context: AccountContext, onboardingId?: string) {
    if (onboardingId) {
      await connection.query("SELECT pg_advisory_xact_lock_shared(731245)");
      const result = await connection.query("SELECT c.tenant_id FROM company_onboarding c JOIN tenants t ON t.id=c.tenant_id JOIN platform_administrator p ON p.user_id=c.actor_id AND p.singleton=true AND p.active=true WHERE c.request_id=$1 AND c.tenant_id=$2 AND c.actor_id=$3 AND c.completed_at IS NULL AND t.active=false", [onboardingId, context.tenantId, context.actorId]);
      if (!result.rowCount) throw forbidden();
      return;
    }
    const result = await connection.query(
      "SELECT m.user_id FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.role='owner' AND m.active=true AND t.active=true",
      [context.tenantId, context.actorId]);
    if (!result.rowCount) throw forbidden();
  }
  async function controlled<T>(action: () => Promise<T>): Promise<T> {
    try { return await action(); }
    catch (error) { if (error instanceof ApiError) throw error; throw unavailable(); }
  }
  async function assertManager(context: AccountContext) { await controlled(() => manager(pool, context)); }
  async function assertReady() {
    await controlled(async () => {
      const versions = await pool.query("SELECT version FROM schema_migrations WHERE version IN ('control_001','control_002','control_003')");
      if (versions.rowCount !== 3) throw unavailable();
      await pool.query("SELECT p.user_id,p.active,p.version,c.request_id,c.slot_id,c.fingerprint,c.completed_at,e.actor_id FROM platform_administrator p CROSS JOIN company_onboarding c CROSS JOIN company_admission_events e LIMIT 0");
      // Resolve required application columns without reading a user or operational record.
      // Authentication can be healthy while an application checkpoint is still incomplete.
      await pool.query(`SELECT t.id,t.name,t.database_key,t.active,
        m.user_id,m.tenant_id,m.role,m.active,m.version,m.permission_overrides,m.created_at,m.updated_at,
        a.id,a.tenant_id,a.actor_id,a.target_user_id,a.action,a.entity_version,a.field_names,a.at,
        i.request_id,i.tenant_id,i.actor_id,i.fingerprint,i.provisioning_key,i.user_id,i.created_at
        FROM tenants t CROSS JOIN memberships m CROSS JOIN access_audit_events a CROSS JOIN account_provisioning i LIMIT 0`);
    });
  }

  async function read<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    return controlled(async () => {
      const client = await pool.connect();
      try { return await transaction(client, () => action(client), true); }
      finally { client.release(); }
    });
  }
  async function administer<T>(context: AccountContext, email: string | undefined, action: (client: PoolClient) => Promise<T>, onboardingId?: string): Promise<T> {
    return controlled(async () => {
      await gate.acquire();
      let client: PoolClient | undefined;
      const locks: string[] = [];
      let destroy = false;
      try {
        client = await pool.connect();
        for (const key of [`sistem:team:tenant:${context.tenantId}`, ...(email ? [`sistem:team:email:${email}`] : [])]) {
          const result = await client.query("SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked", [key]);
          if (result.rows[0]?.locked !== true) throw unavailable();
          locks.push(key);
        }
        await manager(client, context, onboardingId);
        return await action(client);
      } finally {
        try {
          if (client) {
            for (const key of locks.reverse()) {
              try { await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [key]); }
              catch { destroy = true; break; }
            }
            client.release(destroy);
          }
        } finally { gate.release(); }
      }
    });
  }
  async function member(client: PoolClient, tenantId: string, id: string): Promise<MemberRow> {
    const result = await client.query<MemberRow>(`SELECT ${memberColumns} ${joinMembers} WHERE m.tenant_id=$1 AND m.user_id=$2`, [tenantId, id]);
    if (!result.rows[0]) throw notFound();
    return result.rows[0];
  }
  async function audit(client: PoolClient, context: AccountContext, id: string, version: number, action: string, fields: string[]) {
    await client.query("INSERT INTO access_audit_events(id,tenant_id,actor_id,target_user_id,action,entity_version,field_names) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [randomUUID(), context.tenantId, context.actorId, id, action, version, fields]);
  }

  async function list(context: AccountContext, rawQuery: unknown) {
    const query = inputRecord(rawQuery);
    allowedKeys(query, ["q", "status", "sort", "dateField", "from", "to", "limit", "offset"]);
    const { limit, offset } = page(query);
    const q = query.q === undefined ? "" : typeof query.q === "string" && query.q.trim().length <= 100 ? query.q.trim() : (() => { throw invalidInput(); })();
    const status = query.status ?? "all", sort = query.sort ?? "name", dateField = query.dateField ?? "created";
    if (!["all", "active", "inactive"].includes(status as string) || !["name", "created", "updated"].includes(sort as string) ||
        !["created", "updated"].includes(dateField as string)) throw invalidInput();
    const from = date(query.from), to = date(query.to);
    if (from && to && from > to) throw invalidInput("Confira o período informado.");
    const values: unknown[] = [context.tenantId, q];
    const clauses = ["m.tenant_id=$1", "strpos(lower(u.name || ' ' || u.email),lower($2))>0"];
    if (status !== "all") { values.push(status === "active"); clauses.push(`m.active=$${values.length}`); }
    const dateColumn = dateField === "created" ? "m.created_at" : "m.updated_at";
    if (from) { values.push(from); clauses.push(`${dateColumn} >= ($${values.length}::date::timestamp AT TIME ZONE 'America/Sao_Paulo')`); }
    if (to) { values.push(to); clauses.push(`${dateColumn} < (($${values.length}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'America/Sao_Paulo')`); }
    const where = clauses.join(" AND ");
    const order = sort === "name" ? "lower(u.name),m.user_id" : `m.${sort === "created" ? "created_at" : "updated_at"} DESC NULLS LAST,m.user_id`;
    return read(async (client) => {
      await manager(client, context);
      const count = await client.query(`SELECT count(*)::int AS total ${joinMembers} WHERE ${where}`, values);
      const selected = await client.query<MemberRow>(`SELECT ${memberColumns} ${joinMembers} WHERE ${where} ORDER BY ${order} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, limit, offset]);
      return { items: selected.rows.map(memberDto), total: count.rows[0].total as number, limit, offset };
    });
  }

  async function get(context: AccountContext, rawId: unknown) {
    const id = targetId(rawId);
    return read(async (client) => {
      await manager(client, context);
      return memberDto(await member(client, context.tenantId, id));
    });
  }

  async function create(context: AccountContext, raw: unknown, onboardingId?: string) {
    const input = creation(raw), digest = fingerprint(input);
    if (onboardingId && (input.requestId !== onboardingId || input.role !== "owner" || Object.keys(input.overrides).length)) throw forbidden();
    return administer(context, input.email, async (client) => {
      const intent = await transaction(client, async () => {
        await manager(client, context, onboardingId);
        const reserved = await client.query("SELECT request_id FROM company_onboarding WHERE owner_email=$1 AND request_id IS DISTINCT FROM $2::uuid", [input.email, onboardingId ?? null]);
        if (reserved.rowCount) throw new ApiError(409, "ACCOUNT_CONFLICT", "Este e-mail está reservado para um gestor de empresa.");
        const existing = await client.query<Intent>("SELECT * FROM account_provisioning WHERE request_id=$1 FOR UPDATE", [input.requestId]);
        if (existing.rows[0]) {
          const previous = existing.rows[0];
          if (previous.tenant_id !== context.tenantId || previous.actor_id !== context.actorId || previous.fingerprint !== digest)
            throw new ApiError(409, "REQUEST_CONFLICT", "Esta tentativa já está associada a outro cadastro.");
          return previous;
        }
        const created = await client.query<Intent>("INSERT INTO account_provisioning(request_id,tenant_id,actor_id,fingerprint,provisioning_key) VALUES($1,$2,$3,$4,$5) RETURNING *",
          [input.requestId, context.tenantId, context.actorId, digest, randomUUID()]);
        return created.rows[0];
      });
      if (intent.user_id) return memberDto(await member(client, context.tenantId, intent.user_id));

      async function identity() {
        const result = await client.query<{ id: string; key: string | null; credential: boolean }>(
          'SELECT u.id,u."provisioningKey" AS key,EXISTS(SELECT 1 FROM account a WHERE a."userId"=u.id AND a."providerId"=\'credential\' AND a.password IS NOT NULL) AS credential FROM "user" u WHERE lower(u.email)=lower($1)', [input.email]);
        return result.rows[0];
      }
      let user = await identity();
      const identityConflict = () => new ApiError(409, "ACCOUNT_CONFLICT", "Não foi possível cadastrar esta conta. Confira os dados ou use outra conta.");
      if (user && user.key !== intent.provisioning_key) throw identityConflict();
      if (!user) {
        // The library owns password hashing and user/account creation. The private hook tags only
        // this signup; public input and the synthetic duplicate response cannot provide proof.
        const auth = createAuth(pool, config, true, intent.provisioning_key);
        try { await auth.api.signUpEmail({ body: { name: input.name, email: input.email, password: input.password } }); }
        catch (error) {
          if (error && typeof error === "object" && "statusCode" in error && error.statusCode === 400) throw invalidInput();
          throw unavailable();
        }
        user = await identity();
      }
      if (!user || user.key !== intent.provisioning_key) throw identityConflict();
      if (!user.credential) throw unavailable();
      const id = user.id;
      return transaction(client, async () => {
        await manager(client, context, onboardingId);
        const existing = await client.query("SELECT user_id FROM memberships WHERE tenant_id=$1 AND user_id=$2", [context.tenantId, id]);
        if (existing.rowCount) throw identityConflict();
        await client.query("INSERT INTO memberships(user_id,tenant_id,role,active,permission_overrides,created_at,updated_at) VALUES($1,$2,$3,true,$4,clock_timestamp(),clock_timestamp())",
          [id, context.tenantId, input.role, JSON.stringify(input.overrides)]);
        await audit(client, context, id, 1, "membership.created", ["role", "active", "overrides"]);
        await client.query("UPDATE account_provisioning SET user_id=$2 WHERE request_id=$1", [input.requestId, id]);
        return memberDto(await member(client, context.tenantId, id));
      });
    }, onboardingId);
  }

  async function update(context: AccountContext, rawId: unknown, raw: unknown) {
    const id = targetId(rawId), body = inputRecord(raw);
    allowedKeys(body, ["version", "role", "active", "overrides"]);
    if (!Number.isSafeInteger(body.version) || (body.version as number) <= 0 || Object.keys(body).length < 2) throw invalidInput();
    const nextRole = body.role === undefined ? undefined : role(body.role);
    if (Object.hasOwn(body, "active") && typeof body.active !== "boolean") throw invalidInput();
    const custom = body.overrides === undefined ? undefined : overrides(body.overrides);
    return administer(context, undefined, (client) => transaction(client, async () => {
      await manager(client, context);
      const selected = await client.query<MemberRow>(`SELECT ${memberColumns} ${joinMembers} WHERE m.tenant_id=$1 AND m.user_id=$2 FOR UPDATE OF m`, [context.tenantId, id]);
      const current = selected.rows[0];
      if (!current) throw notFound();
      if (current.version !== body.version || current.version >= 2147483647) throw conflict();
      const updatedRole = nextRole ?? current.role;
      const updatedOverrides = custom ?? (updatedRole !== current.role ? {} : current.overrides);
      coherent(updatedRole, updatedOverrides);
      const active = typeof body.active === "boolean" ? body.active : current.active;
      const fields: string[] = [];
      if (updatedRole !== current.role) fields.push("role");
      if (active !== current.active) fields.push("active");
      if (JSON.stringify(overrides(updatedOverrides)) !== JSON.stringify(overrides(current.overrides))) fields.push("overrides");
      if (!fields.length) return memberDto(current);
      if (current.role === "owner" && current.active && (updatedRole !== "owner" || !active)) {
        const others = await client.query("SELECT count(*)::int AS total FROM memberships WHERE tenant_id=$1 AND user_id<>$2 AND role='owner' AND active=true", [context.tenantId, id]);
        if (others.rows[0].total < 1) throw new ApiError(409, "LAST_OWNER", "Mantenha ao menos um gestor ativo na empresa.");
      }
      await client.query("UPDATE memberships SET role=$3,active=$4,permission_overrides=$5,version=version+1,updated_at=clock_timestamp() WHERE tenant_id=$1 AND user_id=$2",
        [context.tenantId, id, updatedRole, active, JSON.stringify(updatedOverrides)]);
      await audit(client, context, id, current.version + 1, "membership.updated", fields);
      return memberDto(await member(client, context.tenantId, id));
    }));
  }

  async function accessAudit(context: AccountContext, raw: unknown) {
    const query = inputRecord(raw);
    allowedKeys(query, ["limit", "offset"]);
    const { limit, offset } = page(query);
    return read(async (client) => {
      await manager(client, context);
      const count = await client.query("SELECT count(*)::int AS total FROM access_audit_events WHERE tenant_id=$1", [context.tenantId]);
      const result = await client.query<{ id: string; actor_id: string; target_user_id: string; action: string; entity_version: number; field_names: string[]; at: Date }>(
        "SELECT id,actor_id,target_user_id,action,entity_version,field_names,at FROM access_audit_events WHERE tenant_id=$1 ORDER BY at DESC,id DESC LIMIT $2 OFFSET $3", [context.tenantId, limit, offset]);
      return { items: result.rows.map((row) => ({ id: row.id, actorId: row.actor_id, targetId: row.target_user_id, action: row.action,
        version: row.entity_version, fields: row.field_names, at: row.at.toISOString() })), total: count.rows[0].total as number, limit, offset };
    });
  }

  return { assertManager, assertReady, list, get, create: (context: AccountContext, raw: unknown) => create(context, raw),
    createFirstOwner: (context: AccountContext, raw: unknown) => create(context, raw, requireUuid(inputRecord(raw).requestId)), update, accessAudit,
    options: () => ({ roles: ([{ id: "owner", label: "Gestor" }, { id: "operator", label: "Atendimento" }, { id: "viewer", label: "Consulta" }] as const)
      .map((entry) => ({ ...entry, permissions: permissionsForRole(entry.id) })),
    operationalPermissions: [...operationalPermissions.map((id) => ({ id, label: ({ products: "Produtos", stock: "Estoque", sales: "Vendas", orders: "OS", purchases: "Compras", audit: "Histórico" }[id.split(".")[0]] ?? id) + " · " + ({ read: "Consultar", create: "Criar", update: "Editar", archive: "Inativar", receive: "Receber", deliver: "Entregar", advance: "Avançar", import: "Importar", discount: "Conceder desconto por item" }[id.split(".").at(-1)!] ?? "Consultar") + (id.includes(".cost.") ? " custos" : "") })),
      ...financePermissions.map((id) => ({ id, label: { "finance.read": "Consultar financeiro", "finance.agreements.create": "Criar acordos e parcelas", "finance.receive": "Receber pagamentos", "finance.accounts.manage": "Cadastrar contas", "finance.cash.manage": "Abrir e fechar o próprio caixa" }[id] }))],
    permissions: [{ id: "customers.read", label: "Consultar clientes" }, { id: "customers.create", label: "Cadastrar clientes" },
      { id: "customers.update", label: "Editar clientes" }, { id: "customers.archive", label: "Inativar clientes" }] }) };
}
