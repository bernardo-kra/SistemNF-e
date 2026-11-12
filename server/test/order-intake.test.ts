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
const base = (tenant = TENANT_A) => `/api/v1/tenants/${tenant}`;
async function request(app: TestApp, cookie: string, type: string, data: unknown, requestId: string = randomUUID(), tenant = TENANT_A) {
  return app.instance.inject({ method: "POST", url: base(tenant) + "/operations/commands", headers: authHeaders(cookie), payload: { requestId, type, data } });
}
async function command(app: TestApp, cookie: string, type: string, data: unknown, requestId?: string) {
  const response = await request(app, cookie, type, data, requestId);
  assert.equal(response.statusCode, 200, response.body); return response.json().entity;
}
async function scenario(run: (app: TestApp, cookie: string, data: Record<string, unknown>, tech: any) => Promise<void>) {
  const app = await fixture.app();
  try {
    const { cookie } = await login(app, await fixture.user());
    const customer = await createCustomer(app, cookie, TENANT_A, { name: `Cliente entrada QA ${randomUUID()}` });
    const tech = await command(app, cookie, "technician.create", { name: `Técnico entrada QA ${randomUUID()}` });
    await run(app, cookie, { customerId: customer.id, equipment: "Aparelho QA", issue: "Não liga QA" }, tech);
  } finally { await app.close(); }
}
const versioned = (order: any, extra: Record<string, unknown> = {}) => ({ id: order.id, version: order.version, ...extra });
async function saved(id: string) { return (await fixture.a.migrationPool.query("SELECT body,version FROM operational_records WHERE id=$1", [id])).rows[0]; }

test("OS-EN01 entrada mínima/null não inventa técnico, data ou preço e recupera a mesma criação", async () => {
  await scenario(async (app, cookie, data, tech) => {
    for (const extra of [{}, { technicianId: null, due: null }]) {
      const id = randomUUID(), input = { ...data, ...extra };
      const order = await command(app, cookie, "order.create", input, id);
      for (const field of ["technicianId", "technicianName", "due", "laborCents"]) assert.equal(order[field], null);
      assert.equal(order.stage, "received"); assert.equal(order.approved, false);
      assert.deepEqual(await command(app, cookie, "order.create", input, id), order);
      assert.deepEqual((await saved(order.id)).body.technicianId, null);
    }
    const known = await command(app, cookie, "order.create", { ...data, technicianId: tech.id, due: "2100-02-01", laborCents: 0 });
    assert.equal(known.technicianName, tech.name); assert.equal(known.due, "2100-02-01"); assert.equal(known.laborCents, 0);
    const same = await command(app, cookie, "order.update", versioned(known, { diagnosis: "Inspeção QA" }));
    assert.equal(same.technicianId, tech.id); assert.equal(same.due, known.due); assert.equal(same.laborCents, 0);
  });
});

test("OS-EN02 edição mantém omitidos e limpa atribuição só antes de iniciar; prazo não é vencimento", async () => {
  await scenario(async (app, cookie, data, tech) => {
    let order = await command(app, cookie, "order.create", { ...data, technicianId: tech.id, due: "2100-02-01", laborCents: 0 });
    order = await command(app, cookie, "order.update", versioned(order, { technicianId: null, due: null }));
    assert.equal(order.technicianName, null); assert.equal(order.technicianId, null); assert.equal(order.due, null);
    order = await command(app, cookie, "order.update", versioned(order, { technicianId: tech.id }));
    order = await command(app, cookie, "order.advance", versioned(order));
    assert.equal(order.stage, "diagnosing"); assert.equal(order.due, null);
    assertError(await request(app, cookie, "order.update", versioned(order, { technicianId: null })), 409);
    order = await command(app, cookie, "order.update", versioned(order, { due: "2100-03-01" }));
    order = await command(app, cookie, "order.update", versioned(order, { due: null })); assert.equal(order.due, null);
    order = await command(app, cookie, "order.advance", versioned(order));
    order = await command(app, cookie, "order.approve", versioned(order, { budgetRevision: order.budgetRevision, channel: "in_person" }));
    order = await command(app, cookie, "order.advance", versioned(order)); assert.equal(order.stage, "in_progress"); assert.equal(order.due, null);
    assertError(await request(app, cookie, "order.update", versioned(order, { technicianId: null })), 409);
  });
});

test("OS-EN03 atribuir e iniciar é um comando/versão/auditoria, com replay/conflito sem avançar outra vez", async () => {
  await scenario(async (app, cookie, data, tech) => {
    const order = await command(app, cookie, "order.create", data);
    assertError(await request(app, cookie, "order.advance", versioned(order)), 409);
    const id = randomUUID(), input = versioned(order, { technicianId: tech.id });
    const next = await command(app, cookie, "order.advance", input, id);
    assert.equal(next.stage, "diagnosing"); assert.equal(next.technicianId, tech.id); assert.equal(next.technicianName, tech.name);
    assert.equal(next.due, null); assert.equal(next.version, order.version + 1);
    assert.deepEqual(await command(app, cookie, "order.advance", input, id), next);
    assertError(await request(app, cookie, "order.advance", { ...input, technicianId: randomUUID() }, id), 409);
    assertError(await request(app, cookie, "order.advance", input), 409);
    assertError(await request(app, cookie, "order.advance", versioned(next, { technicianId: tech.id })), 409);
    const audits = (await fixture.a.migrationPool.query("SELECT * FROM audit_events WHERE entity_id=$1 ORDER BY entity_version", [order.id])).rows;
    assert.equal(audits.length, 2); assert.equal(audits[1].action, "order.advance");
    assert.equal(audits[1].before_values.technicianId, null); assert.equal(audits[1].after_values.technicianId, tech.id);
  });
});

