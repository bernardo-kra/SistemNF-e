import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import { createFixture, login, authHeaders, createCustomer, TENANT_A, TENANT_B, assertError, type Fixture, type TestApp } from "./helpers.ts";

let fixture: Fixture;
before(async () => { fixture = await createFixture(); });
after(async () => { await fixture?.close(); });
const base = (id = TENANT_A) => `/api/v1/tenants/${id}/operations`;
const opRights = ["products.read", "products.create", "products.update", "products.archive", "products.cost.read", "stock.read", "stock.receive", "sales.read", "sales.create", "sales.deliver", "orders.read", "orders.create", "orders.update", "orders.advance", "orders.deliver", "purchases.read", "purchases.import", "purchases.receive", "audit.read"];
async function scenario(run: (app: TestApp, cookie: string, actor: { id: string }) => Promise<void>) {
  const app = await fixture.app();
  try { const actor = await fixture.user(); const { cookie } = await login(app, actor); await run(app, cookie, actor); }
  finally { await app.close(); }
}
async function request(app: TestApp, cookie: string, type: string, data: unknown, requestId: string = randomUUID(), tenant = TENANT_A): Promise<any> {
  return app.instance.inject({ method: "POST", url: `${base(tenant)}/commands`, headers: authHeaders(cookie), payload: { requestId, type, data } });
}
async function command(app: TestApp, cookie: string, type: string, data: unknown, id?: string): Promise<any> {
  const result: any = await request(app, cookie, type, data, id);
  assert.equal(result.statusCode, 200, result.body); assert.equal(result.json().tenantId, TENANT_A);
  return result.json().entity;
}
async function product(app: TestApp, cookie: string, patch: Record<string, unknown> = {}): Promise<any> {
  return command(app, cookie, "product.create", { sku: `SKU-${randomUUID()}`, name: "Capa MagSafe iPhone 16", category: "Capas", unit: "UN", costCents: 1000, salePriceCents: 2500, ...patch });
}
async function list(app: TestApp, cookie: string, resource: string, query = ""): Promise<any> {
  const response: any = await app.instance.inject({ method: "GET", url: `${base()}/${resource}${query}`, headers: { cookie } });
  assert.equal(response.statusCode, 200, response.body); return response.json();
}
async function history(app: TestApp, cookie: string, entityType: string, id: string): Promise<any[]> {
  return (await list(app, cookie, "history", `?entityType=${entityType}&id=${id}`)).items;
}
// Each scenario owns its supplier aliases; an existing supplier/code cannot be reassigned silently.
const document = (patch: Record<string, unknown> = {}): any => ({ key: `DOC-${randomUUID()}`, supplierId: `local-name:${randomUUID()}`, supplierName: "Fornecedor fictício", number: "1", items: [{ id: "1", code: "ABC", description: "CAPA ACRILICA FOSCA COM MAGSAFE IPHONE 16", unit: "UN", quantity: 2, costCents: 1000, ncm: "39269090" }], ...patch });

test("OP01 autenticação, isolamento e cadastro operacional vazio sem exemplos", async () => {
  await scenario(async (app, cookie) => {
    assertError(await app.instance.inject({ method: "GET", url: `${base()}/products` }), 401);
    assertError(await app.instance.inject({ method: "GET", url: `${base(TENANT_B)}/products`, headers: { cookie } }), 403);
    const unlinked = await fixture.user("viewer"); const session = await login(app, unlinked);
    assertError(await app.instance.inject({ method: "GET", url: `${base()}/products`, headers: { cookie: session.cookie } }), 403);
    const other: any = await app.instance.inject({ method: "GET", url: `${base(TENANT_B)}/products`, headers: { cookie } });
    assert.equal(other.statusCode, 403);
  });
});

test("OP02 cadastro, autoria UTC, saldo zero e nenhuma escrita em no-op", async () => {
  await scenario(async (app, cookie, actor) => {
    const value = await product(app, cookie);
    assert.equal(value.version, 1); assert.equal(value.stock.physical, 0); assert.equal(value.stock.reserved, 0);
    assert.match(value.createdAt, /Z$/); assert.equal(value.updatedBy, actor.id);
    const before = await history(app, cookie, "product", value.id);
    const same = await command(app, cookie, "product.update", { id: value.id, version: 1, name: value.name });
    assert.equal(same.updatedAt, value.updatedAt); assert.equal(same.version, 1);
    assert.deepEqual(await history(app, cookie, "product", value.id), before);
    assert.equal(before[0].actorId, actor.id); assert.equal(typeof before[0].actorName, "string");
    assertError(await request(app, cookie, "product.update", { id: value.id, version: 1, stock: 90, actorId: "forged" }), 400);
  });
});

