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
const base = (tenant = TENANT_A) => `/api/v1/tenants/${tenant}/reports/receipts`;
async function get(app: TestApp, cookie: string, query = "from=2026-11-01&to=2026-11-30", path = base()) {
  return app.instance.inject({ method: "GET", url: `${path}?${query}`, headers: { cookie } });
}
async function scenario(run: (app: TestApp, cookie: string) => Promise<void>) {
  const app = await fixture.app();
  try { const actor = await fixture.user(); const { cookie } = await login(app, actor); await run(app, cookie); }
  finally { await app.close(); }
}
async function command(app: TestApp, cookie: string, type: string, data: unknown) {
  const result = await app.instance.inject({ method: "POST", url: `/api/v1/tenants/${TENANT_A}/operations/commands`, headers: authHeaders(cookie), payload: { requestId: randomUUID(), type, data } });
  assert.equal(result.statusCode, 200, result.body); return result.json().entity;
}
async function seed(app: TestApp, cookie: string, name: string) {
  const customer = await createCustomer(app, cookie, TENANT_A, { name });
  const account = await command(app, cookie, "account.create", { name: "Conta QA histórica", type: "bank" });
  async function payment(at: string, amount: number, method = "pix") {
    const id = randomUUID();
    const receipt = { customerName: name, accountName: "Conta QA histórica", receivedByName: "Pessoa QA histórica" };
    await fixture.a.migrationPool.query("INSERT INTO finance_payments(id,customer_id,account_id,amount_cents,method,reference,at,actor_id,receipt) VALUES($1,$2,$3,$4,$5,'QA',$6,'qa-actor',$7)", [id, customer.id, account.id, amount, method, at, JSON.stringify(receipt)]);
    return id;
  }
  return { customer, account, payment };
}

test("REL01 sessão, direito financeiro, revogação e vínculo banco/empresa são exigidos", async () => {
  await scenario(async (app, cookie) => {
    assertError(await get(app, ""), 401);
    assertError(await get(app, cookie, undefined, base(TENANT_B)), 403);
    const user = await fixture.user("operator"), session = await login(app, user);
    assertError(await get(app, session.cookie), 403);
    await fixture.control.migrationPool.query("UPDATE memberships SET permission_overrides=$1 WHERE user_id=$2", [JSON.stringify({ "finance.read": true }), user.id]);
    assert.equal((await get(app, session.cookie)).statusCode, 200);
    await fixture.control.migrationPool.query("UPDATE memberships SET active=false WHERE user_id=$1", [user.id]);
    assertError(await get(app, session.cookie), 403);
    const swapped = await fixture.app({ tenantDatabaseUrls: { a: fixture.b.runtimeUrl, b: fixture.a.runtimeUrl } });
    try { assertError(await get(swapped, cookie), 403); }
    finally { await swapped.close(); }
  });
});

test("REL02 período inclusivo em São Paulo, paginação e totais integrais com nomes históricos", async () => {
  await scenario(async (app, cookie) => {
    const label = `Relatório literal %_ ${randomUUID()}`, data = await seed(app, cookie, label);
    await data.payment("2026-11-01T02:59:59Z", 800);
    const first = await data.payment("2026-11-01T03:00:00Z", 101);
    const second = await data.payment("2026-12-01T02:59:59Z", 202, "transfer");
    await data.payment("2026-12-01T03:00:00Z", 900);
    await fixture.a.migrationPool.query("UPDATE customers SET name='Nome novo QA' WHERE id=$1", [data.customer.id]);
    await fixture.a.migrationPool.query("UPDATE finance_accounts SET name='Conta nova QA' WHERE id=$1", [data.account.id]);
    const query = `from=2026-11-01&to=2026-11-30&q=${encodeURIComponent(label)}&limit=1`;
    const response = await get(app, cookie, query); assert.equal(response.statusCode, 200, response.body);
    const report = response.json(); assert.equal(report.tenantId, TENANT_A);
    assert.deepEqual(report.totals, { count: 2, amountCents: 303 });
    assert.equal(report.items.length, 1); assert.equal(report.items[0].id, second);
    assert.equal(report.items[0].date, "2026-11-30"); assert.equal(report.items[0].customerName, label);
    assert.equal(report.items[0].accountName, "Conta QA histórica"); assert.equal(report.items[0].receivedByName, "Pessoa QA histórica");
    assert.equal(Object.hasOwn(report.items[0], "receipt"), false); assert.equal(Object.hasOwn(report.items[0], "reference"), false);
    const page2 = (await get(app, cookie, query + "&offset=1")).json(); assert.equal(page2.items[0].id, first); assert.deepEqual(page2.totals, report.totals);
    const filtered = (await get(app, cookie, query + "&method=pix")).json(); assert.deepEqual(filtered.totals, { count: 1, amountCents: 101 });
    const literal = (await get(app, cookie, "from=2026-11-01&to=2026-11-30&q=%25_" )).json(); assert.ok(literal.items.every((row: any) => row.customerName.includes("%_")));
    const wrongDate = await get(app, cookie, `from=2026-11-01&to=2026-11-30&q=${randomUUID()}`); assert.deepEqual(wrongDate.json().totals, { count: 0, amountCents: 0 });
  });
});

