import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { parseEnv } from "node:util";
import test from "node:test";
import { Pool } from "pg";
import { setupLocal } from "../scripts/setup-local.ts";
import { createTestCluster } from "../scripts/test-cluster.ts";
import { readConfig } from "../src/config.ts";
import { createAuth } from "../src/auth.ts";
import { buildApp } from "../src/app.ts";
import { cookieFrom } from "./helpers.ts";

test("SETUP-01 cluster próprio, gestor explícito e repetição preservam identidade/dados/senha sem autoelevação", async () => {
  const cluster = await createTestCluster();
  const pools: Pool[] = [];
  let failed = false;
  try {
    const data = await cluster.admin.query("SHOW data_directory");
    const directory = dirname(resolve(data.rows[0].data_directory));
    const adminUrl = new URL(cluster.adminDatabaseUrl);
    const credentials = { port: Number(adminUrl.port), user: decodeURIComponent(adminUrl.username), password: decodeURIComponent(adminUrl.password) };
    const owner = { name: "Gestor QA local", email: "bootstrap.qa@example.test", password: "QA-bootstrap-original-2026!", companyName: "Loja QA isolada" };
    const countsBefore = await cluster.admin.query("SELECT (SELECT count(*)::int FROM pg_database) AS databases,(SELECT count(*)::int FROM pg_roles) AS roles");
    await assert.rejects(setupLocal({ directory: resolve(directory, "wrong-target"), credentials, owner }));
    const countsAfter = await cluster.admin.query("SELECT (SELECT count(*)::int FROM pg_database) AS databases,(SELECT count(*)::int FROM pg_roles) AS roles");
    assert.deepEqual(countsAfter.rows, countsBefore.rows, "wrong cluster directory must be refused before DDL");

    const first = await setupLocal({ directory, credentials, owner });
    assert.match(first.tenantId, /^[0-9a-f-]{36}$/i);
    const envRelative = relative(directory, first.envPath);
    assert.ok(envRelative && !envRelative.startsWith("..") && !isAbsolute(envRelative), "env file must stay in the supplied private directory");
    assert.equal(envRelative, "api.env");
    const raw = await readFile(first.envPath, "utf8"), env = parseEnv(raw), config = readConfig(env);
    assert.ok(!raw.includes(owner.password), "plaintext owner password must not be persisted in environment");
    const tenantUrls = Object.values(config.tenantDatabaseUrls);
    assert.equal(tenantUrls.length, 1);
    assert.ok(new URL(config.controlDatabaseUrl).pathname !== new URL(tenantUrls[0]).pathname, "control and operational databases must be distinct");
    const adminPool = (runtimeUrl: string) => {
      const url = new URL(cluster.adminDatabaseUrl); url.pathname = new URL(runtimeUrl).pathname;
      const pool = new Pool({ connectionString: url.toString(), max: 2, connectionTimeoutMillis: 1500 }); pools.push(pool); return pool;
    };
    const control = adminPool(config.controlDatabaseUrl), main = adminPool(tenantUrls[0]);
    const users = await control.query('SELECT id,email,name FROM "user" WHERE email=$1', [owner.email]);
    assert.equal(users.rowCount, 1);
    const userId = users.rows[0].id;
    const membership = await control.query("SELECT role,active FROM memberships WHERE user_id=$1 AND tenant_id=$2", [userId, first.tenantId]);
    assert.deepEqual(membership.rows, [{ role: "owner", active: true }]);
    const customerId = randomUUID();
    await main.query("INSERT INTO customers(id,name,type) VALUES($1,$2,$3)", [customerId, "Preservar no segundo setup", "Empresa"]);

    const otherPassword = "QA-bootstrap-alternative-2026!";
    const second = await setupLocal({ directory, credentials, owner: { ...owner, password: otherPassword } });
    assert.equal(second.tenantId, first.tenantId); assert.equal(second.envPath, first.envPath);
    const repeatedEnv = parseEnv(await readFile(second.envPath, "utf8"));
    assert.deepEqual(Object.keys(repeatedEnv).sort(), Object.keys(env).sort());
    for (const key of Object.keys(env)) assert.ok(repeatedEnv[key] === env[key], `runtime configuration must remain stable: ${key}`);
    assert.equal((await control.query('SELECT count(*)::int AS count FROM "user" WHERE email=$1', [owner.email])).rows[0].count, 1);
    assert.equal((await main.query("SELECT count(*)::int AS count FROM customers WHERE id=$1", [customerId])).rows[0].count, 1);
    const runtimeControl = new Pool({ connectionString: config.controlDatabaseUrl, max: 2, connectionTimeoutMillis: 1500 });
    const runtimeMain = new Pool({ connectionString: tenantUrls[0], max: 1, connectionTimeoutMillis: 1500 });
    pools.push(runtimeControl, runtimeMain);
    assert.equal((await runtimeMain.query("SELECT count(*)::int AS count FROM customers WHERE id=$1", [customerId])).rows[0].count, 1);
    const auth = createAuth(runtimeControl, config, false);
    const signedIn = await auth.api.signInEmail({ body: { email: owner.email, password: owner.password }, headers: new Headers({ origin: config.frontendOrigin }) });
    assert.equal(signedIn.user.id, userId);
    await assert.rejects(auth.api.signInEmail({ body: { email: owner.email, password: otherPassword }, headers: new Headers({ origin: config.frontendOrigin }) }));
    const app = await buildApp({ config, controlPool: runtimeControl, logger: false });
    try {
      const signIn = await app.inject({ method: "POST", url: "/api/auth/sign-in/email", headers: { origin: config.frontendOrigin }, payload: { email: owner.email, password: owner.password } });
      assert.equal(signIn.statusCode, 200, "generated runtime configuration must support login");
      const cookie = cookieFrom(signIn); assert.ok(cookie);
      const me = await app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie } });
      assert.equal(me.statusCode, 200); assert.equal(me.json().user.id, userId);
      assert.equal(me.json().tenants[0].id, first.tenantId);
      const read = await app.inject({ method: "GET", url: `/api/v1/tenants/${first.tenantId}/customers/${customerId}`, headers: { cookie } });
      assert.equal(read.statusCode, 200); assert.equal(read.json().customer.id, customerId);
    } finally { await app.close(); }
    await control.query("UPDATE memberships SET role='viewer' WHERE user_id=$1 AND tenant_id=$2", [userId, first.tenantId]);
    await assert.rejects(setupLocal({ directory, credentials, owner }));
    assert.equal((await control.query("SELECT role FROM memberships WHERE user_id=$1 AND tenant_id=$2", [userId, first.tenantId])).rows[0].role, "viewer");
    await control.query("UPDATE memberships SET role='owner' WHERE user_id=$1 AND tenant_id=$2", [userId, first.tenantId]);
    const runtimeRole = decodeURIComponent(new URL(config.controlDatabaseUrl).username);
    assert.match(runtimeRole, /^[a-zA-Z0-9_]+$/);
    const rotatedPassword = `QA-role-rotated-${randomUUID()}`;
    assert.match(rotatedPassword, /^[a-zA-Z0-9_-]+$/);
    const environmentBeforeRotation = await readFile(first.envPath, "utf8");
    // Somente a role deste cluster fictício é alterada; o manifesto não ganha a senha nova.
    await control.query(`ALTER ROLE "${runtimeRole}" PASSWORD '${rotatedPassword}'`);
    await assert.rejects(setupLocal({ directory, credentials, owner }), "setup must refuse stale runtime credentials before announcing success");
    assert.ok((await readFile(first.envPath, "utf8")) === environmentBeforeRotation, "failed runtime probe must preserve environment configuration");
    assert.equal((await main.query("SELECT count(*)::int AS count FROM customers WHERE id=$1", [customerId])).rows[0].count, 1);
    assert.equal((await control.query("SELECT role FROM memberships WHERE user_id=$1 AND tenant_id=$2", [userId, first.tenantId])).rows[0].role, "owner");
    for (const file of (await readdir(directory)).filter((name) => name.endsWith(".json"))) {
      const value = await readFile(resolve(directory, file), "utf8");
      assert.ok(!value.includes(owner.password) && !value.includes(otherPassword), "setup metadata must not persist plaintext owner passwords");
    }
  } catch (error) { failed = true; throw error; }
  finally {
    const closed = await Promise.allSettled(pools.map((pool) => pool.end()));
    try {
      await cluster.stop();
      if (closed.some((result) => result.status === "rejected")) throw new Error("Não foi possível encerrar um pool do teste de setup.");
    } catch (error) {
      if (failed) console.error("Falha de limpeza do teste de setup; a causa original foi preservada.");
      else throw error;
    }
  }
});