test("OP03 catálogo e saldo têm versões distintas; tentativa estável e dados conflitantes409", async () => {
  await scenario(async (app, cookie) => {
    const value = await product(app, cookie), id = randomUUID();
    const body = { productId: value.id, quantity: 3, reference: "Entrada conferida" };
    await command(app, cookie, "stock.receive", body, id); await command(app, cookie, "stock.receive", body, id);
    assertError(await request(app, cookie, "stock.receive", { ...body, quantity: 4 }, id), 409);
    const changed = await command(app, cookie, "product.update", { id: value.id, version: 1, name: "Nome melhor" });
    assert.equal(changed.version, 2); assert.equal(changed.stock.physical, 3);
    assert.equal((await history(app, cookie, "stock", value.id)).length, 1);
    assertError(await request(app, cookie, "product.update", { id: value.id, version: 1, name: "Obsoleto" }), 409);
  });
});

test("OP04 duas vendas concorrentes da última unidade não geram reserva negativa", async () => {
  await scenario(async (app, cookie) => {
    const value = await product(app, cookie), customer = await createCustomer(app, cookie);
    await command(app, cookie, "stock.receive", { productId: value.id, quantity: 1, reference: "Saldo único" });
    const body = { customerId: customer.id, items: [{ productId: value.id, quantity: 1, version: 1 }] };
    const results = await Promise.all([request(app, cookie, "sale.confirm", body), request(app, cookie, "sale.confirm", body)]);
    assert.deepEqual(results.map((result) => result.statusCode).sort(), [200, 409]);
    const stock = (await list(app, cookie, "stock", `?q=${value.sku}`)).items[0];
    assert.equal(stock.physical, 1); assert.equal(stock.reserved, 1); assert.equal(stock.available, 0);
  });
});

test("OP05 uma confirmação reserva o conjunto, agrega repetidos e entrega baixa uma vez", async () => {
  await scenario(async (app, cookie) => {
    const one = await product(app, cookie), two = await product(app, cookie), customer = await createCustomer(app, cookie);
    for (const value of [one, two]) await command(app, cookie, "stock.receive", { productId: value.id, quantity: 5, reference: "Contagem" });
    const id = randomUUID();
    const sale = await command(app, cookie, "sale.confirm", { customerId: customer.id, items: [{ productId: one.id, quantity: 1, version: 1 }, { productId: one.id, quantity: 2, version: 1 }, { productId: two.id, quantity: 1, version: 1 }] }, id);
    assert.equal(sale.items.length, 2); assert.equal(sale.totalCents, 10000); assert.equal(sale.status, "confirmed");
    const delivery = randomUUID();
    await command(app, cookie, "sale.deliver", { id: sale.id, version: 1 }, delivery);
    await command(app, cookie, "sale.deliver", { id: sale.id, version: 1 }, delivery);
    const stock = (await list(app, cookie, "stock", `?q=${one.sku}`)).items[0];
    assert.equal(stock.physical, 2); assert.equal(stock.reserved, 0);
    assert.equal((await history(app, cookie, "sale", sale.id)).length, 2);
    await command(app, cookie, "product.update", { id: one.id, version: 1, salePriceCents: 9000 });
    const saved = (await list(app, cookie, "sales", `?q=${sale.number}`)).items[0];
    assert.equal(saved.items[0].unitPriceCents, 2500);
  });
});

