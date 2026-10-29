import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import { createFixture, login, authHeaders, createCustomer, TENANT_A, TENANT_B, assertError, type Fixture, type TestApp } from "./helpers.ts";
import { planInstallments } from "../../shared/finance-planner.mjs";

// Cenários FIN01–FIN26 definidos pelo QA independente; complementos DSC pelo coordenador antes do código.
// Cada cenário usa clientes/contas/produtos próprios; sem dados ou contas da demonstração.
let fixture: Fixture;
before(async () => { fixture = await createFixture(); });
after(async () => { await fixture?.close(); });
const tenantBase = (tenant = TENANT_A) => `/api/v1/tenants/${tenant}`;
const opBase = (tenant = TENANT_A) => `${tenantBase(tenant)}/operations`;
const finBase = (tenant = TENANT_A) => `${tenantBase(tenant)}/finance`;
const financeRights = ["finance.read", "finance.agreements.create", "finance.receive", "finance.accounts.manage", "finance.cash.manage"];
type Actor = { id: string; email: string; password: string };
async function scenario(run: (app: TestApp, cookie: string, actor: Actor) => Promise<void>) {
  const app = await fixture.app();
  try { const actor = await fixture.user(); const { cookie } = await login(app, actor); await run(app, cookie, actor); }
  finally { await app.close(); }
}
async function request(app: TestApp, cookie: string, type: string, data: unknown, requestId: string = randomUUID(), tenant = TENANT_A) {
  return app.instance.inject({ method: "POST", url: `${opBase(tenant)}/commands`, headers: authHeaders(cookie), payload: { requestId, type, data } });
}
async function command(app: TestApp, cookie: string, type: string, data: unknown, requestId?: string): Promise<any> {
  const response = await request(app, cookie, type, data, requestId);
  assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().tenantId, TENANT_A); return response.json().entity;
}
async function get(app: TestApp, cookie: string, resource: string, tenant = TENANT_A): Promise<any> {
  const response = await app.instance.inject({ method: "GET", url: `${finBase(tenant)}/${resource}`, headers: { cookie } });
  assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().tenantId, tenant); return response.json();
}
async function installments(app: TestApp, cookie: string, customerId: string) {
  return (await get(app, cookie, `installments?customerId=${customerId}&status=all&limit=100`)).items as any[];
}
async function payments(app: TestApp, cookie: string, customerId: string) {
  return (await get(app, cookie, `payments?customerId=${customerId}&limit=100`)).items as any[];
}
async function account(app: TestApp, cookie: string, type = "bank") {
  return command(app, cookie, "account.create", { name: `Conta fictícia ${randomUUID()}`, type });
}
async function stock(app: TestApp, cookie: string, productId: string): Promise<any> {
  const response = await app.instance.inject({ method: "GET", url: `${opBase()}/stock?limit=100`, headers: { cookie } });
  assert.equal(response.statusCode, 200, response.body); return response.json().items.find((row: any) => row.productId === productId);
}
async function fixtureSale(app: TestApp, cookie: string, price = 10000, physical = 5) {
  const buyer = await createCustomer(app, cookie);
  const product = await command(app, cookie, "product.create", { sku: `FIN-${randomUUID()}`, name: `Produto financeiro ${randomUUID()}`, salePriceCents: price });
  await command(app, cookie, "stock.receive", { productId: product.id, quantity: physical, reference: "Conferência fictícia do QA" });
  return { buyer, product, items: [{ productId: product.id, quantity: 1, version: product.version }] };
}
function later(customerId: string, items: any[], patch: Record<string, unknown> = {}): any {
  return { customerId, items, deliver: true, terms: { downPaymentCents: 0, installmentCount: 1, firstDue: "2100-01-30" }, ...patch };
}
function transfer(customerId: string, accountId: string, amountCents: number, patch: Record<string, unknown> = {}): any {
  return { customerId, accountId, amountCents, method: "transfer", creditConfirmed: true, reference: `Conferência ${randomUUID()}`, ...patch };
}
async function balance(app: TestApp, cookie: string, accountId: string) {
  return (await get(app, cookie, "overview")).accounts.find((row: any) => row.id === accountId).balanceCents;
}
async function movements(app: TestApp, cookie: string, accountId: string) {
  return (await get(app, cookie, `movements?accountId=${accountId}&limit=100`)).items as any[];
}

test("FIN01 identidade, empresa e concessão financeira são revalidadas; empresa vazia não recebe contas fictícias", async () => {
  await scenario(async (app, cookie) => {
    const initial = await get(app, cookie, "overview");
    assert.deepEqual(initial.accounts, []); assert.deepEqual(initial.shifts, []); assert.deepEqual(initial.items, []); assert.match(initial.asOf, /^\d{4}-\d{2}-\d{2}$/);
    assertError(await app.instance.inject({ method: "GET", url: `${finBase()}/overview` }), 401);
    assertError(await app.instance.inject({ method: "GET", url: `${finBase(TENANT_B)}/overview`, headers: { cookie } }), 403);
    const user = await fixture.user("operator"), session = await login(app, user);
    assertError(await app.instance.inject({ method: "GET", url: `${finBase()}/overview`, headers: { cookie: session.cookie } }), 403);
    await fixture.control.migrationPool.query("UPDATE memberships SET permission_overrides=$1 WHERE user_id=$2 AND tenant_id=$3", [JSON.stringify({ "finance.read": true }), user.id, TENANT_A]);
    assert.equal((await app.instance.inject({ method: "GET", url: `${finBase()}/overview`, headers: { cookie: session.cookie } })).statusCode, 200);
    assertError(await request(app, session.cookie, "account.create", { name: "Sem concessão", type: "bank" }), 403);
    await fixture.control.migrationPool.query("UPDATE memberships SET active=false WHERE user_id=$1 AND tenant_id=$2", [user.id, TENANT_A]);
    assertError(await app.instance.inject({ method: "GET", url: `${finBase()}/overview`, headers: { cookie: session.cookie } }), 403);
  });
});