test("REL03 pagamento rateado conta uma vez, ignora promessa/venda e não altera dados", async () => {
  await scenario(async (app, cookie) => {
    const label = `Cliente rateio ${randomUUID()}`, customer = await createCustomer(app, cookie, TENANT_A, { name: label });
    const account = await command(app, cookie, "account.create", { name: "Conta rateio QA", type: "bank" });
    const product = await command(app, cookie, "product.create", { sku: randomUUID(), name: "Produto QA", salePriceCents: 1000 });
    await command(app, cookie, "stock.receive", { productId: product.id, quantity: 2, reference: "Conferência QA" });
    await command(app, cookie, "sale.checkout", { customerId: customer.id, items: [{ productId: product.id, quantity: 1, version: product.version }], deliver: false, terms: { downPaymentCents: 0, installmentCount: 2, firstDue: "2100-01-01" } });
    const payment = await command(app, cookie, "payment.receive", { customerId: customer.id, accountId: account.id, method: "pix", amountCents: 750, reference: "Crédito QA conferido", creditConfirmed: true });
    assert.equal(payment.allocations.length, 2);
    const before = (await fixture.a.migrationPool.query("SELECT count(*)::int n FROM audit_events")).rows[0].n;
    const response = await get(app, cookie, `from=1900-01-01&to=9999-12-31&q=${encodeURIComponent(label)}`);
    assert.equal(response.statusCode, 200, response.body); assert.deepEqual(response.json().totals, { count: 1, amountCents: 750 });
    assert.equal(response.json().items[0].id, payment.id);
    assert.equal((await fixture.a.migrationPool.query("SELECT count(*)::int n FROM audit_events")).rows[0].n, before);
    assert.ok(!app.logs.join("").includes(label));
  });
});

test("REL04 datas e filtros fechados inválidos são recusados e indisponibilidade não vira zero", async () => {
  await scenario(async (app, cookie) => {
    for (const query of ["", "from=2026-02-30&to=2026-03-01", "from=2026-12-01&to=2026-11-01", "from=2026-11-01&to=2026-11-30&limit=101", "from=2026-11-01&to=2026-11-30&offset=-1", "from=2026-11-01&to=2026-11-30&method=card", "from=2026-11-01&to=2026-11-30&company=other", "from=2026-11-01&to=2026-11-30&q=a&q=b"])
      assertError(await get(app, cookie, query), 400);
    const broken = await fixture.app({ tenantDatabaseUrls: { a: "postgresql://invalid:invalid@127.0.0.1:1/missing" } });
    try { assertError(await get(broken, cookie), 503); } finally { await broken.close(); }
  });
});

test("REL05 exportação inclui seleção completa e recusa truncamento ou soma insegura", async () => {
  await scenario(async (app, cookie) => {
    const label = `Exportação ${randomUUID()}`, data = await seed(app, cookie, label);
    await data.payment("2026-11-05T12:00:00Z", 1); await data.payment("2026-11-05T12:00:00Z", 2);
    const query = `from=2026-11-01&to=2026-11-30&q=${encodeURIComponent(label)}`;
    const response = await get(app, cookie, query, base() + "/export"); assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().items.length, 2); assert.deepEqual(response.json().totals, { count: 2, amountCents: 3 });
    assertError(await get(app, cookie, query + "&limit=1", base() + "/export"), 400);
    await fixture.a.migrationPool.query("INSERT INTO finance_payments(id,customer_id,account_id,amount_cents,method,reference,at,actor_id,receipt) SELECT gen_random_uuid(),$1,$2,1,'pix','QA','2026-11-05T12:00:00Z','qa-actor',$3 FROM generate_series(1,9999)", [data.customer.id, data.account.id, JSON.stringify({ customerName: label, accountName: "QA", receivedByName: "QA" })]);
    assertError(await get(app, cookie, query, base() + "/export"), 413);
    const overflow = await seed(app, cookie, `Overflow ${randomUUID()}`);
    await overflow.payment("2026-11-05T12:00:00Z", Number.MAX_SAFE_INTEGER); await overflow.payment("2026-11-05T12:00:00Z", 1);
    assertError(await get(app, cookie, `from=2026-11-01&to=2026-11-30&q=${encodeURIComponent(overflow.customer.name)}`), 503);
  });
});