test("OP06 qualquer item inválido recusa venda inteira e não modifica outros saldos", async () => {
  await scenario(async (app, cookie) => {
    const good = await product(app, cookie), pending = await product(app, cookie, { salePriceCents: null }), serial = await product(app, cookie, { serialized: true }), customer = await createCustomer(app, cookie);
    for (const value of [good, pending]) await command(app, cookie, "stock.receive", { productId: value.id, quantity: 3, reference: "Entrada" });
    for (const bad of [pending, serial, { id: randomUUID(), version: 1 }]) {
      const result = await request(app, cookie, "sale.confirm", { customerId: customer.id, items: [{ productId: good.id, quantity: 1, version: 1 }, { productId: bad.id, quantity: 1, version: 1 }] });
      assert.ok([404, 409].includes(result.statusCode));
      assert.equal((await list(app, cookie, "stock", `?q=${good.sku}`)).items[0].reserved, 0);
    }
    assertError(await request(app, cookie, "stock.receive", { productId: serial.id, quantity: 1, reference: "Sem série" }), 409);
    assertError(await request(app, cookie, "sale.confirm", { customerId: randomUUID(), items: [{ productId: good.id, quantity: 1, version: 1 }] }), 404);
  });
});

test("OP07 auditoria recusada desfaz catálogo, saldo e reserva sem marcar tentativa como concluída", async () => {
  await scenario(async (app, cookie) => {
    const value = await product(app, cookie), id = randomUUID(), role = new URL(fixture.config.tenantDatabaseUrls.a).username;
    await fixture.a.migrationPool.query(`REVOKE INSERT ON audit_events FROM "${role}"`);
    try { assertError(await request(app, cookie, "stock.receive", { productId: value.id, quantity: 2, reference: "Recuperável" }, id), 503); }
    finally { await fixture.a.migrationPool.query(`GRANT INSERT ON audit_events TO "${role}"`); }
    assert.equal((await list(app, cookie, "stock", `?q=${value.sku}`)).items[0].physical, 0);
    await command(app, cookie, "stock.receive", { productId: value.id, quantity: 2, reference: "Recuperável" }, id);
    assert.equal((await list(app, cookie, "stock", `?q=${value.sku}`)).items[0].physical, 2);
  });
});

test("OP08 custo é direito próprio: ausente de catálogo, histórico, comandos e compras negadas", async () => {
  await scenario(async (app, cookie) => {
    const value = await product(app, cookie);
    const user = await fixture.user("viewer");
    await fixture.control.migrationPool.query("UPDATE memberships SET permission_overrides=$1 WHERE user_id=$2 AND tenant_id=$3", [JSON.stringify({ "products.read": true, "audit.read": true }), user.id, TENANT_A]);
    const session = await login(app, user);
    const items = (await list(app, session.cookie, "products", `?q=${value.sku}`)).items;
    assert.equal(items.length, 1); assert.equal(Object.hasOwn(items[0], "costCents"), false);
    assert.ok(!JSON.stringify(await history(app, session.cookie, "product", value.id)).includes("costCents"));
    assertError(await app.instance.inject({ method: "GET", url: `${base()}/purchases`, headers: { cookie: session.cookie } }), 403);
    assertError(await request(app, session.cookie, "product.update", { id: value.id, version: 1, costCents: 123 }), 403);
    await fixture.control.migrationPool.query("UPDATE memberships SET active=false WHERE user_id=$1 AND tenant_id=$2", [user.id, TENANT_A]);
    assertError(await app.instance.inject({ method: "GET", url: `${base()}/products`, headers: { cookie: session.cookie } }), 403);
  });
});

test("OP09 OS exige aprovação e testes; técnico não é autor e entrega não infere pagamento", async () => {
  await scenario(async (app, cookie, actor) => {
    const customer = await createCustomer(app, cookie), technician = await command(app, cookie, "technician.create", { name: "Técnico operacional" });
    let order = await command(app, cookie, "order.create", { customerId: customer.id, technicianId: technician.id, equipment: "iPhone 16", issue: "Troca de tela", due: "2026-11-01", laborCents: 20000 });
    assert.equal(order.stage, "received"); assert.equal(order.financeStatus, "not_integrated");
    for (let i = 0; i < 2; i++) order = await command(app, cookie, "order.advance", { id: order.id, version: order.version });
    assertError(await request(app, cookie, "order.advance", { id: order.id, version: order.version }), 409);
    order = await command(app, cookie, "order.update", { id: order.id, version: order.version, approved: true });
    order = await command(app, cookie, "order.advance", { id: order.id, version: order.version });
    order = await command(app, cookie, "order.advance", { id: order.id, version: order.version });
    assertError(await request(app, cookie, "order.advance", { id: order.id, version: order.version }), 409);
    order = await command(app, cookie, "order.update", { id: order.id, version: order.version, tested: true });
    order = await command(app, cookie, "order.advance", { id: order.id, version: order.version });
    assertError(await request(app, cookie, "order.deliver", { id: order.id, version: order.version }), 409);
    order = await command(app, cookie, "order.deliver", { id: order.id, version: order.version, allowUnsettled: true });
    assert.equal(order.stage, "delivered"); assert.equal(order.financeStatus, "not_integrated");
    assert.ok((await history(app, cookie, "order", order.id)).every((event) => event.actorId === actor.id));
    assert.notEqual(technician.id, actor.id);
  });
});