test("FIN02 conta e turno começam sem dinheiro inventado; um caixa aberto por conta e fechamento preserva diferença", async () => {
  await scenario(async (app, cookie, actor) => {
    const cash = await account(app, cookie, "cash"), bank = await account(app, cookie);
    assert.equal(cash.balanceCents, 0); assert.equal(cash.active, true); assert.equal(bank.balanceCents, 0);
    const attempt = randomUUID(), shift = await command(app, cookie, "shift.open", { accountId: cash.id }, attempt);
    assert.equal(shift.status, "open"); assert.equal(shift.openedBy, actor.id); assert.equal(shift.openingBalanceCents, 0); assert.match(shift.openedAt, /Z$/);
    assert.equal((await command(app, cookie, "shift.open", { accountId: cash.id }, attempt)).id, shift.id);
    assertError(await request(app, cookie, "shift.open", { accountId: cash.id }), 409);
    assertError(await request(app, cookie, "shift.open", { accountId: bank.id }), 409);
    const otherActor = await fixture.user(), otherSession = await login(app, otherActor);
    assertError(await request(app, otherSession.cookie, "shift.close", { id: shift.id, version: shift.version, countedCents: 0 }), 403);
    const closed = await command(app, cookie, "shift.close", { id: shift.id, version: shift.version, countedCents: 200 });
    assert.equal(closed.status, "closed"); assert.equal(closed.expectedCents, 0); assert.equal(closed.differenceCents, 200);
    assert.equal(await balance(app, cookie, cash.id), 0); assert.deepEqual(await movements(app, cookie, cash.id), []);
  });
});

test("FIN03 levar agora e pagar depois entrega estoque e cria uma dívida sem movimento de dinheiro", async () => {
  await scenario(async (app, cookie) => {
    const { buyer, product, items } = await fixtureSale(app, cookie, 30000);
    const sale = await command(app, cookie, "sale.checkout", later(buyer.id, items));
    assert.equal(sale.status, "delivered"); assert.equal(sale.customerId, buyer.id); assert.equal(sale.totalCents, 30000);
    const rows = await installments(app, cookie, buyer.id); assert.equal(rows.length, 1); assert.equal(rows[0].amountCents, 30000); assert.equal(rows[0].balanceCents, 30000); assert.equal(rows[0].due, "2100-01-30");
    assert.equal(rows[0].sourceType, "sale"); assert.equal(rows[0].sourceId, sale.id); assert.deepEqual(await payments(app, cookie, buyer.id), []);
    const saved = await stock(app, cookie, product.id); assert.equal(saved.physical, 4); assert.equal(saved.reserved, 0); assert.equal(saved.available, 4);
  });
});

test("FIN04 parcelamento reparte centavos exatos e fim de mês volta à âncora original", async () => {
  await scenario(async (app, cookie) => {
    const { buyer, product, items } = await fixtureSale(app, cookie);
    const sale = await command(app, cookie, "sale.checkout", later(buyer.id, items, { deliver: false, terms: { downPaymentCents: 0, installmentCount: 3, firstDue: "2100-01-31" } }));
    assert.equal(sale.status, "confirmed");
    const rows = (await installments(app, cookie, buyer.id)).sort((a, b) => a.number - b.number);
    assert.deepEqual(rows.map((row) => row.amountCents), [3334, 3333, 3333]); assert.deepEqual(rows.map((row) => row.due), ["2100-01-31", "2100-02-28", "2100-03-31"]);
    const saved = await stock(app, cookie, product.id); assert.equal(saved.physical, 5); assert.equal(saved.reserved, 1);
  });
});

test("FIN05 entrada prometida mantém todos os títulos abertos e pagamento da entrada confirma uma única vez", async () => {
  await scenario(async (app, cookie) => {
    const bank = await account(app, cookie), { buyer, items } = await fixtureSale(app, cookie, 100000);
    await command(app, cookie, "sale.checkout", later(buyer.id, items, { terms: { downPaymentCents: 20000, downPaymentDue: "2100-01-01", installmentCount: 4, firstDue: "2100-02-01" } }));
    let rows = await installments(app, cookie, buyer.id); assert.equal(rows.length, 5); assert.equal(rows.reduce((sum, row) => sum + row.balanceCents, 0), 100000); assert.equal(await balance(app, cookie, bank.id), 0);
    const down = rows.find((row) => row.kind === "down_payment"); assert.equal(down.amountCents, 20000);
    const payment = await command(app, cookie, "payment.receive", transfer(buyer.id, bank.id, 20000, { allocations: [{ installmentId: down.id, amountCents: 20000 }] }));
    assert.equal(payment.amountCents, 20000); rows = await installments(app, cookie, buyer.id); assert.equal(rows.reduce((sum, row) => sum + row.balanceCents, 0), 80000); assert.equal(await balance(app, cookie, bank.id), 20000);
  });
});

test("FIN06 venda à vista com dinheiro, entrega e troco gera um recibo e um movimento pelo valor líquido", async () => {
  await scenario(async (app, cookie, actor) => {
    const cash = await account(app, cookie, "cash"), shift = await command(app, cookie, "shift.open", { accountId: cash.id });
    const { buyer, items, product } = await fixtureSale(app, cookie, 15000);
    await command(app, cookie, "sale.checkout", later(buyer.id, items, { terms: { downPaymentCents: 15000, downPaymentDue: "2100-01-01", installmentCount: 0 }, payment: { amountCents: 15000, method: "cash", accountId: cash.id, shiftId: shift.id, creditConfirmed: false, tenderedCents: 20000 } }));
    const entries = await payments(app, cookie, buyer.id); assert.equal(entries.length, 1);
    const paid = entries[0]; assert.equal(paid.amountCents, 15000); assert.equal(paid.receipt.tenderedCents, 20000); assert.equal(paid.receipt.changeCents, 5000); assert.equal(paid.receipt.receivedBy, actor.id); assert.match(paid.receipt.receivedAt, /Z$/); assert.equal(paid.receipt.remainingCents, 0);
    assert.equal((await installments(app, cookie, buyer.id))[0].balanceCents, 0); assert.equal(await balance(app, cookie, cash.id), 15000);
    const ledger = await movements(app, cookie, cash.id); assert.equal(ledger.length, 1); assert.equal(ledger[0].amountCents, 15000); assert.equal(ledger[0].paymentId, paid.id);
    assert.equal((await stock(app, cookie, product.id)).physical, 4);
    const closed = await command(app, cookie, "shift.close", { id: shift.id, version: shift.version, countedCents: 14000 });
    assert.equal(closed.expectedCents, 15000); assert.equal(closed.differenceCents, -1000); assert.equal(await balance(app, cookie, cash.id), 15000);
  });
});

