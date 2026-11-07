import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { Pool } from "pg";
import { createTestCluster } from "../scripts/test-cluster.ts";
import { migrateTenant } from "../src/migrations.ts";
import { draftInput } from "./nfse-dps-fixture.ts";

// NFSD-J: generic isolated data and expectations defined before journal implementation.
const tenantA = "10000000-0000-4000-8000-000000000001", tenantB = "20000000-0000-4000-8000-000000000002";
let cluster: Awaited<ReturnType<typeof createTestCluster>>;
let dbA: Awaited<ReturnType<typeof cluster.createDatabase>>, dbB: typeof dbA;
let pool: Pool, otherPool: Pool;
let journal: typeof import("../src/nfse-dps-journal.ts");
const access = () => ({ pool, tenantId: tenantA, actorId: "generic-qa-actor" });
before(async () => {
  journal = await import("../src/nfse-dps-journal.ts");
  cluster = await createTestCluster(); dbA = await cluster.createDatabase("journal_a"); dbB = await cluster.createDatabase("journal_b");
  for (const [db, tenant] of [[dbA, tenantA], [dbB, tenantB]] as const) {
    await migrateTenant(db.migrationPool);
    await db.migrationPool.query("INSERT INTO tenant_admission(singleton,slot_id,tenant_id,claimed_at) VALUES(true,$1,$2,clock_timestamp())", [randomUUID(), tenant]);
    await db.grantRuntime();
  }
  pool = new Pool({ connectionString: dbA.runtimeUrl, max: 4 }); otherPool = new Pool({ connectionString: dbB.runtimeUrl, max: 2 });
});
after(async () => { await pool?.end(); await otherPool?.end(); await cluster?.stop(); });
async function seed(overrides: Record<string, unknown> = {}) {
  const orderId = randomUUID(), customerId = randomUUID();
  await dbA.migrationPool.query("INSERT INTO customers(id,name,type) VALUES($1,'Cliente genérico do banco','Pessoa física')", [customerId]);
  const body = { customerId, customerName: "Nome antigo da OS", approved: true, laborCents: 12345, stage: "ready_for_pickup", unlockPassword: "NEVER-COPY-DEVICE-SECRET", ...overrides };
  await dbA.migrationPool.query("INSERT INTO operational_records(entity_type,id,body,version,created_at,updated_at,created_by,updated_by) VALUES('order',$1,$2,1,clock_timestamp(),clock_timestamp(),'qa','qa')", [orderId, JSON.stringify(body)]);
  return { orderId, customerId };
}
function command(orderId: string, series = "1") {
  const fiscal = draftInput(); delete fiscal.source; delete fiscal.issuance.number; delete fiscal.customer.name;
  fiscal.issuance.series = series;
  return { requestId: randomUUID(), orderId, orderVersion: 1, fiscal };
}
async function fails(run: () => Promise<unknown>, code: string) {
  await assert.rejects(run, (error: any) => { assert.equal(error.code, code); assert.doesNotMatch(error.message, /NEVER-COPY|SELECT |INSERT |password|<DPS|11222333000181/); return true; });
}
async function count(table: string) { return (await dbA.migrationPool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n as number; }
async function counter(series: string) { return (await dbA.migrationPool.query("SELECT last_number::text AS number FROM nfse_dps_counters WHERE series=$1", [series])).rows[0]?.number; }

test("NFSDJ01 grava cópia validada, origem, autoria/hora; reutiliza nome e valor do banco sem senha ou efeito operacional", async () => {
  const { orderId, customerId } = await seed(), body = command(orderId);
  const before = await dbA.migrationPool.query("SELECT body,version,updated_at FROM operational_records WHERE id=$1", [orderId]);
  const balances = await count("stock_balances"), payments = await count("finance_payments");
  const saved = await journal.prepareDpsRequest(access(), body);
  assert.equal(saved.orderId, orderId); assert.equal(saved.customerId, customerId); assert.equal(saved.orderVersion, 1);
  assert.equal(saved.number, "1"); assert.equal(saved.series, "1"); assert.equal(saved.state, "unsigned_draft"); assert.equal(saved.actorId, access().actorId);
  assert.equal(saved.environment, "production-restricted"); assert.equal(saved.numberReserved, true); assert.equal(saved.readyForSubmission, false);
  assert.equal(saved.serviceAmountCents, 12345); assert.equal(saved.excludedPartsCents, null); assert.match(saved.createdAt, /Z$/);
  assert.match(saved.xml, /<xNome>Cliente genérico do banco<\/xNome>/); assert.match(saved.xml, /<vServ>123.45<\/vServ>/);
  assert.doesNotMatch(saved.xml, /Nome antigo|NEVER-COPY|unlockPassword|Signature/);
  assert.ok(saved.pendingChecks.includes("CERTIFICATE_AND_SIGNATURE_REQUIRED")); assert.ok(saved.pendingChecks.includes("RTC_RULES_UNVERIFIED")); assert.ok(!saved.pendingChecks.includes("DPS_NUMBER_NOT_RESERVED"));
  assert.deepEqual((await dbA.migrationPool.query("SELECT body,version,updated_at FROM operational_records WHERE id=$1", [orderId])).rows, before.rows);
  assert.equal(await count("stock_balances"), balances); assert.equal(await count("finance_payments"), payments);
  const audit = (await dbA.migrationPool.query("SELECT actor_id,after_values FROM audit_events WHERE entity_type='nfse_dps' AND entity_id=$1", [saved.draftId])).rows;
  assert.equal(audit.length, 1); assert.equal(audit[0].actor_id, access().actorId); assert.doesNotMatch(JSON.stringify(audit), /11222333000181|52998224725|<DPS/);
});

test("NFSDJ02 repetição exata e nova conexão recuperam a mesma reserva e evento, mesmo se a OS mudou depois", async () => {
  const { orderId } = await seed(), body = command(orderId, "2");
  const first = await journal.prepareDpsRequest(access(), body);
  await dbA.migrationPool.query("UPDATE operational_records SET body=body||'{\"laborCents\":54321}',version=2 WHERE id=$1", [orderId]);
  await dbA.migrationPool.query("UPDATE customers SET name='Nome alterado depois' WHERE id=(SELECT (body->>'customerId')::uuid FROM operational_records WHERE id=$1)", [orderId]);
  const reconnected = new Pool({ connectionString: dbA.runtimeUrl, max: 1 });
  try {
    assert.deepEqual(await journal.prepareDpsRequest({ ...access(), pool: reconnected }, body), first);
    assert.deepEqual(await journal.getDpsRequest({ ...access(), pool: reconnected }, first.draftId), first);
    const history = await journal.readDpsHistory({ ...access(), pool: reconnected }, first.draftId);
    assert.equal(history.events.length, 1); assert.equal(history.events[0].kind, "prepared"); assert.equal(history.events[0].actorId, access().actorId);
    assert.match(history.events[0].at, /Z$/); assert.doesNotMatch(JSON.stringify(history), /52998224725|<DPS|NEVER-COPY/);
  } finally { await reconnected.end(); }
  assert.equal(await counter("2"), "1");
});

test("NFSDJ03 mesma OS com outras chaves concorre para uma DPS; séries ou conteúdo novos não geram outra", async () => {
  const { orderId } = await seed(), body = command(orderId, "3");
  const same = await Promise.all(Array.from({ length: 6 }, () => journal.prepareDpsRequest(access(), { ...body, requestId: randomUUID() })));
  assert.equal(new Set(same.map(row => row.draftId)).size, 1); assert.equal(await counter("3"), "1");
  const changed = structuredClone(body); changed.requestId = randomUUID(); changed.fiscal.service.description = "Outra descrição";
  await fails(() => journal.prepareDpsRequest(access(), changed), "DPS_REQUEST_CONFLICT");
  await fails(() => journal.prepareDpsRequest(access(), { ...body, requestId: randomUUID(), orderVersion: 2 }), "DPS_REQUEST_CONFLICT");
  await fails(() => journal.prepareDpsRequest(access(), command(orderId, "4")), "DPS_REQUEST_CONFLICT");
  assert.equal(await counter("4"), undefined);
});

test("NFSDJ04 chave repetida exige ator e conteúdo originais, inclusive outro orderId", async () => {
  const first = await seed(), second = await seed(), body = command(first.orderId, "5");
  await journal.prepareDpsRequest(access(), body);
  await fails(() => journal.prepareDpsRequest({ ...access(), actorId: "outro-ator" }, body), "DPS_REQUEST_CONFLICT");
  await fails(() => journal.prepareDpsRequest(access(), { ...body, orderId: second.orderId }), "DPS_REQUEST_CONFLICT");
  assert.equal(await counter("5"), "1");
});

test("NFSDJ05 OS distintas em concorrência recebem números únicos consecutivos", async () => {
  const sources = await Promise.all(Array.from({ length: 8 }, () => seed()));
  const drafts = await Promise.all(sources.map(source => journal.prepareDpsRequest(access(), command(source.orderId, "6"))));
  assert.deepEqual(drafts.map(row => Number(row.number)).sort((a,b) => a-b), [1,2,3,4,5,6,7,8]);
  assert.equal(new Set(drafts.map(row => row.id)).size, 8); assert.equal(await counter("6"), "8");
});

test("NFSDJ06 binding exige empresa correta para preparar, ler e consultar histórico", async () => {
  const { orderId } = await seed(), body = command(orderId, "7"), saved = await journal.prepareDpsRequest(access(), body);
  const wrong = { ...access(), tenantId: tenantB };
  for (const run of [() => journal.prepareDpsRequest(wrong, body), () => journal.getDpsRequest(wrong, saved.draftId), () => journal.readDpsHistory(wrong, saved.draftId)]) await fails(run, "FORBIDDEN");
  await fails(() => journal.getDpsRequest({ ...access(), pool: otherPool, tenantId: tenantB }, saved.draftId), "NOT_FOUND");
  await fails(() => journal.prepareDpsRequest({ ...access(), pool: otherPool, tenantId: tenantB }, body), "NOT_FOUND");
  const unclaimed = await cluster.createDatabase("unclaimed"); await migrateTenant(unclaimed.migrationPool); await unclaimed.grantRuntime();
  const unclaimedPool = new Pool({ connectionString: unclaimed.runtimeUrl, max: 1 });
  try { await fails(() => journal.prepareDpsRequest({ ...access(), pool: unclaimedPool }, body), "FORBIDDEN"); }
  finally { await unclaimedPool.end(); }
});

test("NFSDJ07 fonte autoritativa recusa versão, aprovação, valor ausente e cliente inativo/incompatível", async () => {
  for (const overrides of [{ approved: false }, { laborCents: null }, { laborCents: 0 }, { customerId: randomUUID() }]) {
    const { orderId } = await seed(overrides); await assert.rejects(() => journal.prepareDpsRequest(access(), command(orderId, "8")));
  }
  const stale = await seed(); await fails(() => journal.prepareDpsRequest(access(), { ...command(stale.orderId, "8"), orderVersion: 2 }), "DPS_SOURCE_CONFLICT");
  const inactive = await seed(); await dbA.migrationPool.query("UPDATE customers SET active=false WHERE id=$1", [inactive.customerId]);
  await fails(() => journal.prepareDpsRequest(access(), command(inactive.orderId, "8")), "DPS_SOURCE_CONFLICT");
  const company = await seed(); await dbA.migrationPool.query("UPDATE customers SET type='Empresa' WHERE id=$1", [company.customerId]);
  await fails(() => journal.prepareDpsRequest(access(), command(company.orderId, "8")), "DPS_SOURCE_CONFLICT");
  assert.equal(await counter("8"), undefined);
});

test("NFSDJ08 campos forjados, regime desconhecido e produção não reservam número", async () => {
  const { orderId } = await seed(), original = command(orderId, "9");
  const bad: any[] = [{ ...original, actorId: "fake" }, { ...original, orderVersion: 1.5 }];
  for (const [group, key, value] of [["issuance", "number", "999"], ["customer", "name", "Nome forjado"], ["issuer", "regime", null], ["source", "laborCents", 1]] as const) {
    const body = structuredClone(original); body.fiscal[group] ??= {}; body.fiscal[group][key] = value; bad.push(body);
  }
  const production = structuredClone(original); production.fiscal.environment = "production"; bad.push(production);
  const extra = structuredClone(original); extra.fiscal.taxation.approxSimplesRate = "não sei"; bad.push(extra);
  for (const body of bad) await assert.rejects(() => journal.prepareDpsRequest(access(), body));
  assert.equal(await counter("9"), undefined);
});

test("NFSDJ09 falha depois de reservar desfaz contador, XML, chave e evento, sem erro SQL exposto", async () => {
  const { orderId } = await seed(), body = command(orderId, "10"), drafts = await count("nfse_dps_drafts"), aliases = await count("nfse_dps_requests"), events = await count("nfse_dps_events");
  await dbA.migrationPool.query("CREATE FUNCTION qa_fail_nfse_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'NEVER-COPY-PRIVATE-SQL'; END $$; CREATE TRIGGER qa_fail_nfse_event BEFORE INSERT ON nfse_dps_events FOR EACH ROW EXECUTE FUNCTION qa_fail_nfse_event()");
  try { await fails(() => journal.prepareDpsRequest(access(), body), "SERVICE_UNAVAILABLE"); }
  finally { await dbA.migrationPool.query("DROP TRIGGER qa_fail_nfse_event ON nfse_dps_events; DROP FUNCTION qa_fail_nfse_event()"); }
  assert.equal(await counter("10"), undefined); assert.equal(await count("nfse_dps_drafts"), drafts); assert.equal(await count("nfse_dps_requests"), aliases); assert.equal(await count("nfse_dps_events"), events);
  const saved = await journal.prepareDpsRequest(access(), body); assert.equal(saved.number, "1");
});

test("NFSDJ10 número de 15 dígitos preserva precisão e exaustão não cria segunda reserva", async () => {
  await dbA.migrationPool.query("INSERT INTO nfse_dps_counters(environment,municipality_code,issuer_cnpj,series,last_number) VALUES('production-restricted','3550308','11222333000181',11,999999999999998)");
  const first = await seed(), second = await seed();
  const saved = await journal.prepareDpsRequest(access(), command(first.orderId, "11")); assert.equal(saved.number, "999999999999999"); assert.match(saved.id, /999999999999999$/);
  await fails(() => journal.prepareDpsRequest(access(), command(second.orderId, "11")), "DPS_NUMBER_EXHAUSTED");
  assert.equal(await counter("11"), "999999999999999");
});

test("NFSDJ11 XML, chaves e eventos são imutáveis; contador não retrocede nem é apagado pela role de runtime", async () => {
  const { orderId } = await seed(), saved = await journal.prepareDpsRequest(access(), command(orderId, "12"));
  for (const statement of [
    "UPDATE nfse_dps_drafts SET xml='changed'", "DELETE FROM nfse_dps_drafts", "UPDATE nfse_dps_requests SET actor_id='fake'", "DELETE FROM nfse_dps_requests",
    "UPDATE nfse_dps_events SET actor_id='fake'", "DELETE FROM nfse_dps_events", "UPDATE nfse_dps_counters SET last_number=last_number-1", "DELETE FROM nfse_dps_counters",
    "TRUNCATE nfse_dps_events", "TRUNCATE nfse_dps_drafts CASCADE", "TRUNCATE nfse_dps_counters",
  ]) await assert.rejects(() => pool.query(statement), (error: any) => error.code === "42501");
  assert.equal((await journal.getDpsRequest(access(), saved.draftId)).xml, saved.xml);
});

test("NFSDJ12 migração reaplicada preserva reservas e histórico existentes", async () => {
  const { orderId } = await seed(), saved = await journal.prepareDpsRequest(access(), command(orderId, "13"));
  const counts = await Promise.all(["nfse_dps_drafts", "nfse_dps_events", "nfse_dps_requests"].map(count));
  await migrateTenant(dbA.migrationPool); await migrateTenant(dbA.migrationPool);
  assert.deepEqual(await journal.getDpsRequest(access(), saved.draftId), saved);
  assert.deepEqual(await Promise.all(["nfse_dps_drafts", "nfse_dps_events", "nfse_dps_requests"].map(count)), counts);
});

test("NFSDJ13 ordem das propriedades não muda identidade; mesma chave concorrente grava apenas uma vez", async () => {
  const { orderId } = await seed(), body = command(orderId, "14");
  const first = await Promise.all(Array.from({ length: 4 }, () => journal.prepareDpsRequest(access(), body)));
  assert.equal(new Set(first.map(row => row.draftId)).size, 1);
  const reorder = (value: any): any => Array.isArray(value) ? value.map(reorder) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).reverse().map(key => [key, reorder(value[key])])) : value;
  assert.deepEqual(await journal.prepareDpsRequest(access(), reorder(body)), first[0]);
  assert.equal(await counter("14"), "1");
});