test("OS-EN04 atribuição conjunta exige os dois direitos, vínculo e direitos atuais inclusive no replay", async () => {
  await scenario(async (app, cookie, data, tech) => {
    const order = await command(app, cookie, "order.create", data), input = versioned(order, { technicianId: tech.id });
    const actor = await fixture.user("operator"), { cookie: operator } = await login(app, actor);
    for (const rights of [{ "orders.advance": true, "orders.update": false }, { "orders.advance": false, "orders.update": true }]) {
      await fixture.control.migrationPool.query("UPDATE memberships SET permission_overrides=$1 WHERE user_id=$2", [JSON.stringify({ "orders.read": true, ...rights }), actor.id]);
      assertError(await request(app, operator, "order.advance", input), 403);
    }
    assertError(await request(app, "", "order.advance", input), 401);
    assertError(await request(app, cookie, "order.advance", input, randomUUID(), TENANT_B), 403);
    await fixture.control.migrationPool.query("UPDATE memberships SET permission_overrides=$1 WHERE user_id=$2", [JSON.stringify({ "orders.read": true, "orders.advance": true, "orders.update": true }), actor.id]);
    const id = randomUUID(); await command(app, operator, "order.advance", input, id);
    await fixture.control.migrationPool.query("UPDATE memberships SET permission_overrides=$1 WHERE user_id=$2", [JSON.stringify({ "orders.read": true, "orders.advance": true, "orders.update": false }), actor.id]);
    assertError(await request(app, operator, "order.advance", input, id), 403);
  });
});

test("OS-EN05 falha atômica e concorrência não deixam técnico ou início parcial/duplicado", async () => {
  await scenario(async (app, cookie, data, tech) => {
    const order = await command(app, cookie, "order.create", data), input = versioned(order, { technicianId: tech.id }), id = randomUUID(), role = fixture.a.runtimeUser;
    await fixture.a.migrationPool.query(`REVOKE INSERT ON audit_events FROM "${role}"`);
    try { assertError(await request(app, cookie, "order.advance", input, id), 503); }
    finally { await fixture.a.migrationPool.query(`GRANT INSERT ON audit_events TO "${role}"`); }
    assert.equal((await saved(order.id)).body.technicianId, null); assert.equal((await saved(order.id)).body.stage, "received");
    assert.equal((await saved(order.id)).version, order.version);
    assert.equal((await fixture.a.migrationPool.query("SELECT count(*)::int n FROM operational_requests WHERE id=$1", [id])).rows[0].n, 0);
    await command(app, cookie, "order.advance", input, id);
    const second = await command(app, cookie, "order.create", data), concurrent = versioned(second, { technicianId: tech.id });
    const results = await Promise.all([request(app, cookie, "order.advance", concurrent), request(app, cookie, "order.advance", concurrent)]);
    assert.deepEqual(results.map(result => result.statusCode).sort(), [200, 409]);
    assert.equal((await saved(second.id)).version, second.version + 1);
  });
});

test("OS-EN06 devolução, recibo e relatório mantêm pendências explícitas e recusam nome incoerente", async () => {
  await scenario(async (app, cookie, data, tech) => {
    const order = await command(app, cookie, "order.create", data);
    const receipt = await app.instance.inject({ method: "GET", url: base() + `/orders/${order.id}/receipt`, headers: { cookie } });
    assert.equal(receipt.statusCode, 200); assert.equal(receipt.json().order.technicianName, null); assert.equal(receipt.json().order.due, null);
    const returned = await command(app, cookie, "order.return_without_repair", versioned(order, { reason: "customer_withdrew", recipient: { type: "customer" }, confirmed: true }));
    assert.equal(returned.stage, "closed_without_repair"); assert.equal(returned.technicianId, null); assert.equal(returned.due, null);
    const query = `from=1900-01-01&to=9999-12-31&q=${encodeURIComponent(order.customerName)}`;
    for (const suffix of ["?" + query, "/export?" + query]) {
      const response = await app.instance.inject({ method: "GET", url: base() + "/reports/orders" + suffix, headers: { cookie } });
      assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().items[0].technicianName, null);
      assert.deepEqual(response.json().totals, { count: 1, laborCents: 0, approvedCents: 0, unapprovedCents: 0, unpricedCount: 1 });
    }
    const body = (await saved(order.id)).body;
    for (const broken of [{ ...body, technicianId: tech.id }, { ...body, technicianName: undefined }, { ...body, technicianName: false }, { ...body, stage: "diagnosing" }]) {
      await fixture.a.migrationPool.query("UPDATE operational_records SET body=$1 WHERE id=$2", [JSON.stringify(broken), order.id]);
      assertError(await app.instance.inject({ method: "GET", url: base() + "/reports/orders?" + query, headers: { cookie } }), 503);
    }
  });
});

test("OS-EN07 opcionais não dispensam campos mínimos nem aceitam técnico ou data inválidos", async () => {
  await scenario(async (app, cookie, data, tech) => {
    for (const extra of [{ customerId: null }, { equipment: "" }, { issue: "" }, { technicianId: "" }, { due: "" }, { due: "2100-02-30" }, { due: 0 }])
      assertError(await request(app, cookie, "order.create", { ...data, ...extra }), 400);
    assertError(await request(app, cookie, "order.create", { ...data, technicianId: randomUUID() }), 404);
    const known = await command(app, cookie, "order.create", { ...data, technicianId: tech.id, due: "2100-01-01" });
    for (const extra of [{ technicianId: "" }, { due: "" }, { due: "2100-02-30" }]) assertError(await request(app, cookie, "order.update", versioned(known, extra)), 400);
  });
});