test("FIN07 entrada recebida no checkout deixa somente o restante parcelado em aberto", async () => {
  await scenario(async (app, cookie) => {
    const bank = await account(app, cookie), { buyer, items } = await fixtureSale(app, cookie, 100000);
    await command(app, cookie, "sale.checkout", later(buyer.id, items, { terms: { downPaymentCents: 20000, installmentCount: 4, firstDue: "2100-02-15" }, payment: { amountCents: 20000, method: "pix", accountId: bank.id, reference: "Crédito conferido", creditConfirmed: true } }));
    const rows = await installments(app, cookie, buyer.id); assert.equal(rows.length, 5); assert.equal(rows.find((row) => row.kind === "down_payment").balanceCents, 0); assert.equal(rows.filter((row) => row.kind === "installment").every((row) => row.amountCents === 20000 && row.balanceCents === 20000), true);
    assert.equal(await balance(app, cookie, bank.id), 20000); assert.equal((await payments(app, cookie, buyer.id)).length, 1);
  });
});

test("FIN08 pagamento inválido no checkout desfaz venda, acordo e estoque sem marcar a tentativa", async () => {
  await scenario(async (app, cookie) => {
    const cash = await account(app, cookie, "cash"), { buyer, product, items } = await fixtureSale(app, cookie, 15000);
    const id = randomUUID(), data = later(buyer.id, items, { terms: { downPaymentCents: 15000, installmentCount: 0 }, payment: { amountCents: 15000, method: "cash", accountId: cash.id, creditConfirmed: false, tenderedCents: 15000 } });
    assertError(await request(app, cookie, "sale.checkout", data, id), 409);
    assert.deepEqual(await installments(app, cookie, buyer.id), []); assert.deepEqual(await payments(app, cookie, buyer.id), []); assert.equal(await balance(app, cookie, cash.id), 0);
    const saved = await stock(app, cookie, product.id); assert.equal(saved.physical, 5); assert.equal(saved.reserved, 0);
    const shift = await command(app, cookie, "shift.open", { accountId: cash.id });
    data.payment = { ...(data.payment as Record<string, unknown>), shiftId: shift.id };
    const sale = await command(app, cookie, "sale.checkout", data, id); assert.equal(sale.status, "delivered");
  });
});

test("FIN09 Pix e transferência exigem conferência explícita; pagamento não pode exceder nem divergir da entrada", async () => {
  await scenario(async (app, cookie) => {
    const bank = await account(app, cookie), { buyer, items } = await fixtureSale(app, cookie, 10000);
    const terms = { downPaymentCents: 2000, installmentCount: 1, firstDue: "2100-02-01" };
    for (const payment of [
      { amountCents: 2000, method: "pix", accountId: bank.id, creditConfirmed: false, reference: "Agendado" },
      { amountCents: 2000, method: "transfer", accountId: bank.id, creditConfirmed: true, reference: "" },
      { amountCents: 1000, method: "pix", accountId: bank.id, creditConfirmed: true, reference: "Parcial indevido no checkout" },
      { amountCents: 3000, method: "pix", accountId: bank.id, creditConfirmed: true, reference: "Maior que entrada" },
    ]) assertError(await request(app, cookie, "sale.checkout", later(buyer.id, items, { terms, payment })), 400);
    assert.deepEqual(await installments(app, cookie, buyer.id), []); assert.equal(await balance(app, cookie, bank.id), 0);
  });
});

test("FIN10 retentativa do checkout não duplica venda, parcelas, pagamento ou baixa; conteúdo diferente conflita", async () => {
  await scenario(async (app, cookie) => {
    const bank = await account(app, cookie), { buyer, product, items } = await fixtureSale(app, cookie, 10000);
    const id = randomUUID(), data = later(buyer.id, items, { terms: { downPaymentCents: 10000, installmentCount: 0 }, payment: { amountCents: 10000, method: "pix", accountId: bank.id, creditConfirmed: true, reference: "Repetível" } });
    const one = await command(app, cookie, "sale.checkout", data, id), two = await command(app, cookie, "sale.checkout", data, id);
    assert.equal(two.id, one.id); assertError(await request(app, cookie, "sale.checkout", { ...data, deliver: false }, id), 409);
    assert.equal((await installments(app, cookie, buyer.id)).length, 1); assert.equal((await payments(app, cookie, buyer.id)).length, 1); assert.equal((await movements(app, cookie, bank.id)).length, 1);
    assert.equal((await stock(app, cookie, product.id)).physical, 4);
  });
});

test("FIN11 duas conclusões concorrentes da última unidade não criam dívida para a venda recusada", async () => {
  await scenario(async (app, cookie) => {
    const { buyer, product, items } = await fixtureSale(app, cookie, 10000, 1);
    const attempts = await Promise.all([request(app, cookie, "sale.checkout", later(buyer.id, items)), request(app, cookie, "sale.checkout", later(buyer.id, items))]);
    assert.deepEqual(attempts.map((row) => row.statusCode).sort(), [200, 409]);
    const rows = await installments(app, cookie, buyer.id); assert.equal(rows.length, 1); assert.equal(rows[0].balanceCents, 10000);
    const saved = await stock(app, cookie, product.id); assert.equal(saved.physical, 0); assert.equal(saved.reserved, 0);
  });
});

test("FIN12 um recebimento por cliente abate mais antigas, permite parcial e gera só um movimento", async () => {
  await scenario(async (app, cookie) => {
    const bank = await account(app, cookie), { buyer, items, product } = await fixtureSale(app, cookie, 30000);
    await command(app, cookie, "sale.checkout", later(buyer.id, items, { terms: { downPaymentCents: 0, installmentCount: 3, firstDue: "2100-01-01" } }));
    const originalStock = await stock(app, cookie, product.id), id = randomUUID(), data = transfer(buyer.id, bank.id, 15000);
    const paid = await command(app, cookie, "payment.receive", data, id), replay = await command(app, cookie, "payment.receive", data, id);
    assert.equal(paid.id, replay.id); assert.equal(paid.allocations.length, 2); assert.equal(paid.allocations.reduce((sum: number, row: any) => sum + row.amountCents, 0), 15000);
    const rows = (await installments(app, cookie, buyer.id)).sort((a, b) => a.number - b.number); assert.deepEqual(rows.map((row) => row.balanceCents), [0, 5000, 10000]);
    assert.equal(paid.receipt.allocations.length, 2); assert.equal(paid.receipt.remainingCents, 15000); assert.equal((await payments(app, cookie, buyer.id)).length, 1); assert.equal((await movements(app, cookie, bank.id)).length, 1); assert.equal(await balance(app, cookie, bank.id), 15000);
    assert.deepEqual(await stock(app, cookie, product.id), originalStock);
    assertError(await request(app, cookie, "payment.receive", { ...data, amountCents: 16000 }, id), 409);
  });
});

