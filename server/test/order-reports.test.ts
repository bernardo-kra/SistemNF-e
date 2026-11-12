import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { createFixture, login, createCustomer, authHeaders, assertError, TENANT_A, TENANT_B, type Fixture, type TestApp } from "./helpers.ts";

let fixture: Fixture;
before(async () => {
  fixture = await createFixture();
  for (const [database, tenant] of [[fixture.a, TENANT_A], [fixture.b, TENANT_B]] as const)
    await database.migrationPool.query("INSERT INTO tenant_admission(singleton,slot_id,tenant_id,claimed_at) VALUES(true,$1,$2,clock_timestamp())", [randomUUID(), tenant]);
});
after(async () => { await fixture?.close(); });
const base = (tenant = TENANT_A) => `/api/v1/tenants/${tenant}/reports/orders`;
async function get(app: TestApp, cookie: string, query = "from=2026-11-01&to=2026-11-30", path = base()) {
  return app.instance.inject({ method: "GET", url: `${path}?${query}`, headers: { cookie } });
}
async function scenario(run: (app: TestApp, cookie: string) => Promise<void>) {
  const app = await fixture.app();
  try { const actor = await fixture.user(); const { cookie } = await login(app, actor); await run(app, cookie); }
  finally { await app.close(); }
}
async function seed(name: string, at: string, overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const body = { number: 123, customerName: name, technicianName: "Técnico registrado QA", equipment: "Equipamento QA", laborCents: 1000, stage: "received", approved: false,
    issue: "Defeito privado QA", diagnosis: "Diagnóstico privado QA", password: "Senha privada QA", customerPhone: "Contato privado QA", ...overrides };
  await fixture.a.migrationPool.query("INSERT INTO operational_records(entity_type,id,body,version,created_at,updated_at,created_by,updated_by) VALUES('order',$1,$2,1,$3,$3,'qa','qa')", [id, JSON.stringify(body), at]);
  return id;
}
async function command(app: TestApp, cookie: string, type: string, data: unknown) {
  const response = await app.instance.inject({ method: "POST", url: `/api/v1/tenants/${TENANT_A}/operations/commands`, headers: authHeaders(cookie), payload: { requestId: randomUUID(), type, data } });
  assert.equal(response.statusCode, 200, response.body); return response.json().entity;
}

test("OSR01 sessão, direitos, revogação e vínculo físico são exigidos na leitura/exportação", async () => {
  await scenario(async (app, cookie) => {
    for (const path of [base(), base() + "/export"]) {
      assertError(await get(app, "", undefined, path), 401);
      assertError(await get(app, cookie, undefined, path.replace(TENANT_A, TENANT_B)), 403);
    }
    const actor = await fixture.user("operator"), { cookie: operator } = await login(app, actor);
    for (const rights of [{ "finance.read": true, "orders.read": false }, { "finance.read": false, "orders.read": true }]) {
      await fixture.control.migrationPool.query("UPDATE memberships SET permission_overrides=$1 WHERE user_id=$2", [JSON.stringify(rights), actor.id]);
      for (const path of [base(), base() + "/export"]) assertError(await get(app, operator, undefined, path), 403);
    }
    await fixture.control.migrationPool.query("UPDATE memberships SET permission_overrides=$1 WHERE user_id=$2", [JSON.stringify({ "finance.read": true, "orders.read": true }), actor.id]);
    for (const path of [base(), base() + "/export"]) assert.equal((await get(app, operator, undefined, path)).statusCode, 200);
    await fixture.control.migrationPool.query("UPDATE memberships SET active=false WHERE user_id=$1", [actor.id]);
    for (const path of [base(), base() + "/export"]) assertError(await get(app, operator, undefined, path), 403);
    const swapped = await fixture.app({ tenantDatabaseUrls: { a: fixture.b.runtimeUrl, b: fixture.a.runtimeUrl } });
    try { assertError(await get(swapped, cookie), 403); } finally { await swapped.close(); }
  });
});

