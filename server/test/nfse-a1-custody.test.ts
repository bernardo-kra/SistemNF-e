import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { after, afterEach, before, beforeEach, mock, test } from "node:test";
import { Pool } from "pg";
import { createFixture, TENANT_A, TENANT_B, type Fixture } from "./helpers.ts";
import { createA1Fixture } from "./nfse-a1-fixture.ts";
import { draftInput } from "./nfse-dps-fixture.ts";
import { saveFiscalRecord } from "../src/fiscal-profile.ts";
import { prepareDpsRequest } from "../src/nfse-dps-journal.ts";
import { migrateTenant } from "../src/migrations.ts";

const load = () => import("../src/nfse-a1-custody.ts");
let service: Awaited<ReturnType<typeof load>>;
let fixture: Fixture, certificates: Awaited<ReturnType<typeof createA1Fixture>>, pool: Pool, poolB: Pool;
const tenantC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const first = randomBytes(32), second = randomBytes(32);
const ring = (activeKeyId = "first") => ({ activeKeyId, keys: { first, second } });
const access = (tenantId = TENANT_A) => ({ pool, tenantId, actorId: "generic-a1-manager" });
before(async () => {
  service = await load(); // Missing implementation fails before any database/certificate setup.
  fixture = await createFixture();
  pool = new Pool({ connectionString: fixture.a.runtimeUrl, max: 1, connectionTimeoutMillis: 700 });
  poolB = new Pool({ connectionString: fixture.b.runtimeUrl, max: 1, connectionTimeoutMillis: 700 });
  for (const [database, tenant] of [[fixture.a, TENANT_A], [fixture.b, tenantC]] as const) {
    await database.migrationPool.query("INSERT INTO tenant_admission(singleton,slot_id,tenant_id,claimed_at) VALUES(true,$1,$2,clock_timestamp())", [randomUUID(), tenant]);
  }
  certificates = await createA1Fixture(["valid", "different", "wrongIdentity"]);
});
beforeEach(async () => {
  if (!fixture) return;
  // Only the freshly created generic QA database, never a configured business database.
  await fixture.a.migrationPool.query("TRUNCATE nfse_a1_requests,nfse_a1_custody,fiscal_record_versions,fiscal_settings_requests,fiscal_prepare_requests,fiscal_records,nfse_dps_events,nfse_dps_requests,nfse_dps_drafts,nfse_dps_counters,operational_records,customers,audit_events CASCADE");
  await saveFiscalRecord(access(), "profile", { requestId: randomUUID(), version: 0, cnpj: "11222333000181" });
});
afterEach(() => mock.restoreAll());
after(async () => {
  first.fill(0); second.fill(0);
  await certificates?.close(); await pool?.end(); await poolB?.end(); await fixture?.close();
});
function command(patch: Record<string, unknown> = {}, name = "valid") {
  return { requestId: randomUUID(), version: 0, profileVersion: 1, issuerCnpj: "11222333000181", credentials: { pfx: certificates.materials[name].pfx, passphrase: certificates.passphrase }, ...patch };
}
function safe(code: string) {
  return (error: any) => {
    assert.equal(error.code, code);
    assert.equal(error.cause, undefined);
    const text = JSON.stringify(error);
    for (const secret of [certificates.passphrase, first.toString("base64"), second.toString("base64")]) assert.ok(!text.includes(secret));
    assert.doesNotMatch(text, /PRIVATE KEY|<DPS|11222333000181/);
    return true;
  };
}
async function row() { return (await fixture.a.migrationPool.query("SELECT * FROM nfse_a1_custody WHERE tenant_id=$1", [TENANT_A])).rows[0]; }
async function counts() {
  return (await fixture.a.migrationPool.query("SELECT (SELECT count(*)::int FROM nfse_a1_custody) AS certificates,(SELECT count(*)::int FROM nfse_a1_requests) AS requests,(SELECT count(*)::int FROM audit_events WHERE action LIKE 'fiscal.certificate.%') AS events")).rows[0];
}
async function draft() {
  const orderId = randomUUID(), customerId = randomUUID(), input = draftInput();
  const { source: _, ...fiscal } = input;
  delete fiscal.issuance.number; delete fiscal.customer.name;
  await fixture.a.migrationPool.query("INSERT INTO customers(id,name,type) VALUES($1,'Generic A1 customer','Pessoa física')", [customerId]);
  await fixture.a.migrationPool.query("INSERT INTO operational_records(entity_type,id,version,body,created_at,updated_at,created_by,updated_by) VALUES('order',$1,1,$2,clock_timestamp(),clock_timestamp(),'qa','qa')", [orderId, JSON.stringify({ customerId, approved: true, laborCents: 12345 })]);
  return prepareDpsRequest(access(), { requestId: randomUUID(), orderId, orderVersion: 1, fiscal });
}
function gateWorker() {
  const nativeFork = childProcess.fork;
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  mock.method(childProcess, "fork", (...args: Parameters<typeof nativeFork>) => {
    const child = nativeFork(...args), send = child.send.bind(child);
    child.send = ((...sendArgs: any[]) => { entered(); void gate.then(() => (send as any)(...sendArgs)); return true; }) as any;
    return child;
  });
  return { started, release };
}