test("FIN13 alocações manuais conferem soma, duplicados, saldo e cliente sem efeito parcial", async () => {
  await scenario(async (app, cookie) => {
    const bank = await account(app, cookie), one = await fixtureSale(app, cookie), two = await fixtureSale(app, cookie);
    await command(app, cookie, "sale.checkout", later(one.buyer.id, one.items)); await command(app, cookie, "sale.checkout", later(two.buyer.id, two.items));
    const a = (await installments(app, cookie, one.buyer.id))[0], b = (await installments(app, cookie, two.buyer.id))[0];
    for (const allocations of [
      [{ installmentId: b.id, amountCents: 5000 }],
      [{ installmentId: a.id, amountCents: 4000 }],
      [{ installmentId: a.id, amountCents: 2500 }, { installmentId: a.id, amountCents: 2500 }],
    ]) {
      const response = await request(app, cookie, "payment.receive", transfer(one.buyer.id, bank.id, 5000, { allocations }));
      assert.ok([400, 409].includes(response.statusCode), response.body);
    }
    assertError(await request(app, cookie, "payment.receive", transfer(one.buyer.id, bank.id, 10001)), 409);
    assert.equal((await installments(app, cookie, one.buyer.id))[0].balanceCents, 10000); assert.deepEqual(await movements(app, cookie, bank.id), []);
  });
});

test("FIN14 dois recebimentos concorrentes não recebem a mesma dívida duas vezes", async () => {
  await scenario(async (app, cookie) => {
    const bank = await account(app, cookie), { buyer, items } = await fixtureSale(app, cookie);
    await command(app, cookie, "sale.checkout", later(buyer.id, items));
    const results = await Promise.all([request(app, cookie, "payment.receive", transfer(buyer.id, bank.id, 10000)), request(app, cookie, "payment.receive", transfer(buyer.id, bank.id, 10000))]);
    assert.deepEqual(results.map((row) => row.statusCode).sort(), [200, 409]); assert.equal((await payments(app, cookie, buyer.id)).length, 1); assert.equal(await balance(app, cookie, bank.id), 10000); assert.equal((await installments(app, cookie, buyer.id))[0].balanceCents, 0);
  });
});

test("FIN15 falha de auditoria desfaz todos os efeitos financeiros e permite recuperar a mesma tentativa", async () => {
  await scenario(async (app, cookie) => {
    const bank = await account(app, cookie), { buyer, product, items } = await fixtureSale(app, cookie);
    const role = new URL(fixture.config.tenantDatabaseUrls.a).username, id = randomUUID(), data = later(buyer.id, items);
    await fixture.a.migrationPool.query(`REVOKE INSERT ON audit_events FROM "${role}"`);
    try { assertError(await request(app, cookie, "sale.checkout", data, id), 503); }
    finally { await fixture.a.migrationPool.query(`GRANT INSERT ON audit_events TO "${role}"`); }
    assert.deepEqual(await installments(app, cookie, buyer.id), []); assert.equal((await stock(app, cookie, product.id)).physical, 5);
    await command(app, cookie, "sale.checkout", data, id);
    const paymentId = randomUUID(), paymentData = transfer(buyer.id, bank.id, 5000);
    await fixture.a.migrationPool.query(`REVOKE INSERT ON audit_events FROM "${role}"`);
    try { assertError(await request(app, cookie, "payment.receive", paymentData, paymentId), 503); }
    finally { await fixture.a.migrationPool.query(`GRANT INSERT ON audit_events TO "${role}"`); }
    assert.equal((await installments(app, cookie, buyer.id))[0].balanceCents, 10000); assert.equal(await balance(app, cookie, bank.id), 0); assert.deepEqual(await payments(app, cookie, buyer.id), []);
    await command(app, cookie, "payment.receive", paymentData, paymentId); assert.equal(await balance(app, cookie, bank.id), 5000);
  });
});

test("FIN16 acordo de OS exige aprovação e versão; preserva orçamento contratado e não consome estoque", async () => {
  await scenario(async (app, cookie) => {
    const buyer = await createCustomer(app, cookie), tech = await command(app, cookie, "technician.create", { name: `Técnico FIN ${randomUUID()}` });
    let order = await command(app, cookie, "order.create", { customerId: buyer.id, technicianId: tech.id, equipment: "Equipamento fictício", issue: "Serviço", due: "2100-01-01", laborCents: 120000 });
    const agreement = (version: number) => ({ sourceType: "order", sourceId: order.id, sourceVersion: version, downPaymentCents: 30000, downPaymentDue: "2100-01-01", installmentCount: 3, firstDue: "2100-02-01" });
    assertError(await request(app, cookie, "agreement.create", agreement(order.version)), 409);
    order = await command(app, cookie, "order.advance", { id: order.id, version: order.version }); order = await command(app, cookie, "order.advance", { id: order.id, version: order.version }); order = await command(app, cookie, "order.update", { id: order.id, version: order.version, approved: true });
    assertError(await request(app, cookie, "agreement.create", agreement(order.version - 1)), 409);
    await command(app, cookie, "agreement.create", agreement(order.version));
    const rows = await installments(app, cookie, buyer.id); assert.equal(rows.reduce((sum, row) => sum + row.amountCents, 0), 120000); assert.equal(rows.every((row) => row.sourceType === "order" && row.sourceId === order.id), true);
    assertError(await request(app, cookie, "agreement.create", agreement(order.version)), 409);
    const saved = await app.instance.inject({ method: "GET", url: `${opBase()}/orders?q=${order.number}`, headers: { cookie } }); assert.equal(saved.statusCode, 200);
    const current = saved.json().items.find((row: any) => row.id === order.id);
    assertError(await request(app, cookie, "order.update", { id: order.id, version: current.version, laborCents: 150000 }), 409);
    assertError(await request(app, cookie, "order.update", { id: order.id, version: current.version, approved: false }), 409);
    assert.deepEqual(await payments(app, cookie, buyer.id), []);
  });
});

