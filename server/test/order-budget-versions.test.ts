import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { createFixture, login, createCustomer, authHeaders, assertError, TENANT_A, TENANT_B, type Fixture, type TestApp } from "./helpers.ts";

let fixture: Fixture;
before(async () => {
  fixture = await createFixture();
  await fixture.a.migrationPool.query("INSERT INTO tenant_admission(singleton,slot_id,tenant_id,claimed_at) VALUES(true,$1,$2,clock_timestamp())", [randomUUID(), TENANT_A]);
});
after(async () => { await fixture?.close(); });
const base = `/api/v1/tenants/${TENANT_A}`;
async function request(app: TestApp, cookie: string, type: string, data: unknown, requestId: string = randomUUID(), tenant = TENANT_A) {
  return app.instance.inject({ method: "POST", url: `/api/v1/tenants/${tenant}/operations/commands`, headers: authHeaders(cookie), payload: { requestId, type, data } });
}
async function command(app: TestApp, cookie: string, type: string, data: unknown, requestId?: string) {
  const response = await request(app, cookie, type, data, requestId);
  assert.equal(response.statusCode, 200, response.body); return response.json().entity;
}
const v = (order: any, extra = {}) => ({ id: order.id, version: order.version, ...extra });
const accept = (order: any, extra = {}) => v(order, { budgetRevision: order.budgetRevision ?? 0, channel: "in_person", ...extra });
async function scenario(run: (app: TestApp, cookie: string, order: any, userId: string) => Promise<void>) {
  const app = await fixture.app();
  try {
    const user = await fixture.user(), { cookie } = await login(app, user);
    const buyer = await createCustomer(app, cookie, TENANT_A);
    const tech = await command(app, cookie, "technician.create", { name: `Técnico QA ${randomUUID()}` });
    let order = await command(app, cookie, "order.create", { customerId: buyer.id, technicianId: tech.id, equipment: "Aparelho genérico QA", issue: "Examinar conector", laborCents: null });
    order = await command(app, cookie, "order.advance", v(order));
    order = await command(app, cookie, "order.advance", v(order));
    await run(app, cookie, order, user.id);
  } finally { await app.close(); }
}
async function stored(id: string) { return (await fixture.a.migrationPool.query("SELECT body,version FROM operational_records WHERE entity_type='order' AND id=$1", [id])).rows[0]; }

test("OS-OV01 entrada e revisões preservam null/zero, escopo e autoria sem versões por diagnóstico/no-op", async () => {
  await scenario(async (app, cookie, initial, userId) => {
    assert.equal(initial.budgetRevision, 1); assert.equal(initial.budgetScope, "Examinar conector");
    assert.equal(initial.budgetHistory.length, 1); assert.equal(initial.budgetHistory[0].laborCents, null);
    assert.equal(initial.budgetHistory[0].actorId, userId); assert.equal(initial.budgetHistory[0].source, "created");
    let order = await command(app, cookie, "order.update", v(initial, { diagnosis: "Conector danificado" }));
    assert.deepEqual(order.budgetHistory, initial.budgetHistory);
    const requestId = randomUUID(), data = v(order, { laborCents: 0, budgetScope: "Limpeza do conector" });
    order = await command(app, cookie, "order.update", data, requestId);
    assert.equal(order.budgetRevision, 2); assert.equal(order.budgetHistory.length, 2);
    assert.equal(order.budgetHistory[0].scope, "Examinar conector"); assert.equal(order.budgetHistory[0].laborCents, null);
    assert.equal(order.budgetHistory[1].scope, "Limpeza do conector"); assert.equal(order.budgetHistory[1].laborCents, 0);
    assert.deepEqual(await command(app, cookie, "order.update", data, requestId), order);
    const same = await command(app, cookie, "order.update", v(order, { laborCents: 0, budgetScope: " Limpeza do conector " }));
    assert.equal(same.version, order.version); assert.deepEqual(same.budgetHistory, order.budgetHistory);
    order = await command(app, cookie, "order.update", v(order, { laborCents: 1234 }));
    order = await command(app, cookie, "order.update", v(order, { laborCents: null }));
    assert.deepEqual(order.budgetHistory.map((x: any) => x.laborCents), [null, 0, 1234, null]);
    assert.equal((await stored(order.id)).body.budgetHistory[1].laborCents, 0);
  });
});

