import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { Pool } from "pg";
import { createFixture, TENANT_A, TENANT_B, type Fixture } from "./helpers.ts";
import { createA1Fixture } from "./nfse-a1-fixture.ts";
import { draftInput } from "./nfse-dps-fixture.ts";
import { prepareDpsRequest } from "../src/nfse-dps-journal.ts";
import { signDpsOffline, experimentalSignatureProfile } from "../src/nfse-dps-signature.ts";

const load = (): Promise<typeof import("../src/nfse-dps-submission-journal.ts")> => process.env.SISTEM_QA_COMPILED_SUBMISSION === "true"
  ? import(new URL("../dist/nfse-dps-submission-journal.js", import.meta.url).href)
  : import("../src/nfse-dps-submission-journal.ts");
let journal: Awaited<ReturnType<typeof load>>, fixture: Fixture, pool: Pool;
let certificate: Awaited<ReturnType<typeof createA1Fixture>>;
const actorId = "generic-dispatch-coordinator";
const access = () => ({ pool, tenantId: TENANT_A, actorId });
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const errorCode = (code: string) => (error: any) => { assert.equal(error.code, code); assert.doesNotMatch(JSON.stringify(error), /<DPS|PRIVATE KEY|postgresql|private-response/); return true; };

before(async () => {
  journal = await load(); // RED before provisioning DB/certificate.
  fixture = await createFixture();
  pool = new Pool({ connectionString: fixture.a.runtimeUrl, max: 2 });
  certificate = await createA1Fixture(["valid"]);
  for (const [db, tenant] of [[fixture.a, TENANT_A], [fixture.b, TENANT_B]] as const)
    await db.migrationPool.query("INSERT INTO tenant_admission(singleton,slot_id,tenant_id,claimed_at) VALUES(true,$1,$2,clock_timestamp())", [randomUUID(), tenant]);
});
after(async () => { await certificate?.close(); await pool?.end(); await fixture?.close(); });

async function signedDraft(scope = access(), database = fixture.a) {
  const customerId = randomUUID(), orderId = randomUUID(), signatureId = randomUUID();
  const { source: _, ...fiscal } = draftInput(); delete fiscal.issuance.number; delete fiscal.customer.name;
  await database.migrationPool.query("INSERT INTO customers(id,name,type) VALUES($1,'Generic dispatch customer','Pessoa física')", [customerId]);
  await database.migrationPool.query("INSERT INTO operational_records(entity_type,id,version,body,created_at,updated_at,created_by,updated_by) VALUES('order',$1,1,$2,clock_timestamp(),clock_timestamp(),'qa','qa')", [orderId, JSON.stringify({ customerId, approved: true, laborCents: 12345 })]);
  const draft = await prepareDpsRequest(scope, { requestId: randomUUID(), orderId, orderVersion: 1, fiscal });
  const signed = signDpsOffline({ xml: draft.xml, issuerCnpj: "11222333000181", at: certificate.now, profile: experimentalSignatureProfile, credentials: { pfx: certificate.materials.valid.pfx, passphrase: certificate.passphrase } });
  // Persist actual generic offline bytes as upstream signer fixture, not an official trusted certificate.
  await database.migrationPool.query(`INSERT INTO nfse_dps_signatures(id,tenant_id,draft_id,certificate_version,certificate_fingerprint,profile,xml,xml_sha256,source_xml_sha256,pending_checks,actor_id)
    VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10)`, [signatureId, scope.tenantId, draft.draftId, signed.certificateFingerprint256, signed.profile, signed.xml, hash(signed.xml), hash(draft.xml), signed.pendingChecks, actorId]);
  return { signatureId, draft, signed };
}
const startInput = (signatureId: string, requestId: string = randomUUID()) => ({ requestId, signatureId });
const outcome = (attempt: { id: string; version: number }, patch: Record<string, unknown> = {}) => ({ requestId: randomUUID(), attemptId: attempt.id, version: attempt.version, phase: "submission", outcome: "result_unknown", ...patch });
const receipt = { outcome: "response_unverified", httpStatus: 200, responseSha256: hash("generic-private-response") };
async function unaffected() {
  const snapshot = [];
  for (const table of ["operational_records", "stock_balances", "stock_movements", "finance_agreements", "finance_payments", "finance_movements", "fiscal_records", "nfse_dps_counters", "nfse_dps_drafts", "nfse_dps_signatures", "nfse_a1_custody"])
    snapshot.push((await fixture.a.migrationPool.query(`SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) v FROM ${table} t`)).rows[0].v);
  return snapshot;
}

