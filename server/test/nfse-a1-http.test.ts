import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import http from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createFixture, login, authHeaders, assertError, TENANT_A, TENANT_B, type Fixture, type TestApp } from "./helpers.ts";
import { createA1Fixture } from "./nfse-a1-fixture.ts";

let fixture: Fixture, certificates: Awaited<ReturnType<typeof createA1Fixture>>;
const root = resolve(import.meta.dirname, "../.local/tests");
let directory: string, keyPath: string;
before(async () => {
  fixture = await createFixture();
  for (const [db, id] of [[fixture.a, TENANT_A], [fixture.b, TENANT_B]] as const) await db.migrationPool.query("INSERT INTO tenant_admission(singleton,slot_id,tenant_id,claimed_at) VALUES(true,$1,$2,clock_timestamp())", [randomUUID(), id]);
  certificates = await createA1Fixture(["valid", "wrongIdentity"]);
  await mkdir(root, { recursive: true });
  directory = await mkdtemp(join(root, "a1-http-"));
  keyPath = join(directory, "keyring.json");
  await writeFile(keyPath, JSON.stringify({ activeKeyId: "generic", keys: { generic: randomBytes(32).toString("base64") } }), { mode: 0o600 });
});
beforeEach(async () => {
  await fixture.a.migrationPool.query("TRUNCATE nfse_a1_requests,nfse_a1_custody,fiscal_record_versions,fiscal_settings_requests,fiscal_records,audit_events CASCADE");
});
after(async () => {
  await certificates?.close();
  await fixture?.close();
  if (!directory) return;
  const target = resolve(directory);
  if (!target.startsWith(root + sep + "a1-http-")) throw Error("Invalid generic HTTP fixture cleanup");
  await rm(target, { recursive: true, force: true });
});
const base = (tenant = TENANT_A) => `/api/v1/tenants/${tenant}/fiscal`;
async function scenario(run: (app: TestApp, cookie: string) => Promise<void>, configured = true) {
  const app = await fixture.app(configured ? { a1KeyringFile: keyPath } : {});
  try {
    const actor = await fixture.user();
    const { cookie } = await login(app, actor);
    const profile = await app.instance.inject({ method: "PATCH", url: base() + "/profile", headers: authHeaders(cookie), payload: { requestId: randomUUID(), version: 0, cnpj: "11222333000181" } });
    assert.equal(profile.statusCode, 200, profile.body);
    await run(app, cookie);
  } finally { await app.close(); }
}
const body = (patch: Record<string, unknown> = {}) => ({ requestId: randomUUID(), version: 0, profileVersion: 1, pfxBase64: certificates.materials.valid.pfx.toString("base64"), passphrase: certificates.passphrase, ...patch });
const upload = (app: TestApp, cookie: string, payload: Record<string, unknown>) => app.instance.inject({ method: "PATCH", url: base() + "/certificate", headers: authHeaders(cookie), payload });
const status = (app: TestApp, cookie: string) => app.instance.inject({ method: "GET", url: base() + "/certificate", headers: { cookie } });

