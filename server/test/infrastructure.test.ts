import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { Pool } from "pg";
import { migrateControl } from "../src/migrations.ts";
import { createAuth } from "../src/auth.ts";
import { createFixture, assertError, authHeaders, login, PASSWORD, TENANT_A, TENANT_B, type Fixture } from "./helpers.ts";

let fixture: Fixture;
before(async () => { fixture = await createFixture(); });
after(async () => { if (fixture) await fixture.close(); });

test("BE-INFRA-01 duas migrações centrais concorrentes completam com pool máximo dois e versão única", async () => {
  const database = await fixture.cluster.createDatabase("migration_race");
  const url = new URL(fixture.cluster.adminDatabaseUrl);
  url.pathname = `/${database.databaseName}`;
  const pool = new Pool({ connectionString: url.toString(), max: 2, connectionTimeoutMillis: 1500,
    options: "-c statement_timeout=8000" });
  try {
    // A espera por conexão e por lock é limitada; allSettled permite liberar ambos antes de encerrar o pool.
    const results = await Promise.allSettled([migrateControl(pool), migrateControl(pool)]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 2,
      "both concurrent migrations must finish without borrowing an unavailable third connection");
    const versions = await pool.query("SELECT version FROM schema_migrations ORDER BY version");
    // ACC/doc15 acrescenta a migração central sem substituir a versão anterior.
    // ADM adds a central migration without replacing the existing identity/access history.
    assert.deepEqual(versions.rows, [{ version: "control_001" }, { version: "control_002" }, { version: "control_003" }]);
    const schema = await pool.query("SELECT to_regclass('public.tenants') AS tenants,to_regclass('public.memberships') AS memberships,to_regclass('public.\"user\"') AS auth_user");
    assert.ok(schema.rows[0].tenants && schema.rows[0].memberships && schema.rows[0].auth_user);
  } finally { await pool.end(); }
});

test("BE-INFRA-02 readiness recusa schema incompatível mesmo quando a conexão PostgreSQL responde", async () => {
  const database = await fixture.cluster.createDatabase("schema_mismatch");
  await migrateControl(database.migrationPool);
  await database.grantRuntime();
  await database.migrationPool.query('ALTER TABLE "user" DROP COLUMN "emailVerified"');
  const app = await fixture.app({ controlDatabaseUrl: database.runtimeUrl });
  try {
    const live = await app.instance.inject({ method: "GET", url: "/health/live" });
    assert.equal(live.statusCode, 200);
    const ready = await app.instance.inject({ method: "GET", url: "/health/ready" });
    assertError(ready, 503);
    assert.doesNotMatch(ready.body, /emailVerified|SELECT|postgresql:|stack/i);
    assert.doesNotMatch(app.logs.join("\n"), /emailVerified|SELECT|postgresql:|stack/i);
  } finally { await app.close(); }
});

test("ACC-INFRA-03 schema de autenticação válido não torna pronto um checkpoint sem metadados de acesso", async () => {
  const database = await fixture.cluster.createDatabase("access_checkpoint");
  await migrateControl(database.migrationPool);
  await database.grantRuntime();
  const config = { ...fixture.config, controlDatabaseUrl: database.runtimeUrl };
  const provisioning = createAuth(database.migrationPool, config, true);
  const account = await provisioning.api.signUpEmail({ body: { name: "Gestor checkpoint", email: "checkpoint@example.test", password: PASSWORD } });
  await database.migrationPool.query("INSERT INTO tenants(id,name,database_key,active) VALUES($1,'Checkpoint QA','a',true)", [TENANT_A]);
  await database.migrationPool.query("INSERT INTO memberships(user_id,tenant_id,role,active) VALUES($1,$2,'owner',true)", [account.user.id, TENANT_A]);
  const prepared = await fixture.app({ controlDatabaseUrl: database.runtimeUrl });
  let cookie: string;
  try { cookie = (await login(prepared, { id: account.user.id, email: account.user.email, password: PASSWORD })).cookie; }
  finally { await prepared.close(); }
  // Simula o checkpoint anterior com autenticação válida, sem alterar o banco normal da fixture.
  await database.migrationPool.query("ALTER TABLE memberships DROP COLUMN permission_overrides");
  await database.migrationPool.query("DELETE FROM schema_migrations WHERE version='control_002'");
  const app = await fixture.app({ controlDatabaseUrl: database.runtimeUrl });
  try {
    assert.equal((await app.instance.inject({ method: "GET", url: "/health/live" })).statusCode, 200);
    const ready = await app.instance.inject({ method: "GET", url: "/health/ready" });
    assertError(ready, 503);
    const me = await app.instance.inject({ method: "GET", url: "/api/v1/me", headers: { cookie: cookie! } });
    assertError(me, 503);
    assert.doesNotMatch(ready.body + me.body + app.logs.join("\n"), /permission_overrides|control_002|SELECT|postgresql:|stack/i);
  } finally { await app.close(); }
});

test("ACC-INFRA-04 consulta por ID preserva e-mail longo e exige gestor da mesma empresa", async () => {
  const app = await fixture.app();
  try {
    const owner = await fixture.user();
    const { cookie } = await login(app, owner);
    const base = (tenant = TENANT_A) => `/api/v1/tenants/${tenant}/members`;
    const email = `qa-${randomUUID().replaceAll("-", "")}@${"a".repeat(63)}.${"b".repeat(40)}.example.test`;
    assert.ok(email.length > 100 && email.length <= 254);
    const created = await app.instance.inject({ method: "POST", url: base(), headers: authHeaders(cookie), payload: {
      requestId: randomUUID(), name: "Conta com e-mail longo", email, password: PASSWORD, role: "viewer",
    } });
    assert.equal(created.statusCode, 201, created.body);
    const member = created.json().member;
    const route = `${base()}/${encodeURIComponent(member.id)}`;
    const response = await app.instance.inject({ method: "GET", url: route, headers: { cookie } });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(Object.keys(response.json()).sort(), ["member", "tenantId"]);
    assert.equal(response.json().tenantId, TENANT_A);
    assert.deepEqual(Object.keys(response.json().member).sort(), ["active", "createdAt", "email", "id", "name", "overrides", "permissions", "role", "updatedAt", "version"]);
    assert.deepEqual(response.json().member, member); assert.equal(response.json().member.email, email);
    assertError(await app.instance.inject({ method: "GET", url: route }), 401);
    assertError(await app.instance.inject({ method: "GET", url: `${base()}/missing-${randomUUID()}`, headers: { cookie } }), 404);
    assertError(await app.instance.inject({ method: "GET", url: `${base(TENANT_B)}/${member.id}`, headers: { cookie } }), 403);
    const outside = await fixture.user("viewer", true);
    await fixture.control.migrationPool.query("DELETE FROM memberships WHERE user_id=$1 AND tenant_id=$2", [outside.id, TENANT_A]);
    assertError(await app.instance.inject({ method: "GET", url: `${base()}/${outside.id}`, headers: { cookie } }), 404);
    const operator = await fixture.user("operator"); const session = await login(app, operator);
    assertError(await app.instance.inject({ method: "GET", url: route, headers: { cookie: session.cookie } }), 403);
  } finally { await app.close(); }
});