test("JT01 reserva snapshot assinado uma vez, sem expor XML nem habilitar emissão", async () => {
  await assert.rejects(journal.startDpsSubmission(access(), startInput(randomUUID())), errorCode("NOT_FOUND"));
  const source = await signedDraft(), before = await unaffected();
  await assert.rejects(journal.startDpsSubmission(access(), startInput(source.draft.draftId)), errorCode("NOT_FOUND"));
  const result = await journal.startDpsSubmission(access(), startInput(source.signatureId));
  assert.equal(result.claimed, true); const attempt = result.attempt;
  assert.equal(attempt.state, "dispatch_reserved"); assert.equal(attempt.version, 1); assert.equal(attempt.signatureId, source.signatureId);
  assert.equal(attempt.draftId, source.draft.draftId); assert.equal(attempt.dpsId, source.draft.id); assert.equal(attempt.xmlSha256, hash(source.signed.xml));
  assert.equal(attempt.environment, "production-restricted"); assert.equal(attempt.readyForSubmission, false); assert.equal(attempt.officialAuthorization, false);
  assert.equal(Date.parse(attempt.expiresAt) - Date.parse(attempt.createdAt), 120000); assert.equal(attempt.events.length, 1);
  for (const key of ["xml", "credentials", "passphrase", "payload", "accessKey", "protocol"]) assert.equal(Object.hasOwn(attempt, key), false);
  assert.deepEqual(await unaffected(), before);
});

test("JT09 caixa do UUID da empresa não muda identidade do replay", async () => {
  const database = await fixture.cluster.createDatabase("tenant_case");
  const { migrateTenant } = await import("../src/migrations.ts"); await migrateTenant(database.migrationPool); await database.grantRuntime();
  const tenant = "abcdabcd-abcd-4abc-8abc-abcdabcdabcd", scopedPool = new Pool({ connectionString: database.runtimeUrl, max: 1 });
  await database.migrationPool.query("INSERT INTO tenant_admission(singleton,slot_id,tenant_id,claimed_at) VALUES(true,$1,$2,clock_timestamp())", [randomUUID(), tenant]);
  const lower = { pool: scopedPool, tenantId: tenant, actorId }, upper = { ...lower, tenantId: tenant.toUpperCase() };
  try {
    const source = await signedDraft(lower, database), command = startInput(source.signatureId);
    const first = await journal.startDpsSubmission(lower, command), repeated = await journal.startDpsSubmission(upper, command);
    assert.equal(repeated.claimed, false); assert.deepEqual(repeated.attempt, first.attempt);
    const receiptCommand = outcome(first.attempt, receipt), saved = await journal.recordDpsSubmissionOutcome(lower, receiptCommand);
    assert.deepEqual(await journal.recordDpsSubmissionOutcome(upper, receiptCommand), saved);
  } finally { await scopedPool.end(); }
});

test("JT02 concorrência/replay/equivalência não concedem segunda posse de tentativa", async () => {
  const source = await signedDraft(), command = startInput(source.signatureId);
  const results = await Promise.all([journal.startDpsSubmission(access(), command), journal.startDpsSubmission(access(), command), journal.startDpsSubmission(access(), startInput(source.signatureId))]);
  assert.equal(results.filter(r => r.claimed).length, 1); assert.equal(new Set(results.map(r => r.attempt.id)).size, 1);
  assert.equal((await journal.startDpsSubmission(access(), command)).claimed, false);
  await assert.rejects(journal.startDpsSubmission({ ...access(), actorId: "other-generic-actor" }, command), errorCode("DPS_SUBMISSION_CONFLICT"));
  const other = await signedDraft(); await assert.rejects(journal.startDpsSubmission(access(), { ...command, signatureId: other.signatureId }), errorCode("DPS_SUBMISSION_CONFLICT"));
});

