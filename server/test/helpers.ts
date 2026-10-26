import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { Pool } from "pg";
import { buildApp } from "../src/app.ts";
import { createAuth } from "../src/auth.ts";
import { migrateControl, migrateTenant } from "../src/migrations.ts";
import { createTestCluster } from "../scripts/test-cluster.ts";

export const ORIGIN = "http://127.0.0.1:3000";
export const TENANT_A = "10000000-0000-4000-8000-000000000001";
export const TENANT_B = "20000000-0000-4000-8000-000000000002";
export const PASSWORD = "QA-password-2026!";

export async function createFixture() {
  const cluster = await createTestCluster();
  try {
    const control = await cluster.createDatabase("control");
    const a = await cluster.createDatabase("tenant_a");
    const b = await cluster.createDatabase("tenant_b");
    await migrateControl(control.migrationPool);
    await migrateTenant(a.migrationPool);
    await migrateTenant(b.migrationPool);
    await control.grantRuntime();
    await a.grantRuntime();
    await b.grantRuntime();
    await control.migrationPool.query(
      "INSERT INTO tenants (id,name,database_key,active) VALUES ($1,$2,$3,true),($4,$5,$6,true)",
      [TENANT_A, "Loja A de teste", "a", TENANT_B, "Loja B de teste", "b"],
    );
    const config = {
      nodeEnv: "test" as "development" | "test" | "production",
      host: "127.0.0.1",
      port: 4000,
      baseUrl: "http://127.0.0.1:4000",
      frontendOrigin: ORIGIN,
      authSecret: "qa-exclusive-" + randomUUID() + randomUUID(),
      controlDatabaseUrl: control.runtimeUrl,
      tenantDatabaseUrls: { a: a.runtimeUrl, b: b.runtimeUrl },
    };
    const provisioning = createAuth(control.migrationPool, config, true);
    async function user(role = "owner", both = false) {
      const email = `qa-${randomUUID()}@example.test`;
      const result = await provisioning.api.signUpEmail({
        body: { name: "Pessoa de teste", email, password: PASSWORD },
      });
      await control.migrationPool.query(
        "INSERT INTO memberships (user_id,tenant_id,role,active) VALUES ($1,$2,$3,true)",
        [result.user.id, TENANT_A, role],
      );
      if (both) await control.migrationPool.query(
        "INSERT INTO memberships (user_id,tenant_id,role,active) VALUES ($1,$2,$3,true)",
        [result.user.id, TENANT_B, role],
      );
      return { id: result.user.id, email, password: PASSWORD };
    }
    async function app(overrides: Partial<typeof config> = {}) {
      const controlPool = new Pool({ connectionString: overrides.controlDatabaseUrl ?? config.controlDatabaseUrl, max: 2, connectionTimeoutMillis: 800 });
      const logs: string[] = [];
      const stream = new Writable({ write(chunk, _encoding, callback) { logs.push(chunk.toString()); callback(); } });
      try {
        const instance = await buildApp({ config: { ...config, ...overrides }, controlPool, logger: { level: "info", stream } });
        return {
          instance, controlPool, logs,
          async close() { await instance.close(); await controlPool.end(); },
        };
      } catch (error) {
        try { await controlPool.end(); }
        catch { console.error("Falha ao fechar o pool de teste após erro na preparação da API."); }
        throw error;
      }
    }
    return {
      cluster, control, a, b, config, user, app,
      async close() { await cluster.stop(); },
    };
  } catch (error) {
    try { await cluster.stop(); }
    catch { console.error("Falha ao encerrar o cluster isolado após erro na preparação da fixture."); }
    throw error;
  }
}

export type Fixture = Awaited<ReturnType<typeof createFixture>>;
export type TestApp = Awaited<ReturnType<Fixture["app"]>>;
export type TestUser = Awaited<ReturnType<Fixture["user"]>>;

export function tenantPath(tenantId = TENANT_A) { return `/api/v1/tenants/${tenantId}/customers`; }

export function cookieFrom(response: { headers: Record<string, unknown> }) {
  const setCookie = response.headers["set-cookie"];
  const values = Array.isArray(setCookie) ? setCookie : [setCookie];
  return values.filter((value): value is string => typeof value === "string")
    .map((value) => value.split(";", 1)[0]).join("; ");
}

export async function login(app: TestApp, user: TestUser, remoteAddress = "127.0.0.1") {
  const response = await app.instance.inject({
    method: "POST", url: "/api/auth/sign-in/email", remoteAddress,
    headers: { origin: ORIGIN }, payload: { email: user.email, password: user.password },
  });
  assert.equal(response.statusCode, 200, `login failed: ${response.statusCode} ${response.body}`);
  const cookie = cookieFrom(response);
  assert.ok(cookie, "login must return a cookie");
  return { response, cookie };
}

export function authHeaders(cookie: string) { return { cookie, origin: ORIGIN }; }

export async function createCustomer(app: TestApp, cookie: string, tenantId = TENANT_A, overrides: Record<string, unknown> = {}) {
  const response = await app.instance.inject({
    method: "POST", url: tenantPath(tenantId), headers: authHeaders(cookie),
    payload: { name: `Cliente ${randomUUID()}`, type: "Pessoa física", ...overrides },
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().customer;
}

export function assertError(response: { statusCode: number; json(): any; body: string }, expectedStatus: number) {
  assert.equal(response.statusCode, expectedStatus, response.body);
  const body = response.json();
  assert.deepEqual(Object.keys(body), ["error"]);
  assert.deepEqual(Object.keys(body.error).sort(), ["code", "message", "requestId"]);
  assert.equal(typeof body.error.code, "string");
  assert.equal(typeof body.error.message, "string");
  assert.match(body.error.requestId, /^[a-zA-Z0-9_-]{1,100}$/);
  return body.error;
}