test("NFSDJ14 prepara sob o lock operacional e revalida versão depois da alteração concorrente", async () => {
  const { orderId } = await seed(), body = command(orderId, "15"), writer = await dbA.migrationPool.connect();
  let pending: Promise<any> | undefined;
  try {
    await writer.query("BEGIN"); await writer.query("SELECT id FROM operational_coordination WHERE id=1 FOR UPDATE");
    pending = journal.prepareDpsRequest(access(), body); const observed = pending.catch(error => error);
    let blocked = false;
    for (let tries = 0; tries < 80; tries++) {
      const locks = await dbA.migrationPool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%operational_coordination%'");
      if (locks.rows[0].n > 0) { blocked = true; break; }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.equal(blocked, true, "journal must wait on the operational lock");
    await writer.query("UPDATE operational_records SET version=2,body=body||'{\"laborCents\":54321}' WHERE id=$1", [orderId]);
    await writer.query("COMMIT"); const result = await observed; assert.equal(result.code, "DPS_SOURCE_CONFLICT");
    assert.equal(await counter("15"), undefined);
  } finally { await writer.query("ROLLBACK"); writer.release(); await pending?.catch(() => {}); }
});

test("NFSDJ15 espaços em identificadores são recusados antes da reserva, conforme contrato do gerador", async () => {
  // The initial review hypothesis was disproved: length is checked before trim.
  // Preserve the existing strict contract instead of changing code to satisfy a wrong expectation.
  const { orderId } = await seed(), body = command(orderId, "16");
  for (const field of ["cnpj", "municipalityCode"]) {
    const invalid = structuredClone(body); invalid.fiscal.issuer[field] = ` ${invalid.fiscal.issuer[field]} `;
    await fails(() => journal.prepareDpsRequest(access(), invalid), "INVALID_DPS_INPUT");
    assert.equal(await counter("16"), undefined);
  }
  const saved = await journal.prepareDpsRequest(access(), body); assert.equal(saved.number, "1");
});
