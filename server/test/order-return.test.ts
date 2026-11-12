import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { createFixture, login, createCustomer, authHeaders, assertError, TENANT_A, TENANT_B, type Fixture, type TestApp } from "./helpers.ts";

let fixture: Fixture;
before(async () => {
  fixture = await createFixture();
  for (const [db, tenant] of [[fixture.a, TENANT_A], [fixture.b, TENANT_B]] as const)
    await db.migrationPool.query("INSERT INTO tenant_admission(singleton,slot_id,tenant_id,claimed_at) VALUES(true,$1,$2,clock_timestamp())", [randomUUID(), tenant]);
});
after(async () => { await fixture?.close(); });
const base = (tenant = TENANT_A) => `/api/v1/tenants/${tenant}/operations`;
async function request(app: TestApp, cookie: string, type: string, data: unknown, requestId: string = randomUUID(), tenant = TENANT_A) {
  return app.instance.inject({ method: "POST", url: base(tenant) + "/commands", headers: authHeaders(cookie), payload: { requestId, type, data } });
}
async function command(app: TestApp, cookie: string, type: string, data: unknown, requestId?: string) {
  const response = await request(app, cookie, type, data, requestId);
  assert.equal(response.statusCode, 200, response.body); return response.json().entity;
}
async function scenario(run: (app: TestApp, cookie: string, actor: { id: string }) => Promise<void>) {
  const app = await fixture.app();
  try { const actor = await fixture.user(); const session = await login(app, actor); await run(app, session.cookie, actor); }
  finally { await app.close(); }
}
async function order(app: TestApp, cookie: string, stage = "received") {
  const customer = await createCustomer(app, cookie, TENANT_A, { name: `Cliente devolução ${randomUUID()}` });
  const tech = await command(app, cookie, "technician.create", { name: `Técnico QA ${randomUUID()}` });
  let value = await command(app, cookie, "order.create", { customerId: customer.id, technicianId: tech.id, equipment: "Aparelho QA", issue: "Não liga", laborCents: 1000, due: "2100-01-01" });
  if (stage !== "received") value = await command(app, cookie, "order.advance", { id: value.id, version: value.version });
  if (stage === "awaiting_approval") value = await command(app, cookie, "order.advance", { id: value.id, version: value.version });
  return value;
}
const returning = (value: any) => ({ id: value.id, version: value.version, reason: "estimate_declined", recipient: { type: "customer" }, confirmed: true });
async function saved(id: string) { return (await fixture.a.migrationPool.query("SELECT body,version,updated_at,updated_by FROM operational_records WHERE entity_type='order' AND id=$1", [id])).rows[0]; }

test("OS-SR01 devolve nas três etapas iniciais sem fabricar aprovação/testes e mantém orçamento", async () => {
  await scenario(async (app, cookie, actor) => {
    for (const stage of ["received", "diagnosing", "awaiting_approval"]) {
      const original = await order(app, cookie, stage);
      const result = await command(app, cookie, "order.return_without_repair", returning(original));
      assert.equal(result.stage, "closed_without_repair"); assert.equal(result.approved, false); assert.equal(result.tested, false);
      assert.equal(result.laborCents, original.laborCents); assert.equal(result.diagnosis, original.diagnosis); assert.equal(result.number, original.number);
      assert.equal(result.version, original.version + 1); assert.equal(result.createdAt, original.createdAt);
      assert.equal(result.returnWithoutRepair.reason, "estimate_declined"); assert.equal(result.returnWithoutRepair.recipientName, original.customerName);
      assert.equal(result.returnWithoutRepair.recipientType, "customer"); assert.equal(result.returnWithoutRepair.actorId, actor.id);
      assert.equal(result.returnWithoutRepair.at, result.updatedAt); assert.match(result.returnWithoutRepair.at, /Z$/);
      const events = (await fixture.a.migrationPool.query("SELECT * FROM audit_events WHERE entity_type='order' AND entity_id=$1 ORDER BY entity_version", [original.id])).rows;
      assert.equal(events.at(-1).action, "order.return_without_repair"); assert.equal(events.at(-1).actor_id, actor.id);
      assert.equal(events.at(-1).after_values.stage, "closed_without_repair");
      assert.equal(events.at(-1).after_values.returnReason, "estimate_declined");
      assert.equal(Object.hasOwn(events.at(-1).after_values, "returnWithoutRepair"), false);
      const list = await app.instance.inject({ method: "GET", url: base() + "/orders?status=closed_without_repair", headers: { cookie } });
      assert.equal(list.statusCode, 200); assert.ok(list.json().items.some((row: any) => row.id === original.id));
      const receipt = await app.instance.inject({ method: "GET", url: `/api/v1/tenants/${TENANT_A}/orders/${original.id}/receipt`, headers: { cookie } });
      assert.equal(receipt.statusCode, 200); assert.equal(receipt.json().order.returnWithoutRepair.recipientName, original.customerName);
      const report = await app.instance.inject({ method: "GET", url: `/api/v1/tenants/${TENANT_A}/reports/orders?from=1900-01-01&to=9999-12-31&stage=closed_without_repair&q=${encodeURIComponent(original.customerName)}`, headers: { cookie } });
      assert.equal(report.statusCode, 200, report.body); assert.equal(report.json().totals.count, 1); assert.equal(report.json().items[0].approved, false);
      for (const type of ["order.update", "order.advance", "order.deliver", "order.return_without_repair"])
        assertError(await request(app, cookie, type, type === "order.return_without_repair" ? returning(result) : { id: result.id, version: result.version, ...(type === "order.update" ? { diagnosis: "Alterado" } : type === "order.deliver" ? { allowUnsettled: true } : {}) }), 409);
    }
  });
});