test("A1C01 stores encrypted material and returns only metadata without inventing fiscal readiness", async () => {
  assert.equal(await service.readA1Certificate(access()), null);
  const data = command(), original = Buffer.from(data.credentials.pfx);
  const saved = await service.saveA1Certificate(access(), ring(), data);
  assert.equal(saved.version, 1); assert.equal(saved.issuerCnpj, data.issuerCnpj);
  assert.equal(saved.updatedBy, access().actorId);
  for (const name of ["readyForSubmission", "officialProfileConfirmed", "trustChainVerified", "revocationChecked"] as const) assert.equal(saved[name], false);
  const stored = await row();
  assert.equal(stored.nonce.length, 12); assert.equal(stored.tag.length, 16);
  assert.ok(!stored.ciphertext.includes(data.credentials.pfx));
  assert.ok(!stored.ciphertext.includes(Buffer.from(certificates.passphrase)));
  assert.deepEqual(data.credentials.pfx, original);
  const returned = JSON.stringify(saved);
  assert.ok(!returned.includes(certificates.passphrase)); assert.doesNotMatch(returned, /ciphertext|credentials|passphrase|PRIVATE KEY/);
  const audit = JSON.stringify((await fixture.a.migrationPool.query("SELECT * FROM audit_events WHERE action LIKE 'fiscal.certificate.%'")).rows);
  assert.ok(!audit.includes(certificates.passphrase)); assert.doesNotMatch(audit, /11222333000181|ciphertext|<DPS/);
  assert.deepEqual(await service.readA1Certificate(access()), saved);
});

test("A1C02 noop keeps version/time/audit; exact replay returns original metadata after later edits", async () => {
  const initial = command(), saved = await service.saveA1Certificate(access(), ring(), initial);
  const same = await service.saveA1Certificate(access(), ring(), command({ version: 1 }));
  assert.deepEqual(same, saved);
  assert.deepEqual(await counts(), { certificates: 1, requests: 2, events: 1 });
  await service.saveA1Certificate(access(), ring(), command({ version: 1 }, "different"));
  await saveFiscalRecord(access(), "profile", { requestId: randomUUID(), version: 1, cnpj: "11444777000161" });
  assert.deepEqual(await service.saveA1Certificate(access(), ring(), initial), saved);
  await assert.rejects(service.saveA1Certificate({ ...access(), actorId: "other-manager" }, ring(), initial), safe("VERSION_CONFLICT"));
  await assert.rejects(service.saveA1Certificate(access(), ring(), { ...initial, credentials: { ...initial.credentials, passphrase: "wrong" } }), safe("VERSION_CONFLICT"));
});

test("A1C03 stale version, profile mismatch and rejected material leave custody unchanged", async () => {
  await service.saveA1Certificate(access(), ring(), command());
  const previous = await row(), before = await counts();
  await assert.rejects(service.saveA1Certificate(access(), ring(), command()), safe("VERSION_CONFLICT"));
  await assert.rejects(service.saveA1Certificate(access(), ring(), command({ version: 1, profileVersion: 2 })), safe("A1_PROFILE_CONFLICT"));
  await assert.rejects(service.saveA1Certificate(access(), ring(), command({ version: 1 }, "wrongIdentity")), safe("A1_CERTIFICATE_REJECTED"));
  await assert.rejects(service.saveA1Certificate(access(), ring(), command({ version: 1, credentials: { pfx: certificates.materials.valid.pfx, passphrase: "wrong" } })), safe("A1_CERTIFICATE_REJECTED"));
  assert.deepEqual(await row(), previous); assert.deepEqual(await counts(), before);
});

test("A1C04 tenant binding and unavailable keys fail closed without exposing a credential", async () => {
  await service.saveA1Certificate(access(), ring(), command());
  await assert.rejects(service.readA1Certificate(access(TENANT_B)), safe("FORBIDDEN"));
  await assert.rejects(service.saveA1Certificate(access(TENANT_B), ring(), command({ version: 1 })), safe("FORBIDDEN"));
  const before = await row();
  for (const bad of [undefined, { activeKeyId: "missing", keys: {} }, { activeKeyId: "first", keys: { first: Buffer.alloc(31) } }]) {
    await assert.rejects(service.saveA1Certificate(access(), bad as any, command({ version: 1 })), safe("A1_KEY_UNAVAILABLE"));
  }
  assert.deepEqual(await row(), before);
});