test("JT03 desconhecido exige consulta, nunca reenvio; recibo não comprova autorização", async () => {
  const source = await signedDraft(), before = await unaffected(), command = startInput(source.signatureId), first = await journal.startDpsSubmission(access(), command);
  const unknownCommand = outcome(first.attempt), unknown = await journal.recordDpsSubmissionOutcome(access(), unknownCommand);
  assert.equal(unknown.state, "result_unknown"); assert.equal(unknown.version, 2);
  assert.equal((await journal.startDpsSubmission(access(), startInput(source.signatureId))).claimed, false);
  await assert.rejects(journal.recordDpsSubmissionOutcome(access(), outcome(unknown, receipt)), errorCode("DPS_SUBMISSION_CONFLICT"));
  const lookupCommand = outcome(unknown, { ...receipt, phase: "lookup" });
  const received = await journal.recordDpsSubmissionOutcome(access(), lookupCommand);
  assert.equal(received.id, first.attempt.id); assert.equal(received.state, "response_unverified"); assert.equal(received.version, 3);
  assert.equal(received.officialAuthorization, false); assert.equal(received.readyForSubmission, false); assert.equal(received.httpStatus, 200);
  assert.equal(received.responseSha256, receipt.responseSha256); assert.equal(received.events.length, 3);
  assert.deepEqual(await journal.recordDpsSubmissionOutcome(access(), lookupCommand), received);
  assert.deepEqual(await journal.recordDpsSubmissionOutcome(access(), unknownCommand), received);
  assert.equal((await journal.startDpsSubmission(access(), command)).claimed, false);
  assert.deepEqual(await unaffected(), before);
});

test("JT04 resposta HTTP422 permanece não verificada e estado terminal não é rearmado", async () => {
  const source = await signedDraft(), first = await journal.startDpsSubmission(access(), startInput(source.signatureId));
  // Deadline enables explicit interrupted-worker recovery; receiving evidence first is still useful.
  await fixture.a.migrationPool.query("UPDATE nfse_dps_submission_attempts SET created_at=clock_timestamp()-interval '3 minutes',updated_at=clock_timestamp()-interval '3 minutes',expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1", [first.attempt.id]);
  const received = await journal.recordDpsSubmissionOutcome(access(), outcome(first.attempt, { ...receipt, httpStatus: 422 }));
  assert.equal(received.state, "response_unverified"); assert.equal(received.officialAuthorization, false);
  await assert.rejects(journal.recordDpsSubmissionOutcome(access(), outcome(received)), errorCode("DPS_SUBMISSION_CONFLICT"));
  await assert.rejects(journal.recoverExpiredDpsSubmission(access(), { requestId: randomUUID(), attemptId: received.id, version: received.version }), errorCode("DPS_SUBMISSION_CONFLICT"));
  assert.equal((await journal.startDpsSubmission(access(), startInput(source.signatureId))).claimed, false);
});

test("JT05 leitura não expira reserva; recuperação usa prazo do banco e bloqueia resultado tardio", async () => {
  const source = await signedDraft(), first = await journal.startDpsSubmission(access(), startInput(source.signatureId));
  const recover = { requestId: randomUUID(), attemptId: first.attempt.id, version: 1 };
  await assert.rejects(journal.recoverExpiredDpsSubmission(access(), recover), errorCode("DPS_SUBMISSION_CONFLICT"));
  // Age only the generic fixture; no waiting or supplied application clock is trusted.
  await fixture.a.migrationPool.query("UPDATE nfse_dps_submission_attempts SET created_at=clock_timestamp()-interval '3 minutes',updated_at=clock_timestamp()-interval '3 minutes',expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1", [first.attempt.id]);
  assert.equal((await journal.getDpsSubmission(access(), first.attempt.id)).state, "dispatch_reserved");
  const recovered = await journal.recoverExpiredDpsSubmission(access(), recover);
  assert.equal(recovered.state, "result_unknown"); assert.equal(recovered.events.at(-1)!.reason, "deadline_elapsed");
  assert.deepEqual(await journal.recoverExpiredDpsSubmission(access(), recover), recovered);
  await assert.rejects(journal.recordDpsSubmissionOutcome(access(), outcome(first.attempt, receipt)), errorCode("DPS_SUBMISSION_CONFLICT"));
  assert.equal((await journal.startDpsSubmission(access(), startInput(source.signatureId))).claimed, false);
});