test("OP10 novos cadastros de compra em lote podem ficar sem preço, sem entrada ou pagamento", async () => {
  await scenario(async (app, cookie) => {
    const doc = document({ items: [{ ...document().items[0], description: "CAPA ACRILICA FOSCA COM MAGSAFE IPHONE 17" }] });
    const purchase = await command(app, cookie, "purchase.confirm", { document: doc, decisions: {}, receive: false });
    assert.equal(purchase.status, "pending"); assert.equal(purchase.financeStatus, "not_integrated");
    const value = (await list(app, cookie, "products", "?q=iPhone%2017")).items.find((item: any) => item.id === purchase.lines[0].productId);
    assert.equal(value.salePriceCents, null); assert.equal(value.stock.physical, 0);
  });
});

test("OP11 fornecedor diferente vincula mesmo produto; descrição incompatível exige decisão", async () => {
  await scenario(async (app, cookie) => {
    const value = await product(app, cookie), doc = document();
    await command(app, cookie, "purchase.confirm", { document: doc, decisions: { "1": { action: "link", productId: value.id } }, receive: true });
    const other = document({ supplierId: "22222222000122" });
    await command(app, cookie, "purchase.confirm", { document: other, decisions: { "1": { action: "link", productId: value.id } }, receive: true });
    const changed = document({ supplierId: doc.supplierId, items: [{ ...doc.items[0], description: "CAPA MAGSAFE IPHONE 15 PRO" }] });
    assertError(await request(app, cookie, "purchase.confirm", { document: changed, decisions: {}, receive: true }), 409);
    assert.equal((await list(app, cookie, "stock", `?q=${value.sku}`)).items[0].physical, 4);
  });
});

test("OP12 parcial, limite acumulado, repetição e conteúdo alterado da nota não duplicam estoque", async () => {
  await scenario(async (app, cookie) => {
    const value = await product(app, cookie), doc = document({ items: [{ ...document().items[0], quantity: 5 }] }), id = randomUUID();
    const data = { document: doc, decisions: { "1": { action: "link", productId: value.id, receivedQuantity: 2 } }, receive: true };
    const purchase = await command(app, cookie, "purchase.confirm", data, id);
    assert.equal(purchase.status, "partial"); await command(app, cookie, "purchase.confirm", data, id);
    const completed = await command(app, cookie, "purchase.confirm", { document: doc, decisions: { "1": { action: "link", productId: value.id, receivedQuantity: 3 } }, receive: true });
    assert.equal(completed.status, "received");
    assertError(await request(app, cookie, "purchase.confirm", data), 409);
    assertError(await request(app, cookie, "purchase.confirm", { ...data, document: { ...doc, number: "forged" } }), 409);
    assert.equal((await list(app, cookie, "stock", `?q=${value.sku}`)).items[0].physical, 5);
  });
});

test("OP13 lote de500 vínculos conhecidos recebe numa operação sem alterar catálogo nem confiar em total", async () => {
  await scenario(async (app, cookie) => {
    const value = await product(app, cookie);
    const doc = document({ items: Array.from({ length: 500 }, (_, index) => ({ ...document().items[0], id: String(index), code: `C${index}`, quantity: 1 })) });
    const decisions = Object.fromEntries(doc.items.map((line: any) => [line.id, { action: "link", productId: value.id }]));
    await command(app, cookie, "purchase.confirm", { document: doc, decisions, receive: false });
    const next = { ...doc, key: `NEXT-${randomUUID()}`, number: "2" };
    const plan: any = await app.instance.inject({ method: "POST", url: `${base()}/purchase-plan`, headers: authHeaders(cookie), payload: { document: next } });
    assert.equal(plan.statusCode, 200, plan.body); assert.equal(plan.json().plan.lines.filter((line: any) => line.resolution === "known").length, 500);
    const purchased = await command(app, cookie, "purchase.confirm", { document: next, decisions: {}, receive: true });
    assert.equal(purchased.lines.length, 500); assert.equal(purchased.status, "received");
    assert.equal((await list(app, cookie, "stock", `?q=${value.sku}`)).items[0].physical, 500);
    assertError(await request(app, cookie, "purchase.confirm", { document: { ...next, key: `BAD-${randomUUID()}`, totalCents: 1 }, decisions: {}, receive: true }), 400);
  });
});