test("A1C05 ciphertext, nonce, tag and bound metadata tampering are rejected before the signer", async () => {
  await service.saveA1Certificate(access(), ring(), command());
  const prepared = await draft(), original = await row();
  const spy = mock.method(childProcess, "fork", () => { throw Error("must not reach a child"); });
  for (const [column, value] of [
    ["ciphertext", Buffer.alloc(original.ciphertext.length)], ["nonce", randomBytes(12)], ["tag", randomBytes(16)],
    ["issuer_cnpj", "11444777000161"], ["fingerprint", "b".repeat(64)], ["version", 2],
    ["valid_to", new Date(original.valid_to.getTime() + 1000)], ["updated_by", "forged-actor"],
  ] as const) {
    await fixture.a.migrationPool.query(`UPDATE nfse_a1_custody SET ${column}=$1 WHERE tenant_id=$2`, [value, TENANT_A]);
    await assert.rejects(service.signDpsWithStoredA1(access(), ring(), prepared.draftId), safe("A1_CUSTODY_INTEGRITY"));
    await fixture.a.migrationPool.query(`UPDATE nfse_a1_custody SET ${column}=$1 WHERE tenant_id=$2`, [original[column], TENANT_A]);
  }
  await assert.rejects(service.signDpsWithStoredA1(access(), { activeKeyId: "first", keys: { first: randomBytes(32) } }, prepared.draftId), safe("A1_CUSTODY_INTEGRITY"));
  assert.equal(spy.mock.callCount(), 0);
});

test("A1C06 failed audit/request atomically rolls back ciphertext and retries the same intention", async () => {
  const data = command();
  await fixture.a.migrationPool.query("CREATE FUNCTION qa_a1_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'generic private A1 fault'; END; $$");
  for (const table of ["audit_events", "nfse_a1_requests"]) {
    await fixture.a.migrationPool.query(`CREATE TRIGGER qa_a1_fault BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION qa_a1_fault()`);
    try { await assert.rejects(service.saveA1Certificate(access(), ring(), data), safe("SERVICE_UNAVAILABLE")); }
    finally { await fixture.a.migrationPool.query(`DROP TRIGGER qa_a1_fault ON ${table}`); }
    assert.equal(await service.readA1Certificate(access()), null);
    assert.deepEqual(await counts(), { certificates: 0, requests: 0, events: 0 });
  }
  await fixture.a.migrationPool.query("DROP FUNCTION qa_a1_fault()");
  assert.equal((await service.saveA1Certificate(access(), ring(), data)).version, 1);
});

test("A1C07 active key replacement reencrypts and old-key retries stay original or fail closed", async () => {
  const data = command(), original = await service.saveA1Certificate(access(), ring(), data), old = await row();
  const next = await service.saveA1Certificate(access(), ring("second"), command({ version: 1 }));
  assert.equal(next.version, 2); assert.equal(next.keyId, "second");
  assert.ok(!(await row()).ciphertext.equals(old.ciphertext));
  assert.deepEqual(await service.saveA1Certificate(access(), ring("second"), data), original);
  await assert.rejects(service.saveA1Certificate(access(), { activeKeyId: "second", keys: { second } }, data), safe("A1_KEY_UNAVAILABLE"));
  assert.equal((await service.readA1Certificate(access()))?.version, 2);
});

test("A1C08 stored A1 signs only the persisted draft, preserving number/XML and recording no new reservation", async () => {
  const saved = await service.saveA1Certificate(access(), ring(), command()), prepared = await draft();
  const result = await service.signDpsWithStoredA1(access(), ring(), prepared.draftId);
  assert.equal(result.certificateVersion, 1); assert.equal(result.certificateFingerprint256, saved.certificateFingerprint256);
  assert.equal(result.draftId, prepared.draftId); assert.equal(result.id, prepared.id);
  assert.equal(result.signaturePersisted, false); assert.equal(result.readyForSubmission, false);
  assert.equal(result.executionIsolated, true);
  const repeated = await service.signDpsWithStoredA1(access(), ring(), prepared.draftId);
  assert.equal(repeated.id, result.id);
  const uses = (await fixture.a.migrationPool.query("SELECT entity_version,after_values FROM audit_events WHERE entity_type='nfse_dps_signature' ORDER BY entity_version")).rows;
  assert.deepEqual(uses.map(row => row.entity_version), [1, 2]);
  assert.deepEqual(uses.map(row => row.after_values), [
    { draftId: prepared.draftId, certificateVersion: 1, orderVersion: 1 },
    { draftId: prepared.draftId, certificateVersion: 1, orderVersion: 1 },
  ]);
  const { verifyDpsOffline } = await import("../src/nfse-dps-signature.ts");
  assert.equal(verifyDpsOffline({ xml: result.xml, certificatePem: certificates.materials.valid.certificatePem, issuerCnpj: "11222333000181", at: new Date(), profile: "experimental-rsa-sha256-c14n-v1" }).cryptographicSignatureValid, true);
  assert.equal((await fixture.a.migrationPool.query("SELECT count(*)::int AS n FROM nfse_dps_drafts")).rows[0].n, 1);
  assert.equal((await fixture.a.migrationPool.query("SELECT xml FROM nfse_dps_drafts")).rows[0].xml, prepared.xml);
  assert.equal((await fixture.a.migrationPool.query("SELECT count(*)::int AS n FROM nfse_dps_events")).rows[0].n, 1);
  assert.ok(!JSON.stringify(result).includes(certificates.passphrase));
});