test("OS-SR02 terceiro exige nome/autorização e outro motivo exige detalhe; autoria é do servidor", async () => {
  await scenario(async (app, cookie, actor) => {
    const value = await order(app, cookie);
    const result = await command(app, cookie, "order.return_without_repair", { ...returning(value), reason: "other", details: "  Reparo indisponível nesta unidade  ", recipient: { type: "other", name: "  Retirante QA  ", authorization: "  Cliente autorizou a retirada pelo contato já cadastrado  " } });
    assert.equal(result.returnWithoutRepair.details, "Reparo indisponível nesta unidade"); assert.equal(result.returnWithoutRepair.recipientName, "Retirante QA");
    assert.equal(result.returnWithoutRepair.authorization, "Cliente autorizou a retirada pelo contato já cadastrado"); assert.equal(result.returnWithoutRepair.actorId, actor.id);
    assert.ok(!app.logs.join("").includes("Retirante QA"));
  });
});

test("OS-SR03 payload inválido/forjado e serviço aprovado/iniciado não podem ser encerrados como sem reparo", async () => {
  await scenario(async (app, cookie) => {
    const value = await order(app, cookie);
    for (const patch of [{ confirmed: false }, { confirmed: undefined }, { reason: "" }, { reason: "cancel_all" }, { reason: "other" }, { details: "x".repeat(501) }, { recipient: { type: "other", name: "QA" } }, { recipient: { type: "other", name: "", authorization: "QA" } }, { recipient: { type: "customer", name: "Nome forjado" } }, { actorId: "forjado" }, { at: "1900-01-01" }, { version: 0 }])
      assertError(await request(app, cookie, "order.return_without_repair", { ...returning(value), ...patch }), 400);
    assert.equal((await saved(value.id)).version, value.version);
    for (const patch of [{ approved: true }, { tested: true }, { stage: "in_progress" }, { stage: "quality_check" }, { stage: "ready_for_pickup" }, { stage: "delivered" }, { agreementId: randomUUID() }]) {
      await fixture.a.migrationPool.query("UPDATE operational_records SET body=body || $2::jsonb WHERE id=$1", [value.id, JSON.stringify(patch)]);
      assertError(await request(app, cookie, "order.return_without_repair", returning(value)), 409);
      await fixture.a.migrationPool.query("UPDATE operational_records SET body=$2 WHERE id=$1", [value.id, JSON.stringify(Object.fromEntries(Object.entries(value).filter(([key]) => !["id", "version", "createdAt", "updatedAt", "createdBy", "updatedBy"].includes(key))))]);
    }
  });
});