test("OSR02 criação inclusiva civil, retrato atual, busca literal e totais integrais sem dados privados", async () => {
  await scenario(async (app, cookie) => {
    const label = `OS %_ ${randomUUID()}`;
    await seed(label, "2026-11-01T02:59:59Z");
    const first = await seed(label, "2026-11-01T03:00:00Z", { laborCents: 500 });
    const second = await seed(label, "2026-12-01T02:59:59Z", { approved: true, stage: "in_progress" });
    await fixture.a.migrationPool.query("UPDATE operational_records SET updated_at='2027-01-01T12:00:00Z' WHERE id=$1", [second]);
    await seed(label, "2026-12-01T03:00:00Z"); await seed("Outro cliente QA", "2026-11-10T12:00:00Z");
    const query = `from=2026-11-01&to=2026-11-30&q=${encodeURIComponent(label)}&limit=1`;
    const response = await get(app, cookie, query); assert.equal(response.statusCode, 200, response.body);
    const report = response.json(); assert.equal(report.tenantId, TENANT_A);
    assert.deepEqual(report.totals, { count: 2, laborCents: 1500, approvedCents: 1000, unapprovedCents: 500, unpricedCount: 0 });
    assert.equal(report.items[0].id, second); assert.equal(report.items[0].date, "2026-11-30"); assert.equal(report.items[0].stage, "in_progress");
    assert.equal(report.items[0].customerName, label); assert.equal(report.items[0].technicianName, "Técnico registrado QA");
    assert.deepEqual(Object.keys(report.items[0]).sort(), ["id", "number", "at", "date", "customerName", "technicianName", "equipment", "stage", "approved", "laborCents"].sort());
    const page = (await get(app, cookie, query + "&offset=1")).json(); assert.equal(page.items[0].id, first); assert.deepEqual(page.totals, report.totals);
    const approved = (await get(app, cookie, query + "&approval=approved&stage=in_progress")).json(); assert.deepEqual(approved.totals, { count: 1, laborCents: 1000, approvedCents: 1000, unapprovedCents: 0, unpricedCount: 0 });
    const pending = (await get(app, cookie, query + "&approval=pending")).json(); assert.equal(pending.items[0].id, first);
    const literal = (await get(app, cookie, "from=2026-11-01&to=2026-11-30&q=%25_")).json(); assert.ok(literal.items.every((row: any) => row.customerName.includes("%_")));
    assert.deepEqual((await get(app, cookie, `from=2026-11-01&to=2026-11-30&q=${randomUUID()}`)).json().totals, { count: 0, laborCents: 0, approvedCents: 0, unapprovedCents: 0, unpricedCount: 0 });
    assert.ok(!response.body.includes("privad")); assert.ok(!app.logs.join("").includes(label));
  });
});

test("OSR03 OS aprovada e sem aprovação, acordo/parcelas/pagamento não duplicam nem criam receita ou escrita", async () => {
  await scenario(async (app, cookie) => {
    const name = `Cliente OS ${randomUUID()}`, customer = await createCustomer(app, cookie, TENANT_A, { name });
    const technician = await command(app, cookie, "technician.create", { name: `Técnico OS ${randomUUID()}` });
    const account = await command(app, cookie, "account.create", { name: "Conta QA", type: "bank" });
    const data = { customerId: customer.id, technicianId: technician.id, equipment: "Equipamento genérico QA", issue: "Defeito privado QA", due: "2100-01-01" };
    let order = await command(app, cookie, "order.create", { ...data, laborCents: 1000 });
    await command(app, cookie, "order.create", { ...data, laborCents: 250 });
    order = await command(app, cookie, "order.advance", { id: order.id, version: order.version });
    order = await command(app, cookie, "order.advance", { id: order.id, version: order.version });
    order = await command(app, cookie, "order.approve", { id: order.id, version: order.version, budgetRevision: order.budgetRevision, channel: "in_person" });
    await command(app, cookie, "agreement.create", { sourceType: "order", sourceId: order.id, sourceVersion: order.version, downPaymentCents: 0, installmentCount: 2, firstDue: "2100-01-01" });
    await command(app, cookie, "payment.receive", { customerId: customer.id, accountId: account.id, method: "pix", amountCents: 750, reference: "Crédito QA conferido", creditConfirmed: true });
    await fixture.a.migrationPool.query("UPDATE customers SET name='Nome atual alterado QA' WHERE id=$1", [customer.id]);
    await fixture.a.migrationPool.query("UPDATE operational_records SET body=jsonb_set(body,'{name}','\"Técnico alterado QA\"') WHERE entity_type='technician' AND id=$1", [technician.id]);
    const before = (await fixture.a.migrationPool.query("SELECT count(*)::int n FROM audit_events")).rows[0].n;
    const response = await get(app, cookie, `from=1900-01-01&to=9999-12-31&q=${encodeURIComponent(name)}`, base() + "/export");
    assert.equal(response.statusCode, 200, response.body); assert.deepEqual(response.json().totals, { count: 2, laborCents: 1250, approvedCents: 1000, unapprovedCents: 250, unpricedCount: 0 });
    assert.ok(response.json().items.every((row: any) => row.customerName === name && row.technicianName === technician.name));
    for (const key of ["paidCents", "balanceCents", "partsCents"]) assert.equal(Object.hasOwn(response.json().items[0], key), false);
    assert.equal((await fixture.a.migrationPool.query("SELECT count(*)::int n FROM audit_events")).rows[0].n, before);
  });
});