test("FIN17 recibo preserva cliente e conta originais; autor, horário e valores forjados são recusados", async () => {
  await scenario(async (app, cookie, actor) => {
    const bank = await account(app, cookie), { buyer, items } = await fixtureSale(app, cookie);
    await command(app, cookie, "sale.checkout", later(buyer.id, items));
    const paid = await command(app, cookie, "payment.receive", transfer(buyer.id, bank.id, 2000));
    const before = (await get(app, cookie, `payments/${paid.id}`)).payment;
    const changed = await app.instance.inject({ method: "PATCH", url: `${tenantBase()}/customers/${buyer.id}`, headers: authHeaders(cookie), payload: { version: buyer.version, name: "Nome posterior não reescreve recibo" } }); assert.equal(changed.statusCode, 200);
    const after = (await get(app, cookie, `payments/${paid.id}`)).payment;
    assert.deepEqual(after.receipt, before.receipt); assert.equal(after.receipt.customerName, buyer.name); assert.equal(after.receipt.accountName, bank.name); assert.equal(after.receipt.receivedBy, actor.id);
    assertError(await request(app, cookie, "payment.receive", { ...transfer(buyer.id, bank.id, 1000), actorId: "forjado", receivedAt: "2000-01-01T00:00:00Z" }), 400);
    assertError(await app.instance.inject({ method: "GET", url: `${finBase(TENANT_B)}/payments/${paid.id}`, headers: { cookie } }), 403);
    assert.equal((await payments(app, cookie, buyer.id)).length, 1);
    const archived = await app.instance.inject({ method: "PATCH", url: `${tenantBase()}/customers/${buyer.id}`, headers: authHeaders(cookie), payload: { version: changed.json().customer.version, active: false } }); assert.equal(archived.statusCode, 200);
    await command(app, cookie, "payment.receive", transfer(buyer.id, bank.id, 1000));
    assert.equal((await installments(app, cookie, buyer.id))[0].balanceCents, 7000);
    assert.deepEqual((await get(app, cookie, `payments/${paid.id}`)).payment.receipt, before.receipt);
  });
});

test("FIN18 filtros de cliente/status e resumo separam aberto, vencido e recebido sem duplicar fontes", async () => {
  await scenario(async (app, cookie) => {
    const bank = await account(app, cookie), { buyer, items } = await fixtureSale(app, cookie, 12000);
    await command(app, cookie, "sale.checkout", later(buyer.id, items, { terms: { downPaymentCents: 0, installmentCount: 2, firstDue: "2020-01-01" } }));
    await command(app, cookie, "payment.receive", transfer(buyer.id, bank.id, 2000));
    const overview = await get(app, cookie, `overview?q=${encodeURIComponent(buyer.name)}&status=overdue&limit=25&offset=0`);
    assert.equal(overview.items.length, 1); assert.equal(overview.items[0].customerId, buyer.id); assert.equal(overview.items[0].outstandingCents, 10000); assert.equal(overview.items[0].overdueCents, 10000); assert.equal(overview.items[0].paidCents, 2000);
    assert.deepEqual((await get(app, cookie, "overview?q=%25&status=all")).items, []);
    const rows = await get(app, cookie, `installments?customerId=${buyer.id}&status=open&limit=1&offset=0`); assert.equal(rows.total, 2); assert.equal(rows.items.length, 1);
    assertError(await app.instance.inject({ method: "GET", url: `${finBase()}/overview?limit=101`, headers: { cookie } }), 400);
  });
});

test("FIN19 permissões compostas do checkout e replay não concedem recebimento ou entrega silenciosamente", async () => {
  await scenario(async (app, cookie) => {
    const bank = await account(app, cookie), { buyer, items } = await fixtureSale(app, cookie), user = await fixture.user("viewer");
    const grants = { "customers.read": true, "products.read": true, "stock.read": true, "sales.read": true, "sales.create": true, "finance.read": true, "finance.agreements.create": true };
    await fixture.control.migrationPool.query("UPDATE memberships SET permission_overrides=$1 WHERE user_id=$2 AND tenant_id=$3", [JSON.stringify(grants), user.id, TENANT_A]);
    const session = await login(app, user), id = randomUUID(), data = later(buyer.id, items, { deliver: false });
    assertError(await request(app, session.cookie, "sale.checkout", { ...data, deliver: true }), 403);
    assertError(await request(app, session.cookie, "sale.checkout", { ...data, terms: { downPaymentCents: 10000, installmentCount: 0 }, payment: { amountCents: 10000, method: "pix", accountId: bank.id, creditConfirmed: true, reference: "Sem direito" } }), 403);
    const sale = await command(app, session.cookie, "sale.checkout", data, id); assert.equal(sale.status, "confirmed");
    await fixture.control.migrationPool.query("UPDATE memberships SET permission_overrides=$1 WHERE user_id=$2 AND tenant_id=$3", [JSON.stringify({ ...grants, "finance.agreements.create": false }), user.id, TENANT_A]);
    assertError(await request(app, session.cookie, "sale.checkout", data, id), 403);
    const options = await app.instance.inject({ method: "GET", url: `${tenantBase()}/access-options`, headers: { cookie } }); assert.equal(options.statusCode, 200);
    const ids = options.json().operationalPermissions.map((row: any) => row.id); assert.equal(financeRights.every((right) => ids.includes(right)), true);
  });
});

test("FIN20 parcelamento inválido e origem com acordo já existente não geram novos compromissos", async () => {
  await scenario(async (app, cookie) => {
    const { buyer, items } = await fixtureSale(app, cookie), sale = await command(app, cookie, "sale.confirm", { customerId: buyer.id, items });
    const data = { sourceType: "sale", sourceId: sale.id, sourceVersion: sale.version, downPaymentCents: 0, installmentCount: 3, firstDue: "2100-01-31" };
    for (const invalid of [{ ...data, installmentCount: 37 }, { ...data, firstDue: "2100-02-30" }, { ...data, installmentDueDates: ["2100-01-31"] }, { ...data, downPaymentCents: -1 }, { ...data, downPaymentCents: 10001 }]) assertError(await request(app, cookie, "agreement.create", invalid), 400);
    assert.deepEqual(await installments(app, cookie, buyer.id), []);
    await command(app, cookie, "agreement.create", { ...data, installmentDueDates: ["2100-01-31", "2100-03-01", "2100-04-15"] });
    assert.deepEqual((await installments(app, cookie, buyer.id)).sort((a, b) => a.number - b.number).map((row) => row.due), ["2100-01-31", "2100-03-01", "2100-04-15"]);
    assertError(await request(app, cookie, "agreement.create", data), 409);
  });
});