test("CERT01 upload authorizes before parsing, with independent grant, origin and tenant checks", async () => {
  await scenario(async (app, cookie) => {
    const url = base() + "/certificate";
    assertError(await app.instance.inject({ method: "PATCH", url, headers: { origin: "http://127.0.0.1:3000", "content-type": "application/json" }, payload: "{" }), 401);
    assertError(await app.instance.inject({ method: "PATCH", url, headers: { cookie, origin: "https://foreign.test", "content-type": "application/json" }, payload: "{" }), 403);
    const staff = await fixture.user("viewer"), { cookie: employee } = await login(app, staff);
    await fixture.control.migrationPool.query("UPDATE memberships SET permission_overrides=$1 WHERE user_id=$2", [JSON.stringify({ "fiscal.read": true, "fiscal.configure": true }), staff.id]);
    assertError(await upload(app, employee, body()), 403);
    const grants = { "fiscal.read": true, "fiscal.configure": true, "fiscal.certificates.manage": true };
    await fixture.control.migrationPool.query("UPDATE memberships SET permission_overrides=$1 WHERE user_id=$2", [JSON.stringify(grants), staff.id]);
    assert.equal((await upload(app, employee, body())).statusCode, 200);
    await fixture.control.migrationPool.query("UPDATE memberships SET active=false WHERE user_id=$1", [staff.id]);
    assertError(await upload(app, employee, body({ version: 1 })), 403);
    assertError(await app.instance.inject({ method: "GET", url: base(TENANT_B) + "/certificate", headers: { cookie } }), 403);
  });
});
test("CERT02 stores only encrypted credentials, returns metadata and logs no private body or file path", async () => {
  await scenario(async (app, cookie) => {
    const initial = await status(app, cookie);
    assert.equal(initial.statusCode, 200, initial.body);
    assert.equal(initial.json().storageConfigured, true);
    assert.equal(initial.json().certificate, null);
    const data = body(), saved = await upload(app, cookie, data);
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().certificate.version, 1);
    assert.equal(saved.json().certificate.readyForSubmission, false);
    assert.equal(saved.headers["cache-control"], "no-store");
    const row = (await fixture.a.migrationPool.query("SELECT ciphertext FROM nfse_a1_custody")).rows[0];
    assert.ok(!row.ciphertext.includes(certificates.materials.valid.pfx));
    const visible = saved.body + (await status(app, cookie)).body + app.logs.join("\n");
    for (const value of [data.pfxBase64, data.passphrase, keyPath]) assert.ok(!visible.includes(value));
    assert.doesNotMatch(visible, /PRIVATE KEY|passphrase|pfxBase64/);
    assertError(await app.instance.inject({ method: "GET", url: base() + "/certificate/pfx", headers: { cookie } }), 404);
  });
});
test("CERT03 exact retry uses historical profile CNPJ, preserving original metadata without a new audit", async () => {
  await scenario(async (app, cookie) => {
    const intent = body(), saved = await upload(app, cookie, intent);
    assert.equal(saved.statusCode, 200, saved.body);
    await app.instance.inject({ method: "PATCH", url: base() + "/profile", headers: authHeaders(cookie), payload: { requestId: randomUUID(), version: 1, cnpj: "11444777000161" } });
    const retried = await upload(app, cookie, intent);
    assert.equal(retried.statusCode, 200, retried.body);
    assert.deepEqual(retried.json(), saved.json());
    assertError(await upload(app, cookie, body({ version: 1 })), 409);
    assert.equal((await fixture.a.migrationPool.query("SELECT count(*)::int AS n FROM audit_events WHERE action='fiscal.certificate.update'")).rows[0].n, 1);
  });
});
test("CERT04 unavailable keyfile feature fails closed while operational reads still work", async () => {
  await scenario(async (app, cookie) => {
    const value = await status(app, cookie);
    assert.equal(value.statusCode, 200, value.body);
    assert.equal(value.json().storageConfigured, false);
    assertError(await upload(app, cookie, body()), 503);
    assert.equal((await app.instance.inject({ method: "GET", url: base() + "/profile", headers: { cookie } })).statusCode, 200);
  }, false);
});
test("CERT05 malformed/oversize/bad material reject safely and release the slot for a valid retry", async () => {
  await scenario(async (app, cookie) => {
    const url = base() + "/certificate", secrets = [certificates.passphrase, certificates.materials.valid.pfx.toString("base64")];
    assertError(await app.instance.inject({ method: "PATCH", url, headers: { ...authHeaders(cookie), "content-type": "application/json" }, payload: `{"passphrase":"${secrets[0]}",` }), 400);
    assertError(await upload(app, cookie, body({ pfxBase64: "x".repeat(1500000) })), 413);
    for (const patch of [{ pfxBase64: "!!!!" }, { passphrase: "wrong-generic-password" }, { actorId: "forged" }, { issuerCnpj: "11222333000181" }, { pfxBase64: certificates.materials.wrongIdentity.pfx.toString("base64") }]) assertError(await upload(app, cookie, body(patch)), 400);
    const saved = await upload(app, cookie, body());
    assert.equal(saved.statusCode, 200, saved.body);
    const logs = app.logs.join("\n");
    for (const value of secrets) assert.ok(!logs.includes(value));
    assert.ok(!logs.includes("wrong-generic-password"));
    assert.ok(!logs.includes(keyPath));
  });
});
test("CERT06 interrupted and timed-out HTTP bodies release the single upload slot", async () => {
  await scenario(async (app, cookie) => {
    await app.instance.listen({ host: "127.0.0.1", port: 0 });
    const address = app.instance.server.address();
    assert.ok(address && typeof address === "object");
    const partial = () => {
      const request = http.request({ host: "127.0.0.1", port: address.port, path: base() + "/certificate", method: "PATCH", headers: { ...authHeaders(cookie), "content-type": "application/json", "content-length": "1000" } });
      request.on("error", () => {});
      request.write('{"pfxBase64":');
      return request;
    };
    const first = partial();
    await delay(100);
    try { assertError(await upload(app, cookie, body()), 429); }
    finally { first.destroy(); }
    await delay(100);
    const second = partial();
    try {
      await delay(100);
      assertError(await upload(app, cookie, body()), 429);
      await delay(20500); // Actual HTTP deadline; no production override or clock-derived result.
    } finally { second.destroy(); }
    const saved = await upload(app, cookie, body());
    assert.equal(saved.statusCode, 200, saved.body);
  });
});