test("OP14 busca literal, status e período São Paulo são combináveis e estáveis", async () => {
  await scenario(async (app, cookie) => {
    const value = await product(app, cookie, { name: "Nome %_ literal exclusivo" });
    const found = await list(app, cookie, "products", "?q=%25_&sort=created&limit=1");
    assert.equal(found.items[0].id, value.id); assert.equal(found.total, 1);
    assert.equal((await list(app, cookie, "products", "?q=%27%20OR%201%3D1")).total, 0);
    await command(app, cookie, "product.update", { id: value.id, version: 1, active: false });
    assert.equal((await list(app, cookie, "products", "?q=exclusivo&status=inactive")).total, 1);
    assert.equal((await list(app, cookie, "products", "?q=exclusivo&from=2000-01-01&to=2000-01-02")).total, 0);
    assertError(await app.instance.inject({ method: "GET", url: `${base()}/products?from=2026-02-30`, headers: { cookie } }), 400);
  });
});

test("OP15 entradas extras, custo/quantidade inválidos e origem indevida não gravam", async () => {
  await scenario(async (app, cookie) => {
    for (const patch of [{ costCents: -1 }, { salePriceCents: 1.1 }, { stock: 100 }, { createdAt: "2000-01-01" }]) {
      assertError(await request(app, cookie, "product.create", { sku: randomUUID(), name: "Produto", ...patch }), 400);
    }
    assertError(await app.instance.inject({ method: "POST", url: `${base()}/commands`, headers: { cookie }, payload: { requestId: randomUUID(), type: "product.create", data: {} } }), 403);
    const value = await product(app, cookie);
    for (const quantity of [0, -1, 1.5, Number.MAX_SAFE_INTEGER]) assertError(await request(app, cookie, "stock.receive", { productId: value.id, quantity, reference: "Inválida" }), 400);
  });
});

test("OP16 banco indisponível não usa demonstração; novos direitos estão no catálogo próprio", async () => {
  await scenario(async (app, cookie) => {
    const options: any = await app.instance.inject({ method: "GET", url: `/api/v1/tenants/${TENANT_A}/access-options`, headers: { cookie } });
    // FIN-LIVE e DSC ampliam explicitamente o catálogo; preservar comparação exata e direitos anteriores.
    assert.deepEqual(options.json().operationalPermissions.map((item: any) => item.id).sort(),
      [...opRights, "sales.discount", "finance.read", "finance.agreements.create", "finance.receive", "finance.accounts.manage", "finance.cash.manage"].sort());
    const broken = await fixture.app({ tenantDatabaseUrls: { a: "postgresql://invalid:invalid@127.0.0.1:1/unavailable", b: fixture.config.tenantDatabaseUrls.b } });
    try { assertError(await broken.instance.inject({ method: "GET", url: `${base()}/products`, headers: { cookie } }), 503); }
    finally { await broken.close(); }
  });
});

test("OP17 preços em lote validam versões de todo o conjunto antes de alterar qualquer preço", async () => {
  await scenario(async (app, cookie) => {
    const first = await product(app, cookie), second = await product(app, cookie);
    assertError(await request(app, cookie, "product.prices", { items: [{ id: first.id, version: 1, salePriceCents: 3000 }, { id: second.id, version: 99, salePriceCents: 4000 }] }), 409);
    assert.equal((await list(app, cookie, "products", `?q=${first.sku}`)).items[0].salePriceCents, 2500);
    await command(app, cookie, "product.prices", { items: [{ id: first.id, version: 1, salePriceCents: 3000 }, { id: second.id, version: 1, salePriceCents: 4000 }] });
    assert.equal((await list(app, cookie, "products", `?q=${second.sku}`)).items[0].salePriceCents, 4000);
  });
});

