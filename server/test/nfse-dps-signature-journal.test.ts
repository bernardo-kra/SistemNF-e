import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { after, afterEach, before, beforeEach, mock, test } from "node:test";
import { Pool } from "pg";
import { createFixture, TENANT_A, TENANT_B, type Fixture } from "./helpers.ts";
import { createA1Fixture } from "./nfse-a1-fixture.ts";
import { draftInput } from "./nfse-dps-fixture.ts";
import { prepareDpsRequest } from "../src/nfse-dps-journal.ts";
import { saveFiscalRecord } from "../src/fiscal-profile.ts";
import { migrateTenant } from "../src/migrations.ts";

const load = () => import("../src/nfse-dps-signature-journal.ts");
let journal: Awaited<ReturnType<typeof load>>;
let custody: typeof import("../src/nfse-a1-custody.ts");
let fixture: Fixture, pool: Pool, certificates: Awaited<ReturnType<typeof createA1Fixture>>;
const master = randomBytes(32);
const ring = () => ({ activeKeyId: "generic", keys: { generic: master } });
const access = () => ({ pool, tenantId: TENANT_A, actorId: "generic-signature-manager" });
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
let prepared: Awaited<ReturnType<typeof prepareDpsRequest>>;

before(async () => {
  journal = await load(); // RED happens before provisioning any generic DB/certificate.
  custody = await import("../src/nfse-a1-custody.ts");
  fixture = await createFixture();
  pool = new Pool({ connectionString: fixture.a.runtimeUrl, max: 1, connectionTimeoutMillis: 700 });
  await fixture.a.migrationPool.query("INSERT INTO tenant_admission(singleton,slot_id,tenant_id,claimed_at) VALUES(true,$1,$2,clock_timestamp())", [randomUUID(), TENANT_A]);
  certificates = await createA1Fixture(["valid", "different"]);
});
beforeEach(async () => {
  if (!fixture) return;
  await fixture.a.migrationPool.query("TRUNCATE nfse_dps_signature_requests,nfse_dps_signatures,nfse_a1_requests,nfse_a1_custody,fiscal_record_versions,fiscal_settings_requests,fiscal_prepare_requests,fiscal_records,nfse_dps_events,nfse_dps_requests,nfse_dps_drafts,nfse_dps_counters,operational_records,customers,audit_events CASCADE");
  await saveFiscalRecord(access(), "profile", { requestId: randomUUID(), version: 0, cnpj: "11222333000181" });
  await custody.saveA1Certificate(access(), ring(), certificateCommand());
  prepared = await seedDraft();
});
afterEach(() => mock.restoreAll());
after(async () => {
  master.fill(0);
  await certificates?.close();
  await pool?.end();
  await fixture?.close();
});
function certificateCommand(version = 0, name = "valid") {
  return { requestId: randomUUID(), version, profileVersion: 1, issuerCnpj: "11222333000181", credentials: { pfx: certificates.materials[name].pfx, passphrase: certificates.passphrase } };
}
function command(patch: Record<string, unknown> = {}) {
  return { requestId: randomUUID(), draftId: prepared.draftId, certificateVersion: 1, ...patch };
}
async function seedDraft() {
  const customerId = randomUUID(), orderId = randomUUID();
  const { source: _, ...fiscal } = draftInput();
  delete fiscal.issuance.number;
  delete fiscal.customer.name;
  await fixture.a.migrationPool.query("INSERT INTO customers(id,name,type) VALUES($1,'Generic signature customer','Pessoa física')", [customerId]);
  await fixture.a.migrationPool.query("INSERT INTO operational_records(entity_type,id,version,body,created_at,updated_at,created_by,updated_by) VALUES('order',$1,1,$2,clock_timestamp(),clock_timestamp(),'qa','qa')", [orderId, JSON.stringify({ customerId, approved: true, laborCents: 12345 })]);
  return prepareDpsRequest(access(), { requestId: randomUUID(), orderId, orderVersion: 1, fiscal });
}
function safe(code: string) {
  return (error: any) => {
    assert.equal(error.code, code);
    assert.equal(error.cause, undefined);
    assert.doesNotMatch(JSON.stringify(error), /PRIVATE KEY|<DPS|11222333000181/);
    assert.ok(!JSON.stringify(error).includes(certificates.passphrase));
    return true;
  };
}
async function counts() {
  return (await fixture.a.migrationPool.query(`SELECT
    (SELECT count(*)::int FROM nfse_dps_signatures) AS signatures,
    (SELECT count(*)::int FROM nfse_dps_signature_requests) AS requests,
    (SELECT count(*)::int FROM audit_events WHERE action='nfse.dps.signature.store') AS stored,
    (SELECT count(*)::int FROM audit_events WHERE action='fiscal.certificate.sign.offline') AS uses`)).rows[0];
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

test("SP01 persists signed bytes/hashes and public metadata, keeping draft/number/flags unchanged", async () => {
  assert.equal(await journal.getSignedDpsMetadata(access(), prepared.draftId), null);
  const saved = await custody.saveSignedDpsRequest(access(), ring(), command());
  assert.equal(saved.signaturePersisted, true);
  assert.equal(saved.state, "signed_offline");
  assert.equal(saved.draftId, prepared.draftId);
  assert.equal(saved.id, prepared.id);
  assert.equal(saved.certificateVersion, 1);
  assert.equal(saved.actorId, access().actorId);
  assert.equal(saved.sourceXmlSha256, hash(prepared.xml));
  for (const field of ["readyForSubmission", "officialProfileConfirmed", "trustChainVerified", "revocationChecked"] as const) assert.equal(saved[field], false);
  assert.ok(!JSON.stringify(saved).includes(certificates.passphrase));
  assert.doesNotMatch(JSON.stringify(saved), /<DPS|verifiedInfDpsXml|credentials|passphrase|PRIVATE KEY/);
  assert.deepEqual(await journal.getSignedDpsMetadata(access(), prepared.draftId), saved);
  const download = await journal.getSignedDpsXml(access(), prepared.draftId);
  assert.equal(download.xmlSha256, hash(download.xml));
  assert.equal(saved.xmlSha256, download.xmlSha256);
  const { verifyDpsOffline } = await import("../src/nfse-dps-signature.ts");
  assert.equal(verifyDpsOffline({ xml: download.xml, certificatePem: certificates.materials.valid.certificatePem, issuerCnpj: "11222333000181", at: new Date(), profile: "experimental-rsa-sha256-c14n-v1" }).cryptographicSignatureValid, true);
  assert.equal((await fixture.a.migrationPool.query("SELECT xml FROM nfse_dps_drafts")).rows[0].xml, prepared.xml);
  assert.equal((await fixture.a.migrationPool.query("SELECT last_number::text FROM nfse_dps_counters")).rows[0].last_number, "1");
  assert.equal((await fixture.a.migrationPool.query("SELECT count(*)::int AS n FROM nfse_dps_events")).rows[0].n, 1);
  assert.deepEqual(await counts(), { signatures: 1, requests: 1, stored: 1, uses: 1 });
  const audit = JSON.stringify((await fixture.a.migrationPool.query("SELECT * FROM audit_events WHERE action='nfse.dps.signature.store'")).rows);
  assert.doesNotMatch(audit, /11222333000181|<DPS|credentials|PRIVATE KEY/);
});

test("SP02 exact replay after A1 replacement needs no historical key, child or new audit", async () => {
  const intent = command(), saved = await custody.saveSignedDpsRequest(access(), ring(), intent);
  await custody.saveA1Certificate(access(), ring(), certificateCommand(1, "different"));
  const fork = mock.method(childProcess, "fork", () => { throw Error("Unexpected signing child"); });
  const otherKey = randomBytes(32);
  try {
    assert.deepEqual(await custody.saveSignedDpsRequest(access(), { activeKeyId: "new", keys: { new: otherKey } }, intent), saved);
  } finally { otherKey.fill(0); }
  assert.equal(fork.mock.calls.length, 0);
  assert.deepEqual(await counts(), { signatures: 1, requests: 1, stored: 1, uses: 1 });
});

test("SP03 equivalent new request links to original artifact/author without signing again", async () => {
  const saved = await custody.saveSignedDpsRequest(access(), ring(), command());
  const next = command();
  const fork = mock.method(childProcess, "fork", () => { throw Error("Unexpected signing child"); });
  const other = { ...access(), actorId: "other-authorized-manager" };
  assert.deepEqual(await custody.saveSignedDpsRequest(other, ring(), next), saved);
  assert.equal((await fixture.a.migrationPool.query("SELECT actor_id FROM nfse_dps_signature_requests WHERE id=$1", [next.requestId])).rows[0].actor_id, other.actorId);
  assert.equal(fork.mock.calls.length, 0);
  assert.deepEqual(await counts(), { signatures: 1, requests: 2, stored: 1, uses: 1 });
});

test("SP04 conflicting request actor/draft/certificate or re-sign attempt cannot replace artifact", async () => {
  const intent = command(), saved = await custody.saveSignedDpsRequest(access(), ring(), intent);
  const other = await seedDraft();
  for (const [ctx, patch] of [[{ ...access(), actorId: "other-manager" }, {}], [access(), { draftId: other.draftId }], [access(), { certificateVersion: 2 }]] as const) {
    await assert.rejects(custody.saveSignedDpsRequest(ctx, ring(), { ...intent, ...patch }), safe("DPS_SIGNATURE_CONFLICT"));
  }
  await assert.rejects(custody.saveSignedDpsRequest(access(), ring(), command({ certificateVersion: 2 })), safe("DPS_SIGNATURE_CONFLICT"));
  assert.deepEqual(await journal.getSignedDpsMetadata(access(), prepared.draftId), saved);
  assert.deepEqual(await counts(), { signatures: 1, requests: 1, stored: 1, uses: 1 });
});

test("SP05 forged fields, invalid input and unavailable draft fail before computation", async () => {
  const fork = mock.method(childProcess, "fork", () => { throw Error("Unexpected signing child"); });
  for (const patch of [{ xml: "<DPS/>" }, { actorId: "forged" }, { profile: "other" }, { keys: {} }, { certificateVersion: 0 }, { certificateVersion: 1.5 }, { draftId: "bad" }]) {
    await assert.rejects(custody.saveSignedDpsRequest(access(), ring(), command(patch)), safe("INVALID_INPUT"));
  }
  await assert.rejects(custody.saveSignedDpsRequest(access(), ring(), command({ draftId: randomUUID() })), safe("NOT_FOUND"));
  await assert.rejects(custody.saveSignedDpsRequest(access(), ring(), command({ certificateVersion: 2 })), safe("A1_CERTIFICATE_CHANGED"));
  assert.equal(fork.mock.calls.length, 0);
  assert.deepEqual(await counts(), { signatures: 0, requests: 0, stored: 0, uses: 0 });
});

test("SP06 failure in artifact/request/audit rolls back every new effect and retries same intention", async () => {
  const stages = [
    { table: "nfse_dps_signatures", condition: "" },
    { table: "nfse_dps_signature_requests", condition: "" },
    { table: "audit_events", condition: "" },
    // Late failure, after artifact + request + storage audit have already been inserted.
    { table: "audit_events", condition: " WHEN (NEW.action='fiscal.certificate.sign.offline')" },
  ];
  for (const { table, condition } of stages) {
    const draft = table === "nfse_dps_signatures" ? prepared : await seedDraft();
    const intent = command({ draftId: draft.draftId }), previous = await counts();
    await fixture.a.migrationPool.query("CREATE FUNCTION sp_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private generic write error'; END; $$");
    await fixture.a.migrationPool.query(`CREATE TRIGGER sp_fail BEFORE INSERT ON ${table} FOR EACH ROW${condition} EXECUTE FUNCTION sp_fail()`);
    try { await assert.rejects(custody.saveSignedDpsRequest(access(), ring(), intent), safe("SERVICE_UNAVAILABLE")); }
    finally {
      await fixture.a.migrationPool.query(`DROP TRIGGER sp_fail ON ${table}`);
      await fixture.a.migrationPool.query("DROP FUNCTION sp_fail()");
    }
    assert.deepEqual(await counts(), previous);
    assert.equal((await custody.saveSignedDpsRequest(access(), ring(), intent)).signaturePersisted, true);
  }
});

test("SP07 A1 replacement during signing prevents artifact, request and success audit", async () => {
  const gate = gateWorker();
  const pending = custody.saveSignedDpsRequest(access(), ring(), command());
  const rejected = assert.rejects(pending, safe("A1_CERTIFICATE_CHANGED"));
  try {
    await gate.started;
    await fixture.a.migrationPool.query("UPDATE nfse_a1_custody SET version=version+1");
  } finally { gate.release(); }
  await rejected;
  assert.deepEqual(await counts(), { signatures: 0, requests: 0, stored: 0, uses: 0 });
});

test("SP08 signing releases the single DB connection until the crypto child completes", async () => {
  const gate = gateWorker();
  const pending = custody.saveSignedDpsRequest(access(), ring(), command());
  try {
    await gate.started;
    assert.equal(await journal.getSignedDpsMetadata(access(), prepared.draftId), null);
  } finally { gate.release(); }
  assert.equal((await pending).signaturePersisted, true);
});

test("SP09 migration/recovery preserve bytes and runtime cannot alter/delete/truncate artifacts or requests", async () => {
  const saved = await custody.saveSignedDpsRequest(access(), ring(), command());
  const xml = await journal.getSignedDpsXml(access(), prepared.draftId);
  await migrateTenant(fixture.a.migrationPool);
  assert.deepEqual(await journal.getSignedDpsMetadata(access(), prepared.draftId), saved);
  assert.deepEqual(await journal.getSignedDpsXml(access(), prepared.draftId), xml);
  for (const table of ["nfse_dps_signatures", "nfse_dps_signature_requests"]) {
    await assert.rejects(pool.query(`UPDATE ${table} SET actor_id='forged'`));
    await assert.rejects(pool.query(`DELETE FROM ${table}`));
    await assert.rejects(pool.query(`TRUNCATE ${table} CASCADE`));
  }
});

test("SP10 tenant binding prevents metadata/XML/write leaks including stored replay", async () => {
  const intent = command();
  const saved = await custody.saveSignedDpsRequest(access(), ring(), intent);
  const other = { ...access(), tenantId: TENANT_B };
  await assert.rejects(journal.getSignedDpsMetadata(other, prepared.draftId), safe("FORBIDDEN"));
  await assert.rejects(journal.getSignedDpsXml(other, prepared.draftId), safe("FORBIDDEN"));
  await assert.rejects(custody.saveSignedDpsRequest(other, ring(), intent), safe("FORBIDDEN"));
  // Even a bypass of application selection cannot cross the composite tenant FK.
  await assert.rejects(fixture.a.migrationPool.query("INSERT INTO nfse_dps_signature_requests(id,tenant_id,actor_id,signature_id) VALUES($1,$2,'generic',$3)", [randomUUID(), TENANT_B, saved.signatureId]), { code: "23503" });
});

test("SP11 commit recovers another writer's artifact before requiring current A1 or adding audit", async () => {
  // Simulate a second supervisor committing while this supervisor calculates.
  const ephemeral = await custody.signDpsWithStoredA1(access(), ring(), prepared.draftId);
  const gate = gateWorker();
  const pending = custody.saveSignedDpsRequest(access(), ring(), command());
  const signatureId = randomUUID();
  try {
    await gate.started;
    await fixture.a.migrationPool.query(`INSERT INTO nfse_dps_signatures(id,tenant_id,draft_id,certificate_version,certificate_fingerprint,profile,xml,xml_sha256,source_xml_sha256,pending_checks,actor_id)
      VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,$9,'other-supervisor')`, [signatureId, TENANT_A, prepared.draftId, ephemeral.certificateFingerprint256, ephemeral.profile, ephemeral.xml, hash(ephemeral.xml), hash(prepared.xml), ephemeral.pendingChecks]);
    await fixture.a.migrationPool.query("UPDATE nfse_a1_custody SET version=version+1");
  } finally { gate.release(); }
  const recovered = await pending;
  assert.equal(recovered.signatureId, signatureId);
  assert.equal(recovered.actorId, "other-supervisor");
  assert.deepEqual(await counts(), { signatures: 1, requests: 1, stored: 0, uses: 1 });
});

test("SP12 command/key snapshots survive caller mutation and unsigned/missing XML is never invented", async () => {
  await assert.rejects(journal.getSignedDpsXml(access(), prepared.draftId), safe("NOT_FOUND"));
  await assert.rejects(journal.getSignedDpsMetadata(access(), randomUUID()), safe("NOT_FOUND"));
  const intent = command(), original = { ...intent }, callerKey = Buffer.from(master);
  const gate = gateWorker();
  const pending = custody.saveSignedDpsRequest(access(), { activeKeyId: "generic", keys: { generic: callerKey } }, intent);
  try {
    await gate.started;
    intent.draftId = randomUUID();
    intent.certificateVersion = 2;
    callerKey.fill(0);
  } finally { gate.release(); }
  const saved = await pending;
  assert.equal(saved.draftId, original.draftId);
  assert.equal(saved.certificateVersion, 1);
  assert.deepEqual(await custody.saveSignedDpsRequest(access(), ring(), original), saved);
});
