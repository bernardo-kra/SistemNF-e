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
const base = (tenant = TENANT_A) => `/api/v1/tenants/${tenant}/reports/sales`;
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
  const body = { number: 123, customerId: randomUUID(), customerName: name, items: [], grossCents: 1200, discountCents: 200, totalCents: 1000, status: "confirmed", ...overrides };
  await fixture.a.migrationPool.query("INSERT INTO operational_records(entity_type,id,body,version,created_at,updated_at,created_by,updated_by) VALUES('sale',$1,$2,1,$3,$3,'qa','qa')", [id, JSON.stringify(body), at]);
  return id;
}
async function command(app: TestApp, cookie: string, type: string, data: unknown) {
  const response = await app.instance.inject({ method: "POST", url: `/api/v1/tenants/${TENANT_A}/operations/commands`, headers: authHeaders(cookie), payload: { requestId: randomUUID(), type, data } });
  assert.equal(response.statusCode, 200, response.body); return response.json().entity;
}

test("VEN01 sessão, dois direitos, revogação e vínculo físico exigidos também na exportação", async () => {
  await scenario(async (app, cookie) => {
    for (const path of [base(), base() + "/export"]) {
      assertError(await get(app, "", undefined, path), 401);
      assertError(await get(app, cookie, undefined, path.replace(TENANT_A, TENANT_B)), 403);
    }
    const actor = await fixture.user("operator"), { cookie: operator } = await login(app, actor);
    for (const permissions of [{ "finance.read": true, "sales.read": false, "products.read": true }, { "finance.read": false, "sales.read": true, "products.read": true }]) {
      await fixture.control.migrationPool.query("UPDATE memberships SET permission_overrides=$1 WHERE user_id=$2", [JSON.stringify(permissions), actor.id]);
      for (const path of [base(), base() + "/export"]) assertError(await get(app, operator, undefined, path), 403);
    }
    await fixture.control.migrationPool.query("UPDATE memberships SET permission_overrides=$1 WHERE user_id=$2", [JSON.stringify({ "finance.read": true, "sales.read": true, "products.read": true }), actor.id]);
    for (const path of [base(), base() + "/export"]) assert.equal((await get(app, operator, undefined, path)).statusCode, 200);
    await fixture.control.migrationPool.query("UPDATE memberships SET active=false WHERE user_id=$1", [actor.id]);
    for (const path of [base(), base() + "/export"]) assertError(await get(app, operator, undefined, path), 403);
    const swapped = await fixture.app({ tenantDatabaseUrls: { a: fixture.b.runtimeUrl, b: fixture.a.runtimeUrl } });
    try { assertError(await get(swapped, cookie), 403); } finally { await swapped.close(); }
  });
});

test("VEN02 criação civil inclusiva, nome preservado/literal, estado atual, legado e totais de todas as páginas", async () => {
  await scenario(async (app, cookie) => {
    const label = `Venda %_ ${randomUUID()}`;
    await seed(label, "2026-11-01T02:59:59Z");
    const first = await seed(label, "2026-11-01T03:00:00Z", { grossCents: undefined, discountCents: undefined, totalCents: 500 });
    const second = await seed(label, "2026-12-01T02:59:59Z", { status: "delivered" });
    await seed(label, "2026-12-01T03:00:00Z");
    await seed("Outro cliente QA", "2026-11-10T12:00:00Z");
    const query = `from=2026-11-01&to=2026-11-30&q=${encodeURIComponent(label)}&limit=1`;
    const response = await get(app, cookie, query); assert.equal(response.statusCode, 200, response.body);
    const report = response.json(); assert.equal(report.tenantId, TENANT_A);
    assert.deepEqual(report.totals, { count: 2, grossCents: 1700, discountCents: 200, totalCents: 1500 });
    assert.equal(report.items[0].id, second); assert.equal(report.items[0].date, "2026-11-30"); assert.equal(report.items[0].status, "delivered");
    assert.equal(report.items[0].customerName, label); assert.equal(Object.hasOwn(report.items[0], "items"), false);
    const page = (await get(app, cookie, query + "&offset=1")).json(); assert.equal(page.items[0].id, first); assert.deepEqual(page.totals, report.totals);
    assert.equal(page.items[0].grossCents, 500); assert.equal(page.items[0].discountCents, 0);
    const delivered = (await get(app, cookie, query + "&status=delivered")).json(); assert.deepEqual(delivered.totals, { count: 1, grossCents: 1200, discountCents: 200, totalCents: 1000 });
    const literal = (await get(app, cookie, "from=2026-11-01&to=2026-11-30&q=%25_")).json(); assert.ok(literal.items.every((row: any) => row.customerName.includes("%_")));
    assert.deepEqual((await get(app, cookie, `from=2026-11-01&to=2026-11-30&q=${randomUUID()}`)).json().totals, { count: 0, grossCents: 0, discountCents: 0, totalCents: 0 });
  });
});