test("OP18 parcial de várias linhas pula as já completas e recebe somente as restantes", async () => {
  await scenario(async (app, cookie) => {
    const first = await product(app, cookie), second = await product(app, cookie);
    const doc = document({ items: [{ ...document().items[0], id: "1", code: "ONE", quantity: 5 }, { ...document().items[0], id: "2", code: "TWO", quantity: 5 }] });
    await command(app, cookie, "purchase.confirm", { document: doc, decisions: { "1": { action: "link", productId: first.id }, "2": { action: "link", productId: second.id, receivedQuantity: 2 } }, receive: true });
    const result = await command(app, cookie, "purchase.confirm", { document: doc, decisions: {}, receive: true });
    assert.equal(result.status, "received");
    for (const product of [first, second]) assert.equal((await list(app, cookie, "stock", `?q=${product.sku}`)).items[0].physical, 5);
  });
});

test("OP19 compra serializada, sortida ou com conversão ausente não inventa unidades", async () => {
  await scenario(async (app, cookie) => {
    const value = await product(app, cookie);
    const mixed = document({ items: [{ ...document().items[0], description: "CAPA MAGSAFE IPHONE 16 CORES SORTIDAS" }] });
    assertError(await request(app, cookie, "purchase.confirm", { document: mixed, decisions: { "1": { action: "link", productId: value.id } }, receive: true }), 409);
    const boxed = document({ items: [{ ...document().items[0], unit: "CX" }] });
    assertError(await request(app, cookie, "purchase.confirm", { document: boxed, decisions: { "1": { action: "link", productId: value.id } }, receive: true }), 409);
    await command(app, cookie, "purchase.confirm", { document: boxed, decisions: { "1": { action: "link", productId: value.id, conversion: 10 } }, receive: true });
    assert.equal((await list(app, cookie, "stock", `?q=${value.sku}`)).items[0].physical, 20);
  });
});

test("OP20 cliente contextual repete a mesma tentativa sem duplicar e recusa outro conteúdo", async () => {
  await scenario(async (app, cookie) => {
    const payload = { requestId: randomUUID(), name: `Cliente contexto ${randomUUID()}`, type: "Pessoa física" };
    const send = (body: unknown) => app.instance.inject({ method: "POST", url: `/api/v1/tenants/${TENANT_A}/customers`, headers: authHeaders(cookie), payload: body as any });
    const first: any = await send(payload); assert.equal(first.statusCode, 201, first.body);
    const second: any = await send(payload); assert.equal(second.statusCode, 201, second.body); assert.equal(second.json().customer.id, first.json().customer.id);
    assertError(await send({ ...payload, name: "Conteúdo diferente" }), 409);
    const rows = await fixture.a.migrationPool.query("SELECT count(*)::int AS count FROM customers WHERE name=$1", [payload.name]); assert.equal(rows.rows[0].count, 1);
  });
});

test("OP21 plano retorna rótulos somente dos candidatos sem duplicar o catálogo inteiro", async () => {
  await scenario(async (app, cookie) => {
    const one = await product(app, cookie, { name: "Capa acrilica iPhone 18", attributes: { compatibleModels: ["iPhone 18"] } });
    const two = await product(app, cookie, { name: "Capa acrilica iPhone 18 premium", attributes: { compatibleModels: ["iPhone 18"] } });
    const doc = document({ items: [{ ...document().items[0], description: "CAPA ACRILICA IPHONE 18" }] });
    const result: any = await app.instance.inject({ method: "POST", url: `${base()}/purchase-plan`, headers: authHeaders(cookie), payload: { document: doc } });
    assert.equal(result.statusCode, 200);
    const plan = result.json(), ids = [...new Set(plan.plan.lines.flatMap((line: any) => line.candidates))].sort();
    assert.equal(ids.includes(one.id), true); assert.equal(ids.includes(two.id), true);
    assert.deepEqual(plan.candidates.map((row: any) => row.id).sort(), ids);
    for (const row of plan.candidates) { assert.equal(typeof row.name, "string"); assert.equal(typeof row.sku, "string"); assert.deepEqual(Object.keys(row).sort(), ["id", "name", "sku"]); }
  });
});
