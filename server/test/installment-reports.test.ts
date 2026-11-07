import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { createFixture, login, createCustomer, authHeaders, assertError, TENANT_A, TENANT_B, type Fixture, type TestApp } from "./helpers.ts";

let fixture: Fixture;
before(async () => {
  fixture = await createFixture();
  for (const [db, id] of [[fixture.a, TENANT_A], [fixture.b, TENANT_B]] as const)
    await db.migrationPool.query("INSERT INTO tenant_admission(singleton,slot_id,tenant_id,claimed_at) VALUES(true,$1,$2,clock_timestamp())", [randomUUID(), id]);
});
after(async () => { await fixture?.close(); });
const base = (tenant = TENANT_A) => `/api/v1/tenants/${tenant}/reports/installments`;
const defaultQuery = "from=2026-11-01&to=2026-11-30&asOf=2026-11-06";
async function get(app: TestApp, cookie: string, query = defaultQuery, path = base()) {
  return app.instance.inject({ method: "GET", url: `${path}?${query}`, headers: { cookie } });
}
async function scenario(run: (app: TestApp, cookie: string) => Promise<void>) {
  const app = await fixture.app();
  try { const { cookie } = await login(app, await fixture.user()); await run(app, cookie); }
  finally { await app.close(); }
}
async function seed(app: TestApp, cookie: string) {
  const name = `Histórico %_ ${randomUUID()}`, customer = await createCustomer(app, cookie, TENANT_A, { name });
  const id = randomUUID();
  await fixture.a.migrationPool.query("INSERT INTO finance_accounts(id,name,type,created_at,created_by) VALUES($1,'Banco QA','bank','2026-11-01T12:00:00Z','qa')", [id]);
  async function agreement(at: string, source = "sale", amount = 1000, installmentAmount = amount, installmentAt = at) {
    const agreementId = randomUUID(), installmentId = randomUUID();
    await fixture.a.migrationPool.query("INSERT INTO finance_agreements(id,source_type,source_id,source_label,customer_id,customer_name,principal_cents,created_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'qa')", [agreementId, source, randomUUID(), source === "sale" ? "Venda QA" : "OS QA", customer.id, name, amount, at]);
    await fixture.a.migrationPool.query("INSERT INTO finance_installments(id,agreement_id,kind,number,count,amount_cents,due,created_at) VALUES($1,$2,'installment',1,$5,$3,'2026-11-05',$4)", [installmentId, agreementId, installmentAmount, installmentAt, amount / installmentAmount]);
    return installmentId;
  }
  async function payment(at: string, allocations: [string, number][]) {
    const paymentId = randomUUID(), amount = allocations.reduce((sum, [, value]) => sum + value, 0);
    await fixture.a.migrationPool.query("INSERT INTO finance_payments(id,customer_id,account_id,amount_cents,method,reference,at,actor_id,receipt) VALUES($1,$2,$3,$4,'pix','QA',$5,'qa',$6)", [paymentId, customer.id, id, amount, at, JSON.stringify({ customerName: name, accountName: "Banco QA", receivedByName: "Pessoa QA" })]);
    for (const [installment, value] of allocations) await fixture.a.migrationPool.query("INSERT INTO finance_allocations(payment_id,installment_id,amount_cents) VALUES($1,$2,$3)", [paymentId, installment, value]);
  }
  return { name, customer, agreement, payment, query: `${defaultQuery}&q=${encodeURIComponent(name)}` };
}