test("JT06 entradas/recibos forjados não escrevem; chave não muda de comando", async () => {
  const source = await signedDraft(), command = startInput(source.signatureId), first = await journal.startDpsSubmission(access(), command);
  for (const patch of [{ version: 0 }, { environment: "production" }, { outcome: "authorized" }, { payload: "private-response" }, { ...receipt, responseSha256: "bad" }, { ...receipt, httpStatus: 999 }, { ...receipt, phase: "lookup" }]) {
    const expected = "phase" in patch && patch.phase === "lookup" ? "DPS_SUBMISSION_CONFLICT" : "INVALID_INPUT";
    await assert.rejects(journal.recordDpsSubmissionOutcome(access(), outcome(first.attempt, patch)), errorCode(expected));
  }
  await assert.rejects(journal.startDpsSubmission(access(), { ...command, xml: "<DPS/>" }), errorCode("INVALID_INPUT"));
  await assert.rejects(journal.recordDpsSubmissionOutcome(access(), outcome(first.attempt, { requestId: command.requestId })), errorCode("DPS_SUBMISSION_CONFLICT"));
  assert.equal((await journal.getDpsSubmission(access(), first.attempt.id)).version, 1);
});

test("JT07 vínculo de empresa é exigido em leitura e comandos internos", async () => {
  const source = await signedDraft(), first = await journal.startDpsSubmission(access(), startInput(source.signatureId));
  const wrong = { ...access(), tenantId: TENANT_B };
  await assert.rejects(journal.getDpsSubmission(wrong, first.attempt.id), errorCode("FORBIDDEN"));
  await assert.rejects(journal.startDpsSubmission(wrong, startInput(source.signatureId)), errorCode("FORBIDDEN"));
  const other = new Pool({ connectionString: fixture.b.runtimeUrl, max: 1 });
  try { await assert.rejects(journal.getDpsSubmission({ ...wrong, pool: other }, first.attempt.id), errorCode("NOT_FOUND")); }
  finally { await other.end(); }
});

test("JT08 auditoria falha desfaz conjunto; eventos/pedidos e migração preservam histórico", async () => {
  const source = await signedDraft(), command = startInput(source.signatureId), role = fixture.a.runtimeUser;
  await fixture.a.migrationPool.query(`REVOKE INSERT ON audit_events FROM "${role}"`);
  try { await assert.rejects(journal.startDpsSubmission(access(), command), errorCode("SERVICE_UNAVAILABLE")); }
  finally { await fixture.a.migrationPool.query(`GRANT INSERT ON audit_events TO "${role}"`); }
  const first = await journal.startDpsSubmission(access(), command); assert.equal(first.claimed, true);
  const next = outcome(first.attempt);
  await fixture.a.migrationPool.query(`REVOKE INSERT ON audit_events FROM "${role}"`);
  try { await assert.rejects(journal.recordDpsSubmissionOutcome(access(), next), errorCode("SERVICE_UNAVAILABLE")); }
  finally { await fixture.a.migrationPool.query(`GRANT INSERT ON audit_events TO "${role}"`); }
  assert.equal((await journal.getDpsSubmission(access(), first.attempt.id)).version, 1);
  const saved = await journal.recordDpsSubmissionOutcome(access(), next); assert.equal(saved.events.length, 2);
  for (const sql of ["UPDATE nfse_dps_submission_events SET reason='reserved' WHERE attempt_id=$1", "DELETE FROM nfse_dps_submission_attempts WHERE id=$1", "UPDATE nfse_dps_submission_requests SET actor_id='changed' WHERE attempt_id=$1"])
    await assert.rejects(fixture.a.migrationPool.query(sql, [saved.id]));
  const { migrateTenant } = await import("../src/migrations.ts"); await migrateTenant(fixture.a.migrationPool);
  assert.deepEqual(await journal.getDpsSubmission(access(), saved.id), saved);
});
