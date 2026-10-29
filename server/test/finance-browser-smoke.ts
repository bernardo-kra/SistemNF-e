import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { createFixture, ORIGIN, TENANT_A, type Fixture, type TestApp } from "./helpers.ts";

// Additional integration check: no interception, no real customers, no external services.
const { chromium, expect } = createRequire(new URL("../../package.json", import.meta.url))("@playwright/test") as typeof import("@playwright/test");
const api = "http://127.0.0.1:4000", base = `${api}/api/v1/tenants/${TENANT_A}`;
let fixture: Fixture | undefined, app: TestApp | undefined, browser: Browser | undefined, context: BrowserContext | undefined, employeeContext: BrowserContext | undefined;
let stage = "prepare", success = false, navigations = 0;
const traffic: { method: string; resource: string; type?: string }[] = [], timings: Record<string, number> = {}, statuses: Record<string, number> = {};
let failure: { code?: string; location?: string } | undefined;
async function post(path: string, data: unknown) { const response = await context!.request.post(`${base}/${path}`, { headers: { origin: ORIGIN }, data }); assert.ok(response.ok()); return response.json(); }
async function get(path: string) { const response = await context!.request.get(`${base}/${path}`); assert.equal(response.status(), 200); return response.json(); }
try {
  fixture = await createFixture(); stage = "identities";
  const owner = await fixture.user(), employee = await fixture.user("viewer"); app = await fixture.app(); await app.instance.listen({ host: "127.0.0.1", port: 4000 });
  browser = await chromium.launch({ channel: "chrome", headless: true }); context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on("request", (request) => { const url = new URL(request.url()); if (url.origin !== api || request.method() === "OPTIONS") return; let type: string | undefined; if (url.pathname.endsWith("/commands")) type = request.postDataJSON()?.type; traffic.push({ method: request.method(), resource: url.pathname.split("/").at(-1) ?? "", ...(type ? { type } : {}) }); });
  stage = "login"; await page.goto(`${ORIGIN}/operacao/`); await page.getByLabel("E-mail", { exact: true }).fill(owner.email); await page.getByLabel("Senha", { exact: true }).fill(owner.password); await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Novo produto", exact: true })).toBeVisible(); page.on("request", (request) => { if (request.isNavigationRequest() && request.resourceType() === "document") navigations++; });
  // Setup known customer once via the real API; it is not an operator action in the measured checkout.
  const customer = (await post("customers", { requestId: randomUUID(), name: "Cliente financeiro ficticio", type: "Pessoa física" })).customer;
  stage = "product-auto-code"; await page.getByRole("button", { name: "Novo produto", exact: true }).click(); let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome", { exact: true }).fill("Capa financeira ficticia"); await dialog.getByLabel("Preço de compra", { exact: true }).fill("50,00"); await dialog.getByLabel("Preço de venda", { exact: true }).fill("100,00");
  await dialog.getByRole("button", { name: "Salvar produto", exact: true }).click(); await expect(dialog).toHaveCount(0);
  const product = (await get("operations/products")).items[0]; assert.match(product.sku, /^AUTO-/); assert.equal(product.stock.physical, 0);
  await page.getByRole("button", { name: "Registrar entrada", exact: true }).click(); dialog = page.getByRole("dialog"); await dialog.getByLabel("Quantidade", { exact: true }).fill("5"); await dialog.getByLabel("Referência da entrada", { exact: true }).fill("Conferencia ficticia"); await dialog.getByRole("button", { name: "Confirmar entrada", exact: true }).click(); await expect(dialog).toHaveCount(0);
  stage = "checkout-context-bank"; await page.getByRole("link", { name: "Vendas", exact: true }).click(); await page.getByRole("button", { name: "Nova venda", exact: true }).click(); dialog = page.getByRole("dialog", { name: "Nova venda", exact: true });
  await dialog.getByRole("combobox", { name: "Cliente", exact: true }).fill(customer.name); await dialog.getByRole("option", { name: customer.name }).click();
  const reader = dialog.getByLabel("Ler código ou SKU", { exact: true }); await reader.fill(product.sku); await reader.press("Enter"); await expect(dialog.getByLabel("Produto 1", { exact: true })).toHaveValue(product.name); await reader.fill(product.sku); await reader.press("Enter"); await expect(dialog.getByLabel("Quantidade 1", { exact: true })).toHaveValue("2");
  await dialog.getByLabel("Condição de pagamento", { exact: true }).selectOption("installments"); await dialog.getByLabel("Entrada", { exact: true }).fill("40,00"); await dialog.getByLabel("Número de parcelas", { exact: true }).fill("2"); await dialog.getByLabel("Primeiro vencimento", { exact: true }).fill("2100-01-31"); await dialog.getByLabel("Receber entrada agora", { exact: true }).check(); await dialog.getByLabel("Meio de pagamento", { exact: true }).selectOption("pix");
  await dialog.getByRole("button", { name: "Cadastrar conta aqui", exact: true }).click(); let child = page.getByRole("dialog", { name: "Cadastrar conta", exact: true }); await child.getByLabel("Nome da conta", { exact: true }).fill("Banco ficticio"); await child.getByLabel("Tipo da conta", { exact: true }).selectOption("bank"); await child.getByRole("button", { name: "Salvar conta", exact: true }).click(); await expect(child).toHaveCount(0);
  await expect(dialog.getByLabel("Conta", { exact: true }).locator("option")).toHaveCount(2); await dialog.getByLabel("Referência", { exact: true }).fill("Pix conferido manualmente"); await dialog.getByLabel("Crédito conferido manualmente", { exact: true }).check();
  const checkoutStart = performance.now(); await dialog.getByRole("button", { name: "Concluir venda", exact: true }).click(); let receipt = page.getByRole("dialog", { name: "Recibo de recebimento", exact: true }); await expect(receipt).toBeVisible(); timings.checkoutToReceiptMs = Math.round(performance.now() - checkoutStart);
  await expect(receipt).toContainText("40,00"); await receipt.getByRole("button", { name: "Fechar recibo", exact: true }).click(); await expect(dialog).toHaveCount(0);
  assert.equal(traffic.filter((item) => item.type === "sale.checkout").length, 1);
  let stock = (await get("operations/stock")).items[0]; assert.equal(stock.physical, 3); assert.equal(stock.reserved, 0);
  let rows = (await get(`finance/installments?customerId=${customer.id}&limit=100`)).items;
  assert.equal(rows.length, 3); assert.equal(rows.reduce((sum: number, row: any) => sum + row.balanceCents, 0), 16000);
  assert.deepEqual(rows.filter((row: any) => row.kind === "installment").map((row: any) => row.due), ["2100-01-31", "2100-02-28"]);
  stage = "receive-context-cash"; await page.getByRole("link", { name: "Financeiro", exact: true }).click(); await page.getByRole("button", { name: `Receber de ${customer.name}`, exact: true }).click(); dialog = page.getByRole("dialog", { name: `Receber de ${customer.name}`, exact: true });
  await dialog.getByLabel("Valor recebido", { exact: true }).fill("120,00"); await dialog.getByRole("button", { name: "Cadastrar conta aqui", exact: true }).click(); child = page.getByRole("dialog", { name: "Cadastrar conta", exact: true }); await child.getByLabel("Nome da conta", { exact: true }).fill("Caixa ficticio"); await child.getByRole("button", { name: "Salvar conta", exact: true }).click(); await expect(child).toHaveCount(0);
  await expect(dialog.getByLabel("Conta", { exact: true }).locator("option")).toHaveCount(2); await dialog.getByRole("button", { name: "Abrir caixa aqui", exact: true }).click(); child = page.getByRole("dialog", { name: "Abrir caixa", exact: true }); await child.getByRole("button", { name: "Confirmar abertura", exact: true }).click(); await expect(child).toHaveCount(0); await expect(dialog.getByLabel("Valor recebido", { exact: true })).toHaveValue("120,00");
  await dialog.getByLabel("Valor entregue", { exact: true }).fill("150,00"); const receiveStart = performance.now(); await dialog.getByRole("button", { name: "Confirmar recebimento", exact: true }).click(); receipt = page.getByRole("dialog", { name: "Recibo de recebimento", exact: true }); await expect(receipt).toBeVisible(); timings.receiveToReceiptMs = Math.round(performance.now() - receiveStart);
  await expect(receipt).toContainText("120,00"); await expect(receipt).toContainText("30,00"); await expect(receipt).toContainText("40,00");
  const payments = (await get(`finance/payments?customerId=${customer.id}`)).items; assert.equal(payments.length, 2); const received = payments.find((row: any) => row.method === "cash"); assert.equal(received.receipt.allocations.length, 2); assert.equal(received.receipt.remainingCents, 4000);
  assert.equal(traffic.filter((item) => item.type === "payment.receive").length, 1);
  let overview = await get("finance/overview"); assert.equal(overview.accounts.find((row: any) => row.type === "cash").balanceCents, 12000); assert.equal(overview.accounts.find((row: any) => row.type === "bank").balanceCents, 4000);
  const pictures = new URL("../.local/validation/order-receive-real/", import.meta.url); await mkdir(pictures, { recursive: true }); await page.screenshot({ path: fileURLToPath(new URL("financeiro-conectado-recibo.png", pictures)), fullPage: true });
  await receipt.getByRole("button", { name: "Fechar recibo", exact: true }).click();
  stage = "receipt-history-and-close"; await page.getByRole("button", { name: `Extrato de ${customer.name}`, exact: true }).click(); let statement = page.getByRole("dialog", { name: `Extrato de ${customer.name}`, exact: true }); await statement.getByRole("button", { name: "Recebimentos", exact: true }).click(); await statement.getByRole("button", { name: `Abrir recibo ${received.receipt.code}`, exact: true }).click(); receipt = page.getByRole("dialog", { name: "Recibo de recebimento", exact: true }); await expect(receipt).toContainText("120,00"); await receipt.getByRole("button", { name: "Fechar recibo", exact: true }).click(); await statement.getByRole("button", { name: "Fechar janela", exact: true }).click();
  await page.getByText("Contas e caixas", { exact: true }).click(); await page.getByRole("button", { name: "Fechar meu caixa", exact: true }).click(); dialog = page.getByRole("dialog", { name: "Fechar caixa", exact: true }); await dialog.getByLabel("Dinheiro contado", { exact: true }).fill("110,00"); await dialog.getByRole("button", { name: "Confirmar fechamento", exact: true }).click(); await expect(dialog).toHaveCount(0);
  overview = await get("finance/overview"); assert.equal(overview.shifts.length, 0); assert.equal(overview.accounts.find((row: any) => row.type === "cash").balanceCents, 12000);
  const shift = (await fixture.a.migrationPool.query("SELECT status,expected_cents,counted_cents,difference_cents FROM finance_shifts")).rows[0]; assert.equal(shift.status, "closed"); assert.equal(Number(shift.expected_cents), 12000); assert.equal(Number(shift.counted_cents), 11000); assert.equal(Number(shift.difference_cents), -1000);
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole("button", { name: `Receber de ${customer.name}`, exact: true }).click(); dialog = page.getByRole("dialog", { name: `Receber de ${customer.name}`, exact: true }); await dialog.getByLabel("Valor recebido", { exact: true }).fill("40,00"); await page.screenshot({ path: fileURLToPath(new URL("financeiro-conectado-mobile.png", pictures)), fullPage: true }); await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  stage = "order-receive-context";
  const operation = async (type: string, data: unknown) => (await post("operations/commands", { requestId: randomUUID(), type, data })).entity;
  const tech = await operation("technician.create", { name: "Técnico financeiro QA" });
  let order = await operation("order.create", { customerId: customer.id, technicianId: tech.id, equipment: "Aparelho QA", issue: "Reparo QA", due: "2100-01-01", laborCents: 12000 });
  for (let i = 0; i < 2; i++) order = await operation("order.advance", { id: order.id, version: order.version });
  order = await operation("order.update", { id: order.id, version: order.version, approved: true });
  await operation("agreement.create", { sourceType: "order", sourceId: order.id, sourceVersion: order.version, downPaymentCents: 0, installmentCount: 1, firstDue: "2100-02-01" });
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.getByRole("link", { name: "Ordens de serviço", exact: true }).click();
  const start = traffic.length, started = performance.now();
  await page.getByRole("button", { name: `Receber OS ${order.number}`, exact: true }).click(); dialog = page.getByRole("dialog", { name: `Receber OS ${order.number}`, exact: true });
  await expect(dialog.getByLabel("Valor recebido", { exact: true })).toHaveValue("120,00"); timings.orderOpenToFreshValueMs = Math.round(performance.now() - started);
  await dialog.getByLabel("Valor recebido", { exact: true }).fill("60,00"); await dialog.getByLabel("Meio de pagamento", { exact: true }).selectOption("pix");
  const bank = (await get("finance/overview")).accounts.find((row: any) => row.type === "bank"); await dialog.getByLabel("Conta", { exact: true }).selectOption(bank.id); await dialog.getByLabel("Referência", { exact: true }).fill("Crédito da OS conferido QA"); await dialog.getByLabel("Crédito conferido manualmente", { exact: true }).check();
  await page.screenshot({ path: fileURLToPath(new URL("os-receber-desktop.png", pictures)), fullPage: true }); await page.setViewportSize({ width: 390, height: 850 }); await page.screenshot({ path: fileURLToPath(new URL("os-receber-mobile.png", pictures)), fullPage: true });
  const sent = page.waitForRequest((request) => request.url().endsWith("/operations/commands") && request.method() === "POST");
  await dialog.getByRole("button", { name: "Confirmar recebimento", exact: true }).click(); const input = (await sent).postDataJSON();
  assert.equal(input.data.sourceType, "order"); assert.equal(input.data.sourceId, order.id); assert.equal(input.data.allocations.length, 1);
  receipt = page.getByRole("dialog", { name: "Recibo de recebimento", exact: true }); await expect(receipt).toContainText(`OS ${order.number}`); await expect(receipt).toContainText("60,00");
  rows = (await get(`finance/installments?customerId=${customer.id}&limit=100`)).items;
  assert.equal(rows.filter((row: any) => row.sourceType === "sale").reduce((sum: number, row: any) => sum + row.balanceCents, 0), 4000);
  assert.equal(rows.filter((row: any) => row.sourceId === order.id).reduce((sum: number, row: any) => sum + row.balanceCents, 0), 6000);
  const currentOrder = (await get("operations/orders")).items.find((row: any) => row.id === order.id); assert.equal(currentOrder.stage, order.stage); assert.equal((await get("operations/stock")).items[0].physical, 3);
  assert.equal(traffic.slice(start).filter((entry) => entry.type === "payment.receive").length, 1); assert.equal(traffic.slice(start).filter((entry) => entry.resource === "customers").length, 0);
  statuses.orderContextPayment = 200; await receipt.getByRole("button", { name: "Fechar recibo", exact: true }).click();
  stage = "permissions-and-snapshot"; employeeContext = await browser.newContext(); const signed = await employeeContext.request.post(`${api}/api/auth/sign-in/email`, { headers: { origin: ORIGIN }, data: { email: employee.email, password: employee.password } }); assert.equal(signed.status(), 200);
  statuses.beforeGrant = (await employeeContext.request.get(`${base}/finance/overview`)).status(); assert.equal(statuses.beforeGrant, 403);
  await fixture.control.migrationPool.query("UPDATE memberships SET permission_overrides=$1 WHERE user_id=$2 AND tenant_id=$3", [JSON.stringify({ "finance.read": true }), employee.id, TENANT_A]); statuses.afterGrant = (await employeeContext.request.get(`${base}/finance/overview`)).status(); assert.equal(statuses.afterGrant, 200);
  statuses.receiveDenied = (await employeeContext.request.post(`${base}/operations/commands`, { headers: { origin: ORIGIN }, data: { requestId: randomUUID(), type: "payment.receive", data: {} } })).status(); assert.equal(statuses.receiveDenied, 403);
  await fixture.control.migrationPool.query("UPDATE memberships SET active=false WHERE user_id=$1 AND tenant_id=$2", [employee.id, TENANT_A]); statuses.afterRevoke = (await employeeContext.request.get(`${base}/finance/overview`)).status(); assert.equal(statuses.afterRevoke, 403);
  const edited = await context.request.patch(`${base}/customers/${customer.id}`, { headers: { origin: ORIGIN }, data: { version: 1, name: "Nome posterior ficticio" } }); assert.equal(edited.status(), 200); assert.deepEqual((await get(`finance/payments/${received.id}`)).payment.receipt, received.receipt);
  stock = (await get("operations/stock")).items[0]; assert.equal(stock.physical, 3); rows = (await get(`finance/installments?customerId=${customer.id}&limit=100`)).items; assert.equal(rows.reduce((sum: number, row: any) => sum + row.balanceCents, 0), 10000);
  await page.getByRole("button", { name: "Sair", exact: true }).click(); await expect(page.getByLabel("E-mail", { exact: true })).toBeVisible(); statuses.afterLogout = (await context.request.get(`${api}/api/v1/me`)).status(); assert.equal(statuses.afterLogout, 401); assert.equal(navigations, 0); stage = "complete"; success = true;
} catch (error) {
  process.exitCode = 1; const detail = error as { code?: unknown; stack?: string };
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) { try { await page.screenshot({ path: fileURLToPath(new URL("../.local/validation/order-receive-smoke-failure.png", import.meta.url)), fullPage: true }); } catch { /* Keep the original failure. */ } }
  failure = { code: typeof detail.code === "string" && /^[A-Z_0-9]+$/.test(detail.code) ? detail.code : undefined, location: detail.stack?.split("\n").find((line) => /(?:test|scripts)[\\/].*:\d+:\d+/.test(line))?.trim() };
} finally {
  let cleanup = true; for (const close of [() => employeeContext?.close(), () => context?.close(), () => browser?.close(), () => app?.close(), () => fixture?.close()]) { try { await close(); } catch { cleanup = false; process.exitCode = 1; } }
  const result = { kind: "FIN_BROWSER_REAL", success: success && cleanup, stage, cleanup, failure, environment: "Chrome local, API/cookies e PostgreSQL reais isolados; dados ficticios", statuses, timings, documentNavigations: navigations, pageApiRequests: traffic.length, traffic };
  const artifacts = new URL("../.local/validation/", import.meta.url); await mkdir(artifacts, { recursive: true }); await writeFile(new URL("finance-browser-real-result.json", artifacts), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
}
