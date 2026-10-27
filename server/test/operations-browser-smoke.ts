import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { createFixture, ORIGIN, TENANT_A, type Fixture, type TestApp } from "./helpers.ts";

// Ensaio separado: Chrome, HTTP/cookies, Better Auth e PostgreSQL reais, somente fixtures.
// Critérios: contexto preservado, reserva/baixa exatas, 500 itens em uma confirmação,
// custo ausente para consulta, revogação imediata e histórico com identidade real.
const { chromium, expect } = createRequire(new URL("../../package.json", import.meta.url))("@playwright/test") as typeof import("@playwright/test");
const api = "http://127.0.0.1:4000", base = `${api}/api/v1/tenants/${TENANT_A}`, operations = `${base}/operations`;
let fixture: Fixture | undefined, app: TestApp | undefined, browser: Browser | undefined;
let managerContext: BrowserContext | undefined, employeeContext: BrowserContext | undefined;
let stage = "prepare", success = false, navigations = 0, failure: { code?: string; location?: string } | undefined;
const traffic: { method: string; resource: string }[] = [], timings: Record<string, number> = {}, statuses: Record<string, number> = {};
async function enter(page: Page, email: string, password: string) {
  await page.goto(`${ORIGIN}/operacao/`);
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
}
try {
  fixture = await createFixture(); stage = "identities";
  const owner = await fixture.user(), employee = await fixture.user("viewer");
  await fixture.control.migrationPool.query("UPDATE memberships SET permission_overrides=$1 WHERE user_id=$2 AND tenant_id=$3", [JSON.stringify({ "products.read": true, "stock.read": true }), employee.id, TENANT_A]);
  app = await fixture.app(); await app.instance.listen({ host: "127.0.0.1", port: 4000 });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  managerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const manager = await managerContext.newPage();
  manager.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin === api && request.method() !== "OPTIONS") traffic.push({ method: request.method(), resource: url.pathname.split("/").at(-1) ?? "" });
  });
  const command = async (type: string, data: unknown) => {
    const response = await managerContext!.request.post(`${operations}/commands`, { headers: { origin: ORIGIN }, data: { requestId: randomUUID(), type, data } });
    assert.equal(response.status(), 200); return (await response.json()).entity;
  };
  const list = async (resource: string) => {
    const response = await managerContext!.request.get(`${operations}/${resource}`); assert.equal(response.status(), 200); return (await response.json()).items;
  };
  stage = "manager-login"; await enter(manager, owner.email, owner.password);
  await expect(manager.getByRole("button", { name: "Novo produto", exact: true })).toBeVisible();
  manager.on("request", (request) => { if (request.isNavigationRequest() && request.resourceType() === "document") navigations++; });
  stage = "product-and-stock";
  await manager.getByRole("button", { name: "Novo produto", exact: true }).click();
  let modal = manager.getByRole("dialog");
  await modal.getByLabel("SKU", { exact: true }).fill("SMOKE-CAPA");
  await modal.getByLabel("Nome", { exact: true }).fill("Capa acrilica MagSafe iPhone 16");
  await modal.getByLabel("Tipo", { exact: true }).fill("Capas");
  await modal.getByLabel("Preço de compra", { exact: true }).fill("10,00");
  await modal.getByLabel("Preço de venda", { exact: true }).fill("25,00");
  await modal.getByRole("button", { name: "Salvar produto", exact: true }).click(); await expect(modal).toHaveCount(0);
  await manager.getByRole("button", { name: "Registrar entrada", exact: true }).click(); modal = manager.getByRole("dialog");
  await modal.getByLabel("Quantidade", { exact: true }).fill("5");
  await modal.getByLabel("Referência da entrada", { exact: true }).fill("Conferencia ficticia");
  await modal.getByRole("button", { name: "Confirmar entrada", exact: true }).click(); await expect(modal).toHaveCount(0);
  const product = (await list("products"))[0]; assert.equal(product.stock.physical, 5);

  stage = "order-context";
  await manager.getByRole("link", { name: "Ordens de serviço", exact: true }).click();
  await manager.getByRole("button", { name: "Nova OS", exact: true }).click();
  modal = manager.getByRole("dialog", { name: "Nova OS", exact: true });
  await modal.getByLabel("Equipamento", { exact: true }).fill("Telefone ficticio preservado");
  await modal.getByRole("button", { name: "Cadastrar cliente aqui", exact: true }).click();
  let child = manager.getByRole("dialog", { name: "Cadastrar cliente", exact: true });
  await child.getByLabel("Nome", { exact: true }).fill("Cliente ficticio do ensaio");
  await child.getByRole("button", { name: "Salvar cadastro", exact: true }).click(); await expect(child).toHaveCount(0);
  await expect(modal.getByLabel("Equipamento", { exact: true })).toHaveValue("Telefone ficticio preservado");
  await modal.getByRole("button", { name: "Cadastrar técnico aqui", exact: true }).click();
  child = manager.getByRole("dialog", { name: "Cadastrar técnico", exact: true });
  await child.getByLabel("Nome", { exact: true }).fill("Tecnico ficticio");
  await child.getByRole("button", { name: "Salvar cadastro", exact: true }).click(); await expect(child).toHaveCount(0);
  await modal.getByLabel("Serviço solicitado", { exact: true }).fill("Troca de tela");
  await modal.getByLabel("Previsão", { exact: true }).fill("2026-11-01");
  await modal.getByLabel("Mão de obra", { exact: true }).fill("120,00");
  await modal.getByRole("button", { name: "Salvar OS", exact: true }).click(); await expect(modal).toHaveCount(0);
  const order = (await list("orders"))[0]; assert.equal(order.equipment, "Telefone ficticio preservado");
  assert.equal(order.updatedBy, owner.id); assert.equal(order.financeStatus, "not_integrated"); assert.notEqual(order.technicianId, owner.id);

  stage = "sale-reservation-delivery";
  await manager.getByRole("link", { name: "Vendas", exact: true }).click();
  await manager.getByRole("button", { name: "Nova venda", exact: true }).click(); modal = manager.getByRole("dialog");
  await expect(modal.getByLabel("Cliente", { exact: true }).locator("option")).toHaveCount(2);
  await modal.getByLabel("Cliente", { exact: true }).selectOption(order.customerId);
  await expect(modal.getByLabel("Produto 1", { exact: true }).locator("option")).toHaveCount(2);
  await modal.getByLabel("Produto 1", { exact: true }).selectOption(product.id);
  await modal.getByLabel("Quantidade 1", { exact: true }).fill("2");
  await modal.getByLabel("Entregar agora", { exact: true }).uncheck();
  await modal.getByRole("button", { name: "Concluir venda", exact: true }).click(); await expect(modal).toHaveCount(0);
  let stock = (await list("stock"))[0]; assert.equal(stock.physical, 5); assert.equal(stock.reserved, 2); assert.equal(stock.available, 3);
  await manager.getByRole("button", { name: "Entregar venda", exact: true }).click();
  await expect(manager.getByRole("button", { name: "Entregar venda", exact: true })).toHaveCount(0);
  stock = (await list("stock"))[0]; assert.equal(stock.physical, 3); assert.equal(stock.reserved, 0);

  stage = "purchase-500";
  const supplierId = "12345678000190", description = "CAPA ACRILICA MAGSAFE IPHONE 16";
  const items = Array.from({ length: 500 }, (_, i) => ({ id: String(i + 1), code: `ITEM-${i + 1}`, description, unit: "UN", quantity: 1, costCents: 1000, ncm: "39269090", totalCents: 1000 }));
  // Precondition setup uses one real API batch; it is not counted as the operator's receipt.
  await command("purchase.confirm", { document: { key: "PRECONDITION-500", supplierId, supplierName: "Fornecedor ficticio", number: "PRE", items, totalCents: 500000 }, decisions: Object.fromEntries(items.map((item) => [item.id, { action: "link", productId: product.id }])), receive: false });
  const xmlKey = "35261012345678000190550010000000011000000010";
  const xml = `<nfeProc><NFe><infNFe Id="NFe${xmlKey}"><ide><nNF>2</nNF></ide><emit><CNPJ>${supplierId}</CNPJ><xNome>Fornecedor ficticio</xNome></emit>${items.map((item) => `<det nItem="${item.id}"><prod><cProd>${item.code}</cProd><xProd>${description}</xProd><NCM>39269090</NCM><uCom>UN</uCom><qCom>1</qCom><vUnCom>10.00</vUnCom><vProd>10.00</vProd></prod></det>`).join("")}<total><ICMSTot><vProd>5000.00</vProd><vNF>5000.00</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`;
  await manager.getByRole("link", { name: "Compras", exact: true }).click();
  const trafficStart = traffic.length, started = performance.now();
  await manager.getByLabel("Arquivo XML", { exact: true }).setInputFiles({ name: "ficticio-500.xml", mimeType: "text/xml", buffer: Buffer.from(xml) });
  await expect(manager.getByText("500 itens reconhecidos", { exact: true })).toBeVisible();
  timings.plan500Ms = Math.round(performance.now() - started);
  assert.equal(await manager.getByRole("combobox", { name: /^Ação para/ }).count(), 0);
  const confirmation = performance.now();
  await manager.getByRole("button", { name: "Confirmar recebimento", exact: true }).click();
  await expect(manager.getByRole("status").filter({ hasText: "Compra confirmada." })).toBeVisible();
  timings.confirm500Ms = Math.round(performance.now() - confirmation);
  assert.equal(traffic.slice(trafficStart).filter((entry) => entry.method === "POST" && entry.resource === "purchase-plan").length, 1);
  assert.equal(traffic.slice(trafficStart).filter((entry) => entry.method === "POST" && entry.resource === "commands").length, 1);
  stock = (await list("stock"))[0]; assert.equal(stock.physical, 503); assert.equal(stock.reserved, 0);

  stage = "history-and-captures";
  await manager.getByRole("link", { name: "Produtos", exact: true }).click();
  await manager.getByRole("button", { name: /^Histórico de/ }).click();
  await expect(manager.getByRole("dialog").getByText("Pessoa de teste", { exact: true }).first()).toBeVisible();
  await manager.getByRole("dialog").getByRole("button", { name: /Fechar/ }).click();
  const pictures = new URL("../../docs/evidencias/", import.meta.url); await mkdir(pictures, { recursive: true });
  await manager.screenshot({ path: fileURLToPath(new URL("operacao-conectada.png", pictures)), fullPage: true });
  await manager.setViewportSize({ width: 390, height: 844 });
  await manager.getByRole("button", { name: "Editar produto", exact: true }).click();
  await manager.screenshot({ path: fileURLToPath(new URL("operacao-conectada-mobile.png", pictures)), fullPage: true });
  await manager.getByRole("dialog").getByRole("button", { name: "Cancelar", exact: true }).click();

  stage = "employee-cost-and-revocation";
  employeeContext = await browser.newContext(); const employeePage = await employeeContext.newPage();
  await enter(employeePage, employee.email, employee.password);
  await expect(employeePage.getByRole("columnheader", { name: "Venda", exact: true })).toBeVisible();
  await expect(employeePage.getByRole("columnheader", { name: "Compra", exact: true })).toHaveCount(0);
  await expect(employeePage.getByRole("link", { name: "Compras", exact: true })).toHaveCount(0);
  const response = await employeeContext.request.get(`${operations}/products`); statuses.employeeRead = response.status(); assert.equal(response.status(), 200);
  assert.equal(Object.hasOwn((await response.json()).items[0], "costCents"), false);
  await fixture.control.migrationPool.query("UPDATE memberships SET active=false WHERE user_id=$1 AND tenant_id=$2", [employee.id, TENANT_A]);
  statuses.afterRevoke = (await employeeContext.request.get(`${operations}/products`)).status(); assert.equal(statuses.afterRevoke, 403);
  stage = "logout"; await manager.getByRole("button", { name: "Sair", exact: true }).click();
  await expect(manager.getByLabel("E-mail", { exact: true })).toBeVisible();
  statuses.afterLogout = (await managerContext.request.get(`${api}/api/v1/me`)).status(); assert.equal(statuses.afterLogout, 401);
  assert.equal(navigations, 0); success = true; stage = "complete";
} catch (error) {
  const detail = error as { code?: unknown; stack?: string };
  failure = { code: typeof detail.code === "string" && /^[A-Z_0-9]+$/.test(detail.code) ? detail.code : undefined,
    location: detail.stack?.split("\n").find((line) => /(?:test|scripts)[\\/].*:\d+:\d+/.test(line))?.trim() };
  process.exitCode = 1;
} finally {
  let cleanup = true;
  for (const close of [() => employeeContext?.close(), () => managerContext?.close(), () => browser?.close(), () => app?.close(), () => fixture?.close()]) {
    try { await close(); } catch { cleanup = false; process.exitCode = 1; }
  }
  const result = { kind: "OP_BROWSER_REAL", success: success && cleanup, stage, cleanup, failure, environment: "Chrome local, loopback HTTP, Better Auth, PostgreSQL isolado; dados ficticios", statuses, timings, managerDocumentNavigations: navigations, managerApiRequests: traffic.length, traffic };
  const artifacts = new URL("../.local/validation/", import.meta.url); await mkdir(artifacts, { recursive: true });
  await writeFile(new URL("operations-browser-real-result.json", artifacts), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