test("FIN21 cadastro gera SKU interno único quando o atendente informa somente produto e preço", async () => {
  await scenario(async (app, cookie) => {
    const data = { name: `Produto sem digitar código ${randomUUID()}`, salePriceCents: 2500 };
    const one = await command(app, cookie, "product.create", data), two = await command(app, cookie, "product.create", data);
    assert.equal(typeof one.sku, "string"); assert.ok(one.sku.trim().length > 0); assert.equal(typeof two.sku, "string"); assert.ok(two.sku.trim().length > 0);
    assert.notEqual(one.id, two.id); assert.notEqual(one.sku, two.sku); assert.equal(one.stock.physical, 0); assert.equal(two.stock.physical, 0);
    const response = await app.instance.inject({ method: "GET", url: `${opBase()}/products?q=${encodeURIComponent(one.sku)}`, headers: { cookie } });
    assert.equal(response.statusCode, 200); assert.equal(response.json().items.some((row: any) => row.id === one.id && row.sku === one.sku), true);
  });
});

test("FIN22 pesquisa de produto encontra GTIN cadastrado para leitura de código sem digitar nome", async () => {
  await scenario(async (app, cookie) => {
    const gtin = "7891234567895", value = await command(app, cookie, "product.create", { sku: `BARCODE-${randomUUID()}`, name: "Leitura por código do fornecedor", salePriceCents: 2500, gtin });
    const response = await app.instance.inject({ method: "GET", url: `${opBase()}/products?q=${gtin}`, headers: { cookie } });
    assert.equal(response.statusCode, 200); assert.equal(response.json().items.some((row: any) => row.id === value.id && row.gtin === gtin), true);
  });
});

test("FIN23 vencimentos das parcelas respeitam a entrada também na primeira parcela e na edição manual", () => {
  const terms = { downPaymentCents: 2000, downPaymentDue: "2100-02-01", installmentCount: 2, firstDue: "2100-01-01" };
  assert.throws(() => planInstallments(10000, terms, "2026-10-26"));
  assert.throws(() => planInstallments(10000, { ...terms, firstDue: "2100-02-01", installmentDueDates: ["2100-01-01", "2100-03-01"] }, "2026-10-26"));
});

test("FIN24 turno de outro dia ou abertura posterior ao instante atual não autoriza dinheiro nem fechamento cronologicamente inválido", async () => {
  await scenario(async (app, cookie) => {
    const cash = await account(app, cookie, "cash"), { buyer, items } = await fixtureSale(app, cookie, 40000);
    await command(app, cookie, "sale.checkout", later(buyer.id, items));
    const shift = await command(app, cookie, "shift.open", { accountId: cash.id });
    const data = { customerId: buyer.id, amountCents: 10000, method: "cash", accountId: cash.id, shiftId: shift.id, creditConfirmed: false, tenderedCents: 10000 };
    // Simula somente estados persistidos de fixture: virada do dia e relógio anterior à abertura.
    await fixture.a.migrationPool.query("UPDATE finance_shifts SET opened_at=clock_timestamp()-INTERVAL '2 days' WHERE id=$1", [shift.id]);
    const previousDay = await request(app, cookie, "payment.receive", data);
    await fixture.a.migrationPool.query("UPDATE finance_shifts SET opened_at=clock_timestamp()+INTERVAL '5 minutes' WHERE id=$1", [shift.id]);
    const beforeOpening = await request(app, cookie, "payment.receive", data);
    const closeBeforeOpening = await request(app, cookie, "shift.close", { id: shift.id, version: shift.version, countedCents: 0 });
    assert.deepEqual([previousDay.statusCode, beforeOpening.statusCode, closeBeforeOpening.statusCode], [409, 409, 409]);
    assert.equal(await balance(app, cookie, cash.id), 0); assert.deepEqual(await payments(app, cookie, buyer.id), []);
    assert.equal((await installments(app, cookie, buyer.id))[0].balanceCents, 40000);
  });
});

test("FIN25 checkout é uma criação atômica: histórico não inventa estado anterior e a venda começa na versão um", async () => {
  await scenario(async (app, cookie, actor) => {
    const { buyer, items } = await fixtureSale(app, cookie), sale = await command(app, cookie, "sale.checkout", later(buyer.id, items));
    const response = await app.instance.inject({ method: "GET", url: `${opBase()}/history?entityType=sale&id=${sale.id}`, headers: { cookie } });
    assert.equal(response.statusCode, 200); const events = response.json().items;
    assert.equal(events.length, 1); assert.deepEqual(events[0].before, {}); assert.equal(events[0].actorId, actor.id); assert.equal(events[0].after.status, "delivered");
    assert.equal(events[0].version, 1); assert.equal(sale.version, 1); assert.equal(sale.createdAt, sale.updatedAt);
  });
});

test("FIN26 projeção financeira na venda mostra saldo real e é retirada sem finance.read", async () => {
  await scenario(async (app, cookie) => {
    const bank = await account(app, cookie), { buyer, items } = await fixtureSale(app, cookie, 30000), sale = await command(app, cookie, "sale.checkout", later(buyer.id, items, { deliver: false }));
    const read = async (session: string) => {
      const response = await app.instance.inject({ method: "GET", url: `${opBase()}/sales?q=${sale.number}`, headers: { cookie: session } });
      assert.equal(response.statusCode, 200); return response.json().items.find((row: any) => row.id === sale.id);
    };
    const initial = await read(cookie); assert.deepEqual(initial.finance, { agreementId: sale.agreementId, paidCents: 0, outstandingCents: 30000 });
    await command(app, cookie, "payment.receive", transfer(buyer.id, bank.id, 10000));
    const current = await read(cookie); assert.equal(current.status, "confirmed"); assert.deepEqual(current.finance, { agreementId: sale.agreementId, paidCents: 10000, outstandingCents: 20000 });
    const user = await fixture.user("viewer"); await fixture.control.migrationPool.query("UPDATE memberships SET permission_overrides=$1 WHERE user_id=$2 AND tenant_id=$3", [JSON.stringify({ "products.read": true, "stock.read": true, "sales.read": true }), user.id, TENANT_A]);
    const session = await login(app, user), restricted = await read(session.cookie); assert.equal(restricted.totalCents, 30000); assert.equal(Object.hasOwn(restricted, "finance"), false);
  });
});