test("PAR01 leitura/exportação revalidam sessão, direito, revogação e vínculo físico", async () => {
  await scenario(async (app, cookie) => {
    const operator = await fixture.user("operator"), session = await login(app, operator);
    for (const suffix of ["", "/export"]) {
      assertError(await get(app, "", undefined, base() + suffix), 401);
      assertError(await get(app, cookie, undefined, base(TENANT_B) + suffix), 403);
      assertError(await get(app, session.cookie, undefined, base() + suffix), 403);
    }
    await fixture.control.migrationPool.query("UPDATE memberships SET permission_overrides=$1 WHERE user_id=$2", [JSON.stringify({ "finance.read": true }), operator.id]);
    assert.equal((await get(app, session.cookie)).statusCode, 200);
    await fixture.control.migrationPool.query("UPDATE memberships SET active=false WHERE user_id=$1", [operator.id]);
    assertError(await get(app, session.cookie), 403); assertError(await get(app, session.cookie, undefined, base() + "/export"), 403);
    const swapped = await fixture.app({ tenantDatabaseUrls: { a: fixture.b.runtimeUrl, b: fixture.a.runtimeUrl } });
    try { assertError(await get(swapped, cookie), 403); } finally { await swapped.close(); }
  });
});
test("PAR02 data-base inclui o fim do dia local, exclui acordos/pagamentos futuros e conserva nomes", async () => {
  await scenario(async (app, cookie) => {
    const data = await seed(app, cookie), first = await data.agreement("2026-11-01T12:00:00Z"), second = await data.agreement("2026-11-07T02:59:59Z", "order");
    await data.agreement("2026-11-07T03:00:00Z");
    await data.agreement("2026-11-07T03:00:00Z", "sale", 1000, 1000, "2026-11-01T12:00:00Z");
    await data.agreement("2026-11-01T12:00:00Z", "sale", 1000, 1000, "2026-11-07T03:00:00Z");
    await data.payment("2026-11-05T12:00:00Z", [[first, 100]]);
    await data.payment("2026-11-07T02:59:59Z", [[first, 200], [second, 250]]);
    await data.payment("2026-11-07T03:00:00Z", [[first, 700]]);
    await fixture.a.migrationPool.query("UPDATE customers SET name='Nome alterado QA' WHERE id=$1", [data.customer.id]);
    const result = await get(app, cookie, data.query + "&limit=1"); assert.equal(result.statusCode, 200, result.body);
    const report = result.json(); assert.deepEqual(report.totals, { count: 2, principalCents: 2000, paidCents: 550, balanceCents: 1450, overdueCents: 1450 });
    assert.equal(report.items.length, 1); assert.equal(report.items[0].customerName, data.name);
    const all = (await get(app, cookie, data.query, base() + "/export")).json();
    assert.deepEqual(all.totals, report.totals); assert.equal(all.items.length, 2);
    assert.equal(all.items.find((row: any) => row.id === first).paidCents, 300);
    assert.equal(all.items.find((row: any) => row.id === second).paidCents, 250);
    const next = (await get(app, cookie, data.query + "&limit=1&offset=1")).json(); assert.notEqual(next.items[0].id, report.items[0].id); assert.deepEqual(next.totals, report.totals);
    assert.ok(app.logs.every(line => !line.includes(data.name)));
  });
});
test("PAR03 situações e totais respeitam a base; vencimento no próprio dia não é atraso", async () => {
  await scenario(async (app, cookie) => {
    const data = await seed(app, cookie), partial = await data.agreement("2026-11-01T12:00:00Z"), paid = await data.agreement("2026-11-01T12:00:00Z", "order");
    await data.payment("2026-11-05T12:00:00Z", [[partial, 300], [paid, 1000]]);
    const query = data.query.replace("asOf=2026-11-06", "asOf=2026-11-05");
    const open = (await get(app, cookie, query + "&status=open")).json(); assert.equal(open.totals.balanceCents, 700); assert.equal(open.totals.overdueCents, 0); assert.equal(open.items[0].status, "open");
    const overdue = (await get(app, cookie, query + "&status=overdue")).json(); assert.equal(overdue.items.length, 0); assert.equal(overdue.totals.count, 0);
    const settled = (await get(app, cookie, query + "&status=paid")).json(); assert.equal(settled.items[0].id, paid); assert.equal(settled.totals.paidCents, 1000); assert.equal(settled.totals.balanceCents, 0);
    const late = (await get(app, cookie, data.query + "&status=overdue")).json(); assert.equal(late.totals.overdueCents, 700); assert.equal(late.items[0].id, partial);
    const allOpen = (await get(app, cookie, data.query + "&status=open")).json(); assert.equal(allOpen.totals.balanceCents, 700); assert.equal(allOpen.items[0].status, "overdue");
    const empty = await get(app, cookie, defaultQuery + "&q=" + randomUUID()); assert.deepEqual(empty.json().totals, { count: 0, principalCents: 0, paidCents: 0, balanceCents: 0, overdueCents: 0 });
  });
});
test("PAR04 filtros fechados/datas inválidas e indisponibilidade não viram saldo zero", async () => {
  await scenario(async (app, cookie) => {
    for (const query of ["from=2026-11-01&to=2026-11-30", defaultQuery.replace("asOf=2026-11-06", "asOf=2026-02-30"), defaultQuery + "&status=card", defaultQuery + "&method=pix", defaultQuery + "&q=a&q=b", defaultQuery + "&limit=101", defaultQuery.replace("from=2026-11-01", "from=2026-12-01")]) assertError(await get(app, cookie, query), 400);
    assertError(await get(app, cookie, defaultQuery + "&offset=0", base() + "/export"), 400);
    const broken = await fixture.app({ tenantDatabaseUrls: { a: "postgresql://invalid:invalid@127.0.0.1:1/missing" } });
    try { assertError(await get(broken, cookie), 503); } finally { await broken.close(); }
  });
});
test("PAR05 exportação recusa truncamento e valores inconsistentes/overflow sem mutação", async () => {
  await scenario(async (app, cookie) => {
    const data = await seed(app, cookie), installment = await data.agreement("2026-11-01T12:00:00Z", "sale", 10001, 1);
    const agreement = (await fixture.a.migrationPool.query("SELECT agreement_id FROM finance_installments WHERE id=$1", [installment])).rows[0].agreement_id;
    await fixture.a.migrationPool.query("INSERT INTO finance_installments(id,agreement_id,kind,number,count,amount_cents,due,created_at) SELECT gen_random_uuid(),$1,'installment',n,10001,1,'2026-11-05','2026-11-01T12:00:00Z' FROM generate_series(2,10001) n", [agreement]);
    assertError(await get(app, cookie, data.query, base() + "/export"), 413);
    const corrupt = await seed(app, cookie), overpaid = await corrupt.agreement("2026-11-01T12:00:00Z"); await corrupt.payment("2026-11-04T12:00:00Z", [[overpaid, 1001]]);
    assertError(await get(app, cookie, corrupt.query + "&status=paid"), 503);
    const huge = await seed(app, cookie); await huge.agreement("2026-11-01T12:00:00Z", "sale", Number.MAX_SAFE_INTEGER); await huge.agreement("2026-11-01T12:00:00Z", "order", 1);
    assertError(await get(app, cookie, huge.query), 503);
    assert.equal((await fixture.a.migrationPool.query("SELECT count(*)::int n FROM finance_movements")).rows[0].n, 0);
  });
});