test("VEN03 vários produtos/descontos/parcelas/pagamento contam uma venda; cadastros atuais não reescrevem valores", async () => {
  await scenario(async (app, cookie) => {
    const name = `Cliente venda ${randomUUID()}`, customer = await createCustomer(app, cookie, TENANT_A, { name });
    const account = await command(app, cookie, "account.create", { name: "Conta QA", type: "bank" });
    const items = [];
    for (const price of [1000, 2000]) {
      const product = await command(app, cookie, "product.create", { sku: randomUUID(), name: "Produto QA", salePriceCents: price });
      await command(app, cookie, "stock.receive", { productId: product.id, quantity: 4, reference: "Conferência QA" });
      items.push({ productId: product.id, quantity: 2, version: product.version, discountCents: 100 });
    }
    const sale = await command(app, cookie, "sale.checkout", { customerId: customer.id, items, deliver: false, terms: { downPaymentCents: 0, installmentCount: 2, firstDue: "2100-01-01" } });
    await command(app, cookie, "payment.receive", { customerId: customer.id, accountId: account.id, method: "pix", amountCents: 750, reference: "Crédito QA conferido", creditConfirmed: true });
    await fixture.a.migrationPool.query("UPDATE customers SET name='Cliente alterado QA' WHERE id=$1", [customer.id]);
    await fixture.a.migrationPool.query("UPDATE operational_records SET body=jsonb_set(body,'{salePriceCents}','99999') WHERE entity_type='product' AND id=$1", [items[0].productId]);
    const before = (await fixture.a.migrationPool.query("SELECT count(*)::int n FROM audit_events")).rows[0].n;
    const report = await get(app, cookie, `from=1900-01-01&to=9999-12-31&q=${encodeURIComponent(name)}`);
    assert.equal(report.statusCode, 200, report.body); assert.deepEqual(report.json().totals, { count: 1, grossCents: 6000, discountCents: 200, totalCents: 5800 });
    assert.equal(report.json().items[0].id, sale.id); assert.equal(report.json().items[0].customerName, name);
    assert.equal(Object.hasOwn(report.json().items[0], "paidCents"), false);
    assert.equal((await fixture.a.migrationPool.query("SELECT count(*)::int n FROM audit_events")).rows[0].n, before);
    assert.ok(!app.logs.join("").includes(name));
  });
});

test("VEN04 filtros fechados inválidos e indisponibilidade não viram relatório vazio", async () => {
  await scenario(async (app, cookie) => {
    for (const query of ["", "from=2026-02-30&to=2026-03-01", "from=2026-12-01&to=2026-11-01", "from=2026-11-01&to=2026-11-30&status=cancelled", "from=2026-11-01&to=2026-11-30&limit=101", "from=2026-11-01&to=2026-11-30&offset=-1", "from=2026-11-01&to=2026-11-30&method=pix", "from=2026-11-01&to=2026-11-30&q=a&q=b"])
      assertError(await get(app, cookie, query), 400);
    const broken = await fixture.app({ tenantDatabaseUrls: { a: "postgresql://invalid:invalid@127.0.0.1:1/missing" } });
    try { assertError(await get(broken, cookie), 503); } finally { await broken.close(); }
  });
});

test("VEN05 exportação integral/limite, decomposição inconsistente e overflow são recusados", async () => {
  await scenario(async (app, cookie) => {
    const label = `CSV ${randomUUID()}`;
    await seed(label, "2026-11-05T12:00:00Z"); await seed(label, "2026-11-05T12:00:00Z");
    const query = `from=2026-11-01&to=2026-11-30&q=${encodeURIComponent(label)}`;
    const response = await get(app, cookie, query, base() + "/export"); assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().items.length, 2); assert.deepEqual(response.json().totals, { count: 2, grossCents: 2400, discountCents: 400, totalCents: 2000 });
    assertError(await get(app, cookie, query + "&limit=1", base() + "/export"), 400);
    await fixture.a.migrationPool.query("INSERT INTO operational_records SELECT 'sale',gen_random_uuid(),body,1,created_at,updated_at,'qa','qa' FROM operational_records CROSS JOIN generate_series(1,9999) WHERE id=$1", [response.json().items[0].id]);
    assertError(await get(app, cookie, query, base() + "/export"), 413);
    for (const overrides of [{ grossCents: undefined }, { discountCents: undefined }, { discountCents: 1201 }, { totalCents: -1 }, { totalCents: 999 }, { totalCents: null }]) {
      const name = `Inconsistência ${randomUUID()}`; await seed(name, "2026-11-05T12:00:00Z", overrides);
      assertError(await get(app, cookie, `from=2026-11-01&to=2026-11-30&q=${encodeURIComponent(name)}`), 503);
    }
    const overflow = `Overflow ${randomUUID()}`;
    await seed(overflow, "2026-11-05T12:00:00Z", { grossCents: Number.MAX_SAFE_INTEGER, discountCents: 0, totalCents: Number.MAX_SAFE_INTEGER });
    await seed(overflow, "2026-11-05T12:00:00Z");
    assertError(await get(app, cookie, `from=2026-11-01&to=2026-11-30&q=${encodeURIComponent(overflow)}`), 503);
  });
});