// DSC: requisitos de múltiplos produtos e desconto total em centavos por linha.
test("DSC01 dois produtos, quantidades e desconto individual geram dívida líquida e baixas corretas", async () => {
  await scenario(async (app, cookie) => {
    const one = await fixtureSale(app, cookie, 10000), two = await fixtureSale(app, cookie, 5000);
    const items = [{ ...one.items[0], quantity: 2, discountCents: 1500 }, two.items[0]];
    const id = randomUUID(), data = later(one.buyer.id, items);
    const sale = await command(app, cookie, "sale.checkout", data, id);
    assert.equal(sale.grossCents, 25000); assert.equal(sale.discountCents, 1500); assert.equal(sale.totalCents, 23500);
    assert.equal(sale.items[0].unitPriceCents, 10000); assert.equal(sale.items[0].grossCents, 20000); assert.equal(sale.items[0].discountCents, 1500); assert.equal(sale.items[0].totalCents, 18500);
    assert.equal(sale.items[1].discountCents, 0); assert.equal(sale.items[1].totalCents, 5000);
    assert.equal((await installments(app, cookie, one.buyer.id))[0].amountCents, 23500);
    assert.equal((await stock(app, cookie, one.product.id)).physical, 3); assert.equal((await stock(app, cookie, two.product.id)).physical, 4);
    assert.equal((await command(app, cookie, "sale.checkout", data, id)).id, sale.id);
    assert.equal((await stock(app, cookie, one.product.id)).physical, 3);
    const catalog = await app.instance.inject({ method: "GET", url: `${opBase()}/products?code=${one.product.sku}`, headers: { cookie } });
    assert.equal(catalog.json().items[0].salePriceCents, 10000);
    const history = await app.instance.inject({ method: "GET", url: `${opBase()}/history?entityType=sale&id=${sale.id}`, headers: { cookie } });
    assert.equal(history.json().items[0].after.discountCents, 1500);
  });
});
test("DSC02 linhas repetidas somam quantidade e desconto sem descontar outros produtos", async () => {
  await scenario(async (app, cookie) => {
    const one = await fixtureSale(app, cookie, 1000), two = await fixtureSale(app, cookie, 500);
    const sale = await command(app, cookie, "sale.confirm", { customerId: one.buyer.id, items: [{ ...one.items[0], discountCents: 100 }, { ...one.items[0], quantity: 2, discountCents: 50 }, two.items[0]] });
    assert.equal(sale.items.length, 2); assert.equal(sale.items[0].quantity, 3); assert.equal(sale.items[0].discountCents, 150); assert.equal(sale.items[0].totalCents, 2850); assert.equal(sale.totalCents, 3350);
    assert.equal((await stock(app, cookie, one.product.id)).reserved, 3);
  });
});
test("DSC03 desconto inválido ou total forjado não deixa reserva nem acordo parcial", async () => {
  await scenario(async (app, cookie) => {
    const { buyer, product, items } = await fixtureSale(app, cookie, 1000);
    for (const discountCents of [-1, 1001, 0.5, '100', null, Number.MAX_SAFE_INTEGER + 1]) {
      assertError(await request(app, cookie, "sale.checkout", later(buyer.id, [{ ...items[0], discountCents }])), 400);
    }
    assertError(await request(app, cookie, "sale.checkout", later(buyer.id, [{ ...items[0], discountCents: 100, unitPriceCents: 1 }])), 400);
    assert.equal((await stock(app, cookie, product.id)).reserved, 0); assert.equal((await installments(app, cookie, buyer.id)).length, 0);
  });
});
test("DSC04 conceder desconto exige direito atual inclusive no replay e no comando sem financeiro", async () => {
  await scenario(async (app, cookie) => {
    const { buyer, items } = await fixtureSale(app, cookie), user = await fixture.user('viewer');
    const grants = { 'customers.read': true, 'products.read': true, 'stock.read': true, 'sales.read': true, 'sales.create': true, 'finance.read': true, 'finance.agreements.create': true };
    const grant = async (discount: boolean) => fixture.control.migrationPool.query('UPDATE memberships SET permission_overrides=$1 WHERE user_id=$2 AND tenant_id=$3', [JSON.stringify({ ...grants, ...(discount ? { 'sales.discount': true } : {}) }), user.id, TENANT_A]);
    await grant(false); const session = await login(app, user);
    const discounted = [{ ...items[0], discountCents: 100 }], data = later(buyer.id, discounted, { deliver: false }), id = randomUUID();
    assertError(await request(app, session.cookie, 'sale.checkout', data, id), 403);
    assertError(await request(app, session.cookie, 'sale.confirm', { customerId: buyer.id, items: discounted }), 403);
    await grant(true); const sale = await command(app, session.cookie, 'sale.checkout', data, id); assert.equal(sale.totalCents, 9900);
    await grant(false); assertError(await request(app, session.cookie, 'sale.checkout', data, id), 403);
  });
});
test("DSC05 entrada e parcelas usam o total líquido; snapshot não muda ao editar o catálogo", async () => {
  await scenario(async (app, cookie) => {
    const { buyer, product, items } = await fixtureSale(app, cookie, 10001);
    const sale = await command(app, cookie, 'sale.checkout', later(buyer.id, [{ ...items[0], discountCents: 1000 }], { deliver: false, terms: { downPaymentCents: 2000, installmentCount: 3, firstDue: '2100-01-30' } }));
    assert.equal(sale.totalCents, 9001); assert.equal((await installments(app, cookie, buyer.id)).reduce((sum, row) => sum + row.amountCents, 0), 9001);
    await command(app, cookie, 'product.update', { id: product.id, version: product.version, salePriceCents: 20000 });
    const response = await app.instance.inject({ method: 'GET', url: `${opBase()}/sales?limit=100`, headers: { cookie } });
    const saved = response.json().items.find((row: any) => row.id === sale.id); assert.equal(saved.items[0].unitPriceCents, 10001); assert.equal(saved.items[0].discountCents, 1000); assert.equal(saved.totalCents, 9001);
  });
});
test("DSC06 item integralmente descontado não transfere desconto para outra linha; carrinho zerado não gera acordo", async () => {
  await scenario(async (app, cookie) => {
    const one = await fixtureSale(app, cookie, 1000), two = await fixtureSale(app, cookie, 500);
    const sale = await command(app, cookie, 'sale.checkout', later(one.buyer.id, [{ ...one.items[0], discountCents: 1000 }, two.items[0]]));
    assert.equal(sale.items[0].totalCents, 0); assert.equal(sale.totalCents, 500);
    assertError(await request(app, cookie, 'sale.checkout', later(one.buyer.id, [{ ...one.items[0], discountCents: 1000 }])), 400);
    assert.equal((await stock(app, cookie, one.product.id)).physical, 4);
  });
});

