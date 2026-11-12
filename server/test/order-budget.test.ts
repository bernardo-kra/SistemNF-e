import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { createFixture, login, createCustomer, authHeaders, assertError, TENANT_A, type Fixture, type TestApp } from "./helpers.ts";

let fixture: Fixture;
before(async () => {
  fixture = await createFixture();
  await fixture.a.migrationPool.query("INSERT INTO tenant_admission(singleton,slot_id,tenant_id,claimed_at) VALUES(true,$1,$2,clock_timestamp())", [randomUUID(), TENANT_A]);
});
after(async () => { await fixture?.close(); });
const base = `/api/v1/tenants/${TENANT_A}`;
async function request(app: TestApp, cookie: string, type: string, data: unknown, requestId: string = randomUUID()) {
  return app.instance.inject({ method: "POST", url: base + "/operations/commands", headers: authHeaders(cookie), payload: { requestId, type, data } });
}
async function command(app: TestApp, cookie: string, type: string, data: unknown, requestId?: string) {
  const response = await request(app, cookie, type, data, requestId);
  assert.equal(response.statusCode, 200, response.body); return response.json().entity;
}
async function scenario(run: (app: TestApp, cookie: string, data: Record<string, unknown>) => Promise<void>) {
  const app = await fixture.app();
  try {
    const { cookie } = await login(app, await fixture.user());
    const customer = await createCustomer(app, cookie, TENANT_A, { name: `Cliente orçamento QA ${randomUUID()}` });
    const tech = await command(app, cookie, "technician.create", { name: `Técnico QA ${randomUUID()}` });
    await run(app, cookie, { customerId: customer.id, technicianId: tech.id, equipment: "Aparelho QA", issue: "Diagnóstico pendente", due: "2100-01-01" });
  } finally { await app.close(); }
}
const versioned = (order: any, extra: Record<string, unknown> = {}) => ({ id: order.id, version: order.version, ...extra });
async function awaiting(app: TestApp, cookie: string, order: any) {
  order = await command(app, cookie, "order.advance", versioned(order));
  return command(app, cookie, "order.advance", versioned(order));
}

test("OS-OP01 ausência/null preservam preço pendente; zero/positivo continuam valores definidos", async () => {
  await scenario(async (app, cookie, data) => {
    for (const extra of [{}, { laborCents: null }, { laborCents: 0 }, { laborCents: 1250 }]) {
      const id = randomUUID(), order = await command(app, cookie, "order.create", { ...data, ...extra }, id);
      const expected = "laborCents" in extra ? extra.laborCents : null;
      assert.equal(order.laborCents, expected); assert.equal(order.approved, false);
      assert.deepEqual(await command(app, cookie, "order.create", { ...data, ...extra }, id), order);
      const stored = (await fixture.a.migrationPool.query("SELECT body FROM operational_records WHERE id=$1", [order.id])).rows[0].body;
      assert.ok(Object.hasOwn(stored, "laborCents")); assert.equal(stored.laborCents, expected);
    }
    for (const laborCents of ["", "0", -1, 0.5, true]) assertError(await request(app, cookie, "order.create", { ...data, laborCents }), 400);
  });
});

test("OS-OP02 atualização omitida preserva, null limpa só proposta não aprovada e audita sem reescrever legado", async () => {
  await scenario(async (app, cookie, data) => {
    const original = await command(app, cookie, "order.create", { ...data, laborCents: 0 });
    let order = await command(app, cookie, "order.update", versioned(original, { diagnosis: "Exame QA" }));
    assert.equal(order.laborCents, 0);
    order = await command(app, cookie, "order.update", versioned(order, { laborCents: 1250 }));
    const proposed = order;
    order = await command(app, cookie, "order.update", versioned(order, { laborCents: null }));
    assert.equal(order.laborCents, null);
    assertError(await request(app, cookie, "order.update", versioned(proposed, { laborCents: 500 })), 409);
    order = await command(app, cookie, "order.update", versioned(order, { diagnosis: "Continua pendente QA" }));
    assert.equal(order.laborCents, null);
    const event = (await fixture.a.migrationPool.query("SELECT before_values,after_values FROM audit_events WHERE entity_id=$1 AND entity_version=$2", [order.id, proposed.version + 1])).rows[0];
    assert.equal(event.before_values.laborCents, 1250); assert.equal(event.after_values.laborCents, null);
    const receipt = await app.instance.inject({ method: "GET", url: base + `/orders/${order.id}/receipt`, headers: { cookie } });
    assert.equal(receipt.statusCode, 200); assert.equal(receipt.json().order.laborCents, null);
    order = await command(app, cookie, "order.return_without_repair", versioned(order, { reason: "customer_withdrew", recipient: { type: "customer" }, confirmed: true }));
    assert.equal(order.stage, "closed_without_repair"); assert.equal(order.laborCents, null);
  });
});