test("A1C09 profile change during inspection uses no held connection and prevents stale commit", async () => {
  const gate = gateWorker();
  const pending = service.saveA1Certificate(access(), ring(), command());
  const rejection = assert.rejects(pending, safe("A1_PROFILE_CONFLICT"));
  try {
    await gate.started;
    await saveFiscalRecord(access(), "profile", { requestId: randomUUID(), version: 1, cnpj: "11444777000161" });
  } finally { gate.release(); }
  await rejection;
  assert.equal(await service.readA1Certificate(access()), null);
});

test("A1C10 A1 replacement during signing refuses the outdated result before audit/success", async () => {
  await service.saveA1Certificate(access(), ring(), command()); const prepared = await draft();
  const gate = gateWorker();
  const pending = service.signDpsWithStoredA1(access(), ring(), prepared.draftId);
  const rejection = assert.rejects(pending, safe("A1_CERTIFICATE_CHANGED"));
  try { await gate.started; await fixture.a.migrationPool.query("UPDATE nfse_a1_custody SET version=version+1 WHERE tenant_id=$1", [TENANT_A]); }
  finally { gate.release(); }
  await rejection;
  assert.equal((await counts()).events, 1);
});

test("A1C11 keyring snapshot survives caller mutation and migration preserves encrypted data/immutable attempts", async () => {
  const originalKey = Buffer.from(first), callerKey = Buffer.from(first);
  const gate = gateWorker();
  const pending = service.saveA1Certificate(access(), { activeKeyId: "first", keys: { first: callerKey } }, command());
  try { await gate.started; callerKey.fill(0); } finally { gate.release(); }
  await pending;
  mock.restoreAll();
  const stored = await row(); await migrateTenant(fixture.a.migrationPool);
  assert.deepEqual(await row(), stored);
  const prepared = await draft();
  try { assert.equal((await service.signDpsWithStoredA1(access(), { activeKeyId: "first", keys: { first: originalKey } }, prepared.draftId)).readyForSubmission, false); }
  finally { originalKey.fill(0); callerKey.fill(0); }
  await assert.rejects(pool.query("UPDATE nfse_a1_requests SET actor_id='forged'"));
  await assert.rejects(pool.query("DELETE FROM nfse_a1_requests"));
  await assert.rejects(pool.query("TRUNCATE nfse_a1_custody"));
});

test("A1C12 invalid CNPJ checksum is a sanitized input error, not service unavailability", async () => {
  await assert.rejects(service.saveA1Certificate(access(), ring(), command({ issuerCnpj: "11222333000182" })), error => {
    safe("A1_INVALID_INPUT")(error);
    assert.equal((error as any).statusCode, 400);
    return true;
  });
  assert.equal(await service.readA1Certificate(access()), null);
});

test("A1C13 canonical tenant identity keeps ciphertext usable and ciphertext copied from another tenant fails", async () => {
  const other = { ...access(), pool: poolB, tenantId: tenantC };
  await saveFiscalRecord(other, "profile", { requestId: randomUUID(), version: 0, cnpj: "11222333000181" });
  const saved = await service.saveA1Certificate({ ...other, tenantId: tenantC.toUpperCase() }, ring(), command());
  assert.deepEqual(await service.saveA1Certificate(other, ring(), command({ version: 1 })), saved);
  await service.saveA1Certificate(access(), ring(), command());
  const prepared = await draft();
  const source = (await fixture.b.migrationPool.query("SELECT * FROM nfse_a1_custody")).rows[0];
  await fixture.a.migrationPool.query("UPDATE nfse_a1_custody SET nonce=$1,tag=$2,ciphertext=$3,updated_at=$4 WHERE tenant_id=$5", [source.nonce, source.tag, source.ciphertext, source.updated_at, TENANT_A]);
  await assert.rejects(service.signDpsWithStoredA1(access(), ring(), prepared.draftId), safe("A1_CUSTODY_INTEGRITY"));
});