test("OS-SR04 repetição/conteúdo/versão e concorrência preservam uma devolução e sua autoria", async () => {
  await scenario(async (app, cookie) => {
    const value = await order(app, cookie), data = returning(value), id = randomUUID();
    const first = await command(app, cookie, "order.return_without_repair", data, id);
    const second = await command(app, cookie, "order.return_without_repair", data, id); assert.deepEqual(second, first);
    assertError(await request(app, cookie, "order.return_without_repair", { ...data, reason: "customer_withdrew" }, id), 409);
    assertError(await request(app, cookie, "order.return_without_repair", data), 409);
    assert.equal((await fixture.a.migrationPool.query("SELECT count(*)::int n FROM audit_events WHERE entity_id=$1 AND action='order.return_without_repair'", [value.id])).rows[0].n, 1);
    const concurrent = await order(app, cookie);
    const results = await Promise.all([request(app, cookie, "order.return_without_repair", returning(concurrent)), request(app, cookie, "order.return_without_repair", returning(concurrent))]);
    assert.deepEqual(results.map(row => row.statusCode).sort(), [200, 409]);
  });
});

test("OS-SR05 vínculo/direito de entrega e revogação valem inclusive para replay", async () => {
  await scenario(async (app, cookie) => {
    const value = await order(app, cookie), data = returning(value);
    assertError(await request(app, "", "order.return_without_repair", data), 401);
    assertError(await request(app, cookie, "order.return_without_repair", data, undefined, TENANT_B), 403);
    const operator = await fixture.user("operator"), session = await login(app, operator);
    await fixture.control.migrationPool.query("UPDATE memberships SET permission_overrides=$1 WHERE user_id=$2", [JSON.stringify({ "orders.read": true }), operator.id]);
    assertError(await request(app, session.cookie, "order.return_without_repair", data), 403);
    await fixture.control.migrationPool.query("UPDATE memberships SET permission_overrides=$1 WHERE user_id=$2", [JSON.stringify({ "orders.read": true, "orders.deliver": true }), operator.id]);
    const id = randomUUID(); await command(app, session.cookie, "order.return_without_repair", data, id);
    await fixture.control.migrationPool.query("UPDATE memberships SET permission_overrides=$1 WHERE user_id=$2", [JSON.stringify({ "orders.read": true }), operator.id]);
    assertError(await request(app, session.cookie, "order.return_without_repair", data, id), 403);
  });
});

test("OS-SR06 falha na auditoria desfaz estado e tentativa; retentativa confirma uma vez", async () => {
  await scenario(async (app, cookie) => {
    const value = await order(app, cookie), data = returning(value), id = randomUUID(), role = fixture.a.runtimeUser;
    await fixture.a.migrationPool.query(`REVOKE INSERT ON audit_events FROM "${role}"`);
    try { assertError(await request(app, cookie, "order.return_without_repair", data, id), 503); }
    finally { await fixture.a.migrationPool.query(`GRANT INSERT ON audit_events TO "${role}"`); }
    assert.equal((await saved(value.id)).body.stage, "received"); assert.equal((await saved(value.id)).version, value.version);
    assert.equal((await fixture.a.migrationPool.query("SELECT count(*)::int n FROM operational_requests WHERE id=$1", [id])).rows[0].n, 0);
    assert.equal((await command(app, cookie, "order.return_without_repair", data, id)).stage, "closed_without_repair");
  });
});

test("OS-SR07 devolução preserva saldos/pagamentos/estoque e não cria cobrança do orçamento recusado", async () => {
  await scenario(async (app, cookie) => {
    const value = await order(app, cookie);
    const account = await command(app, cookie, "account.create", { name: "Banco QA", type: "bank" });
    const product = await command(app, cookie, "product.create", { name: "Produto QA", salePriceCents: 1000 });
    await command(app, cookie, "stock.receive", { productId: product.id, quantity: 2, reference: "Conferência QA" });
    await command(app, cookie, "sale.checkout", { customerId: value.customerId, items: [{ productId: product.id, version: product.version, quantity: 1 }], deliver: false, terms: { downPaymentCents: 0, installmentCount: 2, firstDue: "2100-01-01" } });
    await command(app, cookie, "payment.receive", { customerId: value.customerId, accountId: account.id, amountCents: 750, method: "pix", reference: "Crédito conferido QA", creditConfirmed: true });
    async function snapshot() {
      const result = [];
      for (const table of ["finance_accounts", "finance_agreements", "finance_installments", "finance_payments", "finance_allocations", "finance_movements", "stock_balances", "stock_movements"])
        result.push((await fixture.a.migrationPool.query(`SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) data FROM ${table} t`)).rows[0].data);
      return result;
    }
    const before = await snapshot(); const result = await command(app, cookie, "order.return_without_repair", returning(value));
    assert.deepEqual(await snapshot(), before); assert.equal(result.laborCents, 1000); assert.equal(result.approved, false); assert.equal(result.agreementId, undefined);
  });
});