test("OS-REC01 filtro da OS pagina somente sua dívida; recebimento parcial e replay preservam a venda do mesmo cliente", async () => {
  await scenario(async (app, cookie) => {
    const { buyer, items } = await fixtureSale(app, cookie, 10000);
    const sale = await command(app, cookie, "sale.checkout", later(buyer.id, items));
    const tech = await command(app, cookie, "technician.create", { name: "Técnico financeiro QA" });
    let order = await command(app, cookie, "order.create", { customerId: buyer.id, technicianId: tech.id, equipment: "Aparelho QA", issue: "Reparo QA", due: "2100-01-01", laborCents: 9000 });
    for (let i = 0; i < 2; i++) order = await command(app, cookie, "order.advance", { id: order.id, version: order.version });
    order = await command(app, cookie, "order.update", { id: order.id, version: order.version, approved: true });
    await command(app, cookie, "agreement.create", { sourceType: "order", sourceId: order.id, sourceVersion: order.version, downPaymentCents: 0, installmentCount: 3, firstDue: "2100-02-01" });
    const filter = `installments?customerId=${buyer.id}&sourceType=order&sourceId=${order.id}&status=open`;
    const first = await get(app, cookie, `${filter}&limit=1`), second = await get(app, cookie, `${filter}&limit=1&offset=1`);
    assert.equal(first.total, 3); assert.equal(first.items.length, 1); assert.equal(second.total, 3); assert.notEqual(first.items[0].id, second.items[0].id);
    assert.equal(first.items[0].sourceId, order.id); assert.equal(first.items[0].sourceType, "order");
    assert.equal((await get(app, cookie, `installments?customerId=${buyer.id}&sourceType=order&sourceId=${sale.id}`)).total, 0);
    const other = await createCustomer(app, cookie); assert.equal((await get(app, cookie, `installments?customerId=${other.id}&sourceType=order&sourceId=${order.id}`)).total, 0);
    const bank = await account(app, cookie), id = randomUUID(), data = transfer(buyer.id, bank.id, 1000, { sourceType: "order", sourceId: order.id, allocations: [{ installmentId: first.items[0].id, amountCents: 1000 }] });
    const saleInstallment = (await installments(app, cookie, buyer.id)).find((row) => row.sourceId === sale.id);
    assertError(await request(app, cookie, "payment.receive", { ...data, allocations: [{ installmentId: saleInstallment.id, amountCents: 1000 }] }), 409);
    const payment = await command(app, cookie, "payment.receive", data, id); assert.equal((await command(app, cookie, "payment.receive", data, id)).id, payment.id);
    const all = await installments(app, cookie, buyer.id);
    assert.equal(all.filter((row) => row.sourceId === sale.id).reduce((sum, row) => sum + row.balanceCents, 0), 10000);
    assert.equal(all.filter((row) => row.sourceId === order.id).reduce((sum, row) => sum + row.balanceCents, 0), 8000);
    assert.equal((await payments(app, cookie, buyer.id)).length, 1); assert.equal((await balance(app, cookie, bank.id)), 1000);
    const current = await app.instance.inject({ method: "GET", url: `${opBase()}/orders?q=${order.number}`, headers: { cookie } });
    assert.equal(current.json().items.find((row: any) => row.id === order.id).stage, order.stage);
  });
});

test("OS-REC03 recebimento automático e explícito respeitam origem no servidor sem quitar dívida anterior", async () => {
  await scenario(async (app, cookie) => {
    const { buyer, items } = await fixtureSale(app, cookie, 10000);
    const older = await command(app, cookie, "sale.checkout", later(buyer.id, items));
    const target = await command(app, cookie, "sale.checkout", later(buyer.id, items));
    const bank = await account(app, cookie), id = randomUUID();
    const data = transfer(buyer.id, bank.id, 500, { sourceType: "sale", sourceId: target.id });
    const payment = await command(app, cookie, "payment.receive", data, id);
    assert.equal(payment.receipt.allocations.every((row: any) => row.sourceId === target.id), true);
    assert.equal(payment.receipt.remainingCents, 19500); assert.equal((await command(app, cookie, "payment.receive", data, id)).id, payment.id);
    const rows = await installments(app, cookie, buyer.id), other = rows.find((row) => row.sourceId === older.id);
    assert.equal(other.balanceCents, 10000); assert.equal(rows.find((row) => row.sourceId === target.id).balanceCents, 9500);
    assertError(await request(app, cookie, "payment.receive", { ...data, allocations: [{ installmentId: other.id, amountCents: 500 }] }), 409);
    assertError(await request(app, cookie, "payment.receive", { ...data, amountCents: 9501 }), 409);
    for (const patch of [{ sourceId: undefined }, { sourceType: undefined }, { sourceType: "other" }, { sourceId: "bad" }]) assertError(await request(app, cookie, "payment.receive", { ...data, ...patch }), 400);
    assert.equal((await payments(app, cookie, buyer.id)).length, 1); assert.equal(await balance(app, cookie, bank.id), 500);
  });
});

test("OS-REC02 origem exige par válido, recurso correto e autenticação", async () => {
  await scenario(async (app, cookie) => {
    const id = randomUUID();
    for (const query of [`sourceType=order`, `sourceId=${id}`, `sourceType=unknown&sourceId=${id}`, `sourceType=order&sourceId=bad`]) {
      assertError(await app.instance.inject({ method: "GET", url: `${finBase()}/installments?${query}`, headers: { cookie } }), 400);
    }
    assertError(await app.instance.inject({ method: "GET", url: `${finBase()}/overview?sourceType=order&sourceId=${id}`, headers: { cookie } }), 400);
    assertError(await app.instance.inject({ method: "GET", url: `${finBase()}/installments?sourceType=order&sourceId=${id}` }), 401);
  });
});