test("OSR04 entradas inválidas são rejeitadas e indisponibilidade não vira zero", async () => {
  await scenario(async (app, cookie) => {
    for (const query of ["", "from=2026-02-30&to=2026-03-01", "from=2026-12-01&to=2026-11-01", "from=2026-11-01&to=2026-11-30&stage=cancelled", "from=2026-11-01&to=2026-11-30&approval=true", "from=2026-11-01&to=2026-11-30&limit=101", "from=2026-11-01&to=2026-11-30&offset=-1", "from=2026-11-01&to=2026-11-30&method=pix", "from=2026-11-01&to=2026-11-30&q=a&q=b"])
      assertError(await get(app, cookie, query), 400);
    const broken = await fixture.app({ tenantDatabaseUrls: { a: "postgresql://invalid:invalid@127.0.0.1:1/missing" } });
    try { assertError(await get(broken, cookie), 503); } finally { await broken.close(); }
  });
});

test("OSR05 exportação completa, limite, inconsistência fora da página e soma insegura", async () => {
  await scenario(async (app, cookie) => {
    const label = `CSV OS ${randomUUID()}`;
    await seed(label, "2026-11-05T12:00:00Z"); await seed(label, "2026-11-06T12:00:00Z");
    const query = `from=2026-11-01&to=2026-11-30&q=${encodeURIComponent(label)}`;
    const response = await get(app, cookie, query, base() + "/export"); assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().items.length, 2);
    assertError(await get(app, cookie, query + "&limit=1", base() + "/export"), 400);
    await fixture.a.migrationPool.query("INSERT INTO operational_records SELECT 'order',gen_random_uuid(),body,1,created_at,updated_at,'qa','qa' FROM operational_records CROSS JOIN generate_series(1,9999) WHERE id=$1", [response.json().items[0].id]);
    assertError(await get(app, cookie, query, base() + "/export"), 413);
    for (const overrides of [{ laborCents: undefined }, { laborCents: null, approved: true }, { laborCents: null, stage: "in_progress" }, { laborCents: -1 }, { laborCents: 0.5 }, { laborCents: "1000" }, { approved: "true" }, { approved: undefined }, { stage: "unknown" }]) {
      const name = `Inconsistente OS ${randomUUID()}`;
      await seed(name, "2026-11-05T12:00:00Z", overrides); await seed(name, "2026-11-06T12:00:00Z");
      assertError(await get(app, cookie, `from=2026-11-01&to=2026-11-30&q=${encodeURIComponent(name)}&limit=1`), 503);
    }
    const overflow = `Overflow OS ${randomUUID()}`;
    await seed(overflow, "2026-11-05T12:00:00Z", { laborCents: Number.MAX_SAFE_INTEGER }); await seed(overflow, "2026-11-05T12:00:00Z");
    assertError(await get(app, cookie, `from=2026-11-01&to=2026-11-30&q=${encodeURIComponent(overflow)}`), 503);
  });
});