test("OS-OP03 orçamento pendente bloqueia aprovação atomicamente; valor zero permite reparar sem cobrança fictícia", async () => {
  await scenario(async (app, cookie, data) => {
    let order = await awaiting(app, cookie, await command(app, cookie, "order.create", { ...data, laborCents: null }));
    for (const extra of [{ approved: true }, { approved: true, laborCents: null }]) {
      assertError(await request(app, cookie, "order.update", versioned(order, extra)), 409);
      const saved = (await fixture.a.migrationPool.query("SELECT version,body FROM operational_records WHERE id=$1", [order.id])).rows[0];
      assert.equal(saved.version, order.version); assert.equal(saved.body.approved, false); assert.equal(saved.body.laborCents, null);
    }
    assertError(await request(app, cookie, "order.advance", versioned(order)), 409);
    order = await command(app, cookie, "order.update", versioned(order, { laborCents: 0 }));
    order = await command(app, cookie, "order.approve", versioned(order, { budgetRevision: order.budgetRevision, channel: "in_person" }));
    assert.equal(order.approved, true); assert.equal(order.laborCents, 0);
    assertError(await request(app, cookie, "order.update", versioned(order, { laborCents: null })), 409);
    order = await command(app, cookie, "order.advance", versioned(order)); assert.equal(order.stage, "in_progress");
    for (const table of ["finance_agreements", "finance_payments", "finance_movements"])
      assert.equal((await fixture.a.migrationPool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n, 0);
  });
});

test("OS-OP04 acordo exige valor positivo definido; proposta aprovada/com acordo não pode virar pendente", async () => {
  await scenario(async (app, cookie, data) => {
    const terms = { sourceType: "order", downPaymentCents: 0, installmentCount: 1, firstDue: "2100-01-01" };
    const pending = await command(app, cookie, "order.create", { ...data, laborCents: null });
    assertError(await request(app, cookie, "agreement.create", { ...terms, sourceId: pending.id, sourceVersion: pending.version }), 409);
    let free = await awaiting(app, cookie, await command(app, cookie, "order.create", { ...data, laborCents: 0 }));
    free = await command(app, cookie, "order.approve", versioned(free, { budgetRevision: free.budgetRevision, channel: "in_person" }));
    assertError(await request(app, cookie, "agreement.create", { ...terms, sourceId: free.id, sourceVersion: free.version }), 409);
    let paid = await awaiting(app, cookie, await command(app, cookie, "order.create", { ...data, laborCents: 1250 }));
    paid = await command(app, cookie, "order.approve", versioned(paid, { budgetRevision: paid.budgetRevision, channel: "in_person" }));
    await command(app, cookie, "agreement.create", { ...terms, sourceId: paid.id, sourceVersion: paid.version });
    const list = await app.instance.inject({ method: "GET", url: base + "/operations/orders", headers: { cookie } });
    paid = list.json().items.find((item: any) => item.id === paid.id);
    assertError(await request(app, cookie, "order.update", versioned(paid, { laborCents: null, approved: false })), 409);
  });
});

test("OS-OP05 relatório soma definidos e conta pendentes além da página, exporta null distinto de zero", async () => {
  await scenario(async (app, cookie, data) => {
    const orders = [];
    for (const laborCents of [null, null, 0, 1250]) orders.push(await command(app, cookie, "order.create", { ...data, laborCents }));
    const query = `from=1900-01-01&to=9999-12-31&q=${encodeURIComponent(orders[0].customerName)}`;
    const before = (await fixture.a.migrationPool.query("SELECT count(*)::int n FROM audit_events")).rows[0].n;
    for (const suffix of ["?" + query + "&limit=1", "/export?" + query]) {
      const response = await app.instance.inject({ method: "GET", url: base + "/reports/orders" + suffix, headers: { cookie } });
      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(response.json().totals, { count: 4, laborCents: 1250, approvedCents: 0, unapprovedCents: 1250, unpricedCount: 2 });
      if (suffix.startsWith("/export")) { assert.equal(response.json().items.filter((item: any) => item.laborCents === null).length, 2); assert.ok(response.json().items.some((item: any) => item.laborCents === 0)); }
    }
    assert.equal((await fixture.a.migrationPool.query("SELECT count(*)::int n FROM audit_events")).rows[0].n, before);
    await fixture.a.migrationPool.query("UPDATE operational_records SET body=jsonb_set(body,'{approved}','true') WHERE id=$1", [orders[0].id]);
    assertError(await app.instance.inject({ method: "GET", url: base + "/reports/orders?" + query, headers: { cookie } }), 503);
  });
});