test("OS-OV02 autorização fixa cliente/revisão/canal/ator/hora do servidor sem efeitos de caixa ou estoque", async () => {
  await scenario(async (app, cookie, order, userId) => {
    order = await command(app, cookie, "order.update", v(order, { laborCents: 2500, budgetScope: "Trocar conector" }));
    const requestId = randomUUID(), data = accept(order, { channel: "whatsapp", reference: " Conversa do atendimento " });
    const approved = await command(app, cookie, "order.approve", data, requestId);
    assert.equal(approved.approved, true); assert.equal(approved.budgetRevision, 2);
    assert.deepEqual(approved.budgetApproval, { revision: 2, scope: "Trocar conector", laborCents: 2500, customerId: order.customerId, customerName: order.customerName, channel: "whatsapp", reference: "Conversa do atendimento", actorId: userId, actorName: "Pessoa de teste", at: approved.updatedAt });
    assert.deepEqual(approved.budgetHistory, order.budgetHistory);
    assert.deepEqual(await command(app, cookie, "order.approve", data, requestId), approved);
    assertError(await request(app, cookie, "order.approve", { ...data, channel: "phone" }, requestId), 409);
    const receipt = await app.instance.inject({ method: "GET", url: base + `/orders/${order.id}/receipt`, headers: { cookie } });
    assert.equal(receipt.statusCode, 200); assert.equal(receipt.json().order.budgetScope, "Trocar conector");
    assert.deepEqual(receipt.json().order.budgetApproval, approved.budgetApproval); assert.equal(receipt.json().order.budgetRevision, 2);
    for (const table of ["finance_agreements", "finance_payments", "finance_movements", "stock_movements"])
      assert.equal((await fixture.a.migrationPool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n, 0);
    const audit = (await fixture.a.migrationPool.query("SELECT after_values FROM audit_events WHERE entity_id=$1 AND entity_version=$2", [order.id, approved.version])).rows[0].after_values;
    assert.equal(audit.budgetRevision, 2); assert.equal(audit.approvalChannel, "whatsapp"); assert.ok(!JSON.stringify(audit).includes("Conversa do atendimento"));
  });
});

test("OS-OV03 null não aprova, zero aprova, campos/canais inválidos não gravam", async () => {
  await scenario(async (app, cookie, order) => {
    assertError(await request(app, cookie, "order.approve", accept(order)), 409);
    order = await command(app, cookie, "order.update", v(order, { laborCents: 0 }));
    for (const extra of [{ channel: "" }, { channel: "sms" }, { channel: null }, { budgetRevision: "2" }, { budgetRevision: -1 }, { reference: "x".repeat(501) }, { actorId: "forged" }, { customerId: randomUUID() }, { at: "2000-01-01" }, { approved: true }])
      assertError(await request(app, cookie, "order.approve", accept(order, extra)), 400);
    const missing = accept(order) as Record<string, unknown>; delete missing.channel;
    assertError(await request(app, cookie, "order.approve", missing), 400);
    assert.equal((await stored(order.id)).version, order.version);
    for (const budgetScope of ["", " ", "x".repeat(2001), 5, null]) assertError(await request(app, cookie, "order.update", v(order, { budgetScope })), 400);
    assert.equal((await command(app, cookie, "order.approve", accept(order))).approved, true);
  });
});

test("OS-OV04 revisão ou versão obsoleta conflita e concorrência confirma apenas uma autorização", async () => {
  await scenario(async (app, cookie, order) => {
    order = await command(app, cookie, "order.update", v(order, { laborCents: 1000 }));
    const before = order;
    order = await command(app, cookie, "order.update", v(order, { budgetScope: "Substituir conector" }));
    assertError(await request(app, cookie, "order.approve", accept(order, { budgetRevision: before.budgetRevision })), 409);
    assertError(await request(app, cookie, "order.approve", accept(before)), 409);
    const results = await Promise.all([request(app, cookie, "order.approve", accept(order)), request(app, cookie, "order.approve", accept(order, { channel: "phone" }))]);
    assert.deepEqual(results.map(x => x.statusCode).sort(), [200, 409]);
    assert.equal((await stored(order.id)).version, order.version + 1);
  });
});

test("OS-OV05 aceite não pode ser apagado por booleano, escopo/valor ficam imutáveis e estado operacional evolui", async () => {
  await scenario(async (app, cookie, order) => {
    order = await command(app, cookie, "order.update", v(order, { laborCents: 1000 }));
    assertError(await request(app, cookie, "order.update", v(order, { approved: true })), 409);
    order = await command(app, cookie, "order.approve", accept(order));
    const approval = order.budgetApproval, history = order.budgetHistory;
    for (const patch of [{ approved: false }, { laborCents: 2000 }, { laborCents: null }, { budgetScope: "Outro serviço" }])
      assertError(await request(app, cookie, "order.update", v(order, patch)), 409);
    assertError(await request(app, cookie, "order.approve", accept(order)), 409);
    order = await command(app, cookie, "order.update", v(order, { diagnosis: "Notas técnicas posteriores", due: "2100-01-02" }));
    order = await command(app, cookie, "order.advance", v(order)); assert.equal(order.stage, "in_progress");
    assert.deepEqual(order.budgetApproval, approval); assert.deepEqual(order.budgetHistory, history);
  });
});

test("OS-OV06 legado pendente registra somente fotografia observada e aprovado antigo não ganha evidência inventada", async () => {
  await scenario(async (app, cookie, order) => {
    await fixture.a.migrationPool.query("UPDATE operational_records SET body=body-'budgetRevision'-'budgetScope'-'budgetHistory' WHERE id=$1", [order.id]);
    order = { ...order }; delete order.budgetRevision; delete order.budgetScope; delete order.budgetHistory;
    order = await command(app, cookie, "order.update", v(order, { laborCents: 3000 }));
    assert.equal(order.budgetHistory[0].source, "legacy_snapshot"); assert.equal(order.budgetHistory[0].laborCents, null);
    assert.equal(order.budgetHistory[1].laborCents, 3000); assert.equal(order.budgetRevision, 2);
    await fixture.a.migrationPool.query("UPDATE operational_records SET body=(body-'budgetRevision'-'budgetScope'-'budgetHistory')||'{\"approved\":true}'::jsonb WHERE id=$1", [order.id]);
    const edited = await command(app, cookie, "order.update", v(order, { diagnosis: "Anotação de legado", budgetScope: order.issue }));
    assert.equal(edited.approved, true); assert.equal(edited.budgetApproval, undefined); assert.equal(edited.budgetHistory, undefined);
    assert.equal(edited.budgetScope, undefined);
    assertError(await request(app, cookie, "order.update", v(edited, { approved: false })), 409);
    assertError(await request(app, cookie, "order.update", v(edited, { budgetScope: "Substituir histórico" })), 409);
  });
});

test("OS-OV07 legado pendente pode ser aprovado em uma confirmação sem redigitar escopo", async () => {
  await scenario(async (app, cookie, order) => {
    await fixture.a.migrationPool.query("UPDATE operational_records SET body=(body-'budgetRevision'-'budgetScope'-'budgetHistory')||'{\"laborCents\":0}'::jsonb WHERE id=$1", [order.id]);
    const approved = await command(app, cookie, "order.approve", accept({ ...order, budgetRevision: 0 }, { channel: "email" }));
    assert.equal(approved.budgetHistory.length, 1); assert.equal(approved.budgetHistory[0].source, "legacy_snapshot");
    assert.equal(approved.budgetApproval.revision, 1); assert.equal(approved.budgetScope, order.issue);
  });
});

test("OS-OV08 limite não apaga versões e campos internos de histórico não são aceitos", async () => {
  await scenario(async (app, cookie, order) => {
    assertError(await request(app, cookie, "order.update", v(order, { budgetHistory: [] })), 400);
    assertError(await request(app, cookie, "order.update", v(order, { budgetRevision: 55 })), 400);
    order = await command(app, cookie, "order.update", v(order, { laborCents: 0 }));
    const history = Array.from({ length: 100 }, (_, i) => ({ ...order.budgetHistory.at(-1), revision: i + 1 }));
    await fixture.a.migrationPool.query("UPDATE operational_records SET body=body||$2::jsonb WHERE id=$1", [order.id, JSON.stringify({ budgetRevision: 100, budgetHistory: history })]);
    const exhausted = { ...order, budgetRevision: 100 };
    assertError(await request(app, cookie, "order.update", v(exhausted, { laborCents: 1000 })), 409);
    assert.equal((await stored(order.id)).body.budgetHistory.length, 100);
    assert.equal((await command(app, cookie, "order.approve", accept(exhausted))).budgetApproval.revision, 100);
  });
});

test("OS-OV10 orçamento legado inconsistente não vira autorização com valor inválido", async () => {
  await scenario(async (app, cookie, order) => {
    for (const laborCents of ["1000", -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      await fixture.a.migrationPool.query("UPDATE operational_records SET body=(body-'budgetRevision'-'budgetScope'-'budgetHistory')||$2::jsonb WHERE id=$1", [order.id, JSON.stringify({ laborCents, approved: false })]);
      assertError(await request(app, cookie, "order.approve", accept({ ...order, budgetRevision: 0 })), 503);
      const saved = await stored(order.id); assert.equal(saved.body.approved, false); assert.equal(saved.version, order.version);
    }
  });
});

test("OS-OV09 direito atual vale no replay e outra empresa não pode aprovar a OS", async () => {
  await scenario(async (app, cookie, order, userId) => {
    order = await command(app, cookie, "order.update", v(order, { laborCents: 1000 }));
    const requestId = randomUUID(), data = accept(order);
    await command(app, cookie, "order.approve", data, requestId);
    assertError(await request(app, cookie, "order.approve", data, randomUUID(), TENANT_B), 403);
    await fixture.control.migrationPool.query("UPDATE memberships SET active=false WHERE user_id=$1 AND tenant_id=$2", [userId, TENANT_A]);
    assertError(await request(app, cookie, "order.approve", data, requestId), 403);
  });
});
