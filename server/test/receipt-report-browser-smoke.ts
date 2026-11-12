import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import type { Browser, BrowserContext } from "@playwright/test";
import { Pool } from "pg";
import { createFixture, TENANT_A, type Fixture } from "./helpers.ts";

// Real Chrome → compiled app/static export → Better Auth → isolated generic PostgreSQL.
// Explicit opt-in; no intercepted calls, remote databases or customer records.
if (!process.argv.includes("--run")) throw new Error("Execute explicitamente com --run após o build, com a porta 4000 livre.");
const { chromium, expect } = createRequire(new URL("../../package.json", import.meta.url))("@playwright/test") as typeof import("@playwright/test");
const compiledPath = new URL("../dist/app.js", import.meta.url).href;
const { buildApp } = await import(compiledPath) as typeof import("../src/app.ts");
const origin = "http://127.0.0.1:4000", base = `${origin}/api/v1/tenants/${TENANT_A}`;
let fixture: Fixture | undefined, control: Pool | undefined, app: Awaited<ReturnType<typeof buildApp>> | undefined;
let browser: Browser | undefined, context: BrowserContext | undefined;
let success = false, cleanup = true, stage = "setup", reads = 0, exports = 0, installmentReads = 0, installmentExports = 0, saleReads = 0, saleExports = 0, orderReads = 0, orderExports = 0, observedQueryMs = 0, observedInstallmentQueryMs = 0, observedSaleQueryMs = 0, observedOrderQueryMs = 0;
try {
  fixture = await createFixture();
  await fixture.a.migrationPool.query("INSERT INTO tenant_admission(singleton,slot_id,tenant_id,claimed_at) VALUES(true,$1,$2,clock_timestamp())", [randomUUID(), TENANT_A]);
  const actor = await fixture.user();
  control = new Pool({ connectionString: fixture.control.runtimeUrl, max: 2 });
  app = await buildApp({ config: { ...fixture.config, frontendOrigin: origin }, controlPool: control, frontendRoot: fileURLToPath(new URL("../../out/", import.meta.url)), logger: false });
  await app.listen({ host: "127.0.0.1", port: 4000 });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  stage = "seed";
  const signed = await context.request.post(origin + "/api/auth/sign-in/email", { headers: { origin }, data: { email: actor.email, password: actor.password } });
  assert.equal(signed.status(), 200);
  const created = await context.request.post(base + "/customers", { headers: { origin }, data: { name: '=Cliente "QA"; integração', type: "Pessoa física" } });
  assert.equal(created.status(), 201); const customer = (await created.json()).customer;
  async function command(type: string, data: unknown) {
    const response = await context!.request.post(base + "/operations/commands", { headers: { origin }, data: { requestId: randomUUID(), type, data } });
    assert.equal(response.status(), 200); return (await response.json()).entity;
  }
  const account = await command("account.create", { name: "Conta bancária QA", type: "bank" });
  const product = await command("product.create", { sku: randomUUID(), name: "Produto genérico QA", salePriceCents: 1000 });
  await command("stock.receive", { productId: product.id, quantity: 2, reference: "Conferência fictícia QA" });
  const secondProduct = await command("product.create", { sku: randomUUID(), name: "Segundo produto genérico QA", salePriceCents: 500 });
  await command("stock.receive", { productId: secondProduct.id, quantity: 2, reference: "Conferência fictícia QA" });
  const sale = await command("sale.checkout", { customerId: customer.id, items: [{ productId: product.id, quantity: 1, version: product.version, discountCents: 200 }, { productId: secondProduct.id, quantity: 1, version: secondProduct.version, discountCents: 300 }], deliver: false, terms: { downPaymentCents: 0, installmentCount: 2, firstDue: "2100-01-01" } });
  const payment = await command("payment.receive", { customerId: customer.id, accountId: account.id, method: "pix", amountCents: 750, reference: "Crédito fictício conferido QA", creditConfirmed: true });
  assert.equal(payment.allocations.length, 2);
  const technician = await command("technician.create", { name: "=Técnico genérico QA" });
  const orderData = { customerId: customer.id, technicianId: technician.id, equipment: "Equipamento genérico QA", issue: "Defeito privado QA", due: "2100-01-01" };
  let order = await command("order.create", { ...orderData, laborCents: 1000 });
  await command("order.create", { ...orderData, laborCents: 250 });
  order = await command("order.advance", { id: order.id, version: order.version });
  order = await command("order.advance", { id: order.id, version: order.version });
  order = await command("order.approve", { id: order.id, version: order.version, budgetRevision: order.budgetRevision, channel: "in_person" });
  const auditBefore = (await fixture.a.migrationPool.query("SELECT count(*)::int n FROM audit_events")).rows[0].n;
  const page = await context.newPage();
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/reports/receipts")) reads++;
    if (path.endsWith("/reports/receipts/export")) exports++;
    if (path.endsWith("/reports/installments")) installmentReads++;
    if (path.endsWith("/reports/installments/export")) installmentExports++;
    if (path.endsWith("/reports/sales")) saleReads++;
    if (path.endsWith("/reports/sales/export")) saleExports++;
    if (path.endsWith("/reports/orders")) orderReads++;
    if (path.endsWith("/reports/orders/export")) orderExports++;
  });
  stage = "query"; const start = performance.now(); await page.goto(origin + "/relatorios/");
  await expect(page.getByText("R$ 7,50", { exact: true }).first()).toBeVisible(); observedQueryMs = Math.round(performance.now() - start);
  assert.equal(reads, 1); await expect(page.getByRole("row")).toHaveCount(2);
  stage = "export"; const downloadEvent = page.waitForEvent("download"); await page.getByRole("button", { name: "Exportar CSV", exact: true }).click();
  const download = await downloadEvent, stream = await download.createReadStream(), chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const csv = Buffer.concat(chunks).toString("utf8");
  assert.ok(csv.includes("'=Cliente")); assert.ok(csv.includes('""QA""')); assert.ok(csv.includes("7,50")); assert.ok(csv.includes(payment.id));
  assert.equal(reads, 1); assert.equal(exports, 1);
  assert.equal((await fixture.a.migrationPool.query("SELECT count(*)::int n FROM audit_events")).rows[0].n, auditBefore);
  stage = "layout"; const directory = fileURLToPath(new URL("../.local/validation/", import.meta.url)); await mkdir(directory, { recursive: true });
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); window.scrollTo(0, 0); }); await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.screenshot({ path: resolve(directory, `receipt-report-real-${width}.png`), fullPage: true });
  }
  stage = "installments";
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel("Tipo de relatório", { exact: true }).selectOption("installments");
  await expect(page.getByText("Nenhuma parcela nesta seleção.", { exact: true })).toBeVisible();
  await page.getByLabel("Data inicial", { exact: true }).fill("2100-01-01");
  await page.getByLabel("Data final", { exact: true }).fill("2100-02-28");
  const installmentStart = performance.now();
  await page.getByRole("button", { name: "Consultar", exact: true }).click();
  await expect(page.getByRole("row")).toHaveCount(3);
  await expect(page.getByText("Saldo na data-base", { exact: true }).locator("..").getByText("R$ 2,50", { exact: true })).toBeVisible();
  await expect(page.getByText("Pago até a data-base", { exact: true }).locator("..").getByText("R$ 7,50", { exact: true })).toBeVisible();
  observedInstallmentQueryMs = Math.round(performance.now() - installmentStart);
  const installmentDownloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar CSV", exact: true }).click();
  const installmentStream = await (await installmentDownloadEvent).createReadStream(), installmentChunks: Buffer[] = [];
  for await (const chunk of installmentStream!) installmentChunks.push(Buffer.from(chunk));
  const installmentCsv = Buffer.concat(installmentChunks).toString("utf8");
  assert.ok(installmentCsv.includes("Data-base")); assert.ok(installmentCsv.includes("2,50")); assert.ok(installmentCsv.includes("7,50")); assert.ok(installmentCsv.includes("'=Cliente"));
  assert.equal(installmentReads, 2); assert.equal(installmentExports, 1); assert.equal(reads, 1); assert.equal(exports, 1);
  assert.equal((await fixture.a.migrationPool.query("SELECT count(*)::int n FROM audit_events")).rows[0].n, auditBefore);
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); window.scrollTo(0, 0); }); await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.screenshot({ path: resolve(directory, `installment-report-real-${width}.png`), fullPage: true });
  }
  stage = "sales";
  const saleStart = performance.now();
  await page.getByLabel("Tipo de relatório", { exact: true }).selectOption("sales");
  const saleTotals = page.getByRole("region", { name: "Totais da seleção" });
  await expect(saleTotals.getByText("Valor vendido", { exact: true }).locator("..").getByText("R$ 10,00", { exact: true })).toBeVisible();
  await expect(saleTotals.getByText("Valor bruto", { exact: true }).locator("..").getByText("R$ 15,00", { exact: true })).toBeVisible();
  await expect(saleTotals.getByText("Descontos", { exact: true }).locator("..").getByText("R$ 5,00", { exact: true })).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(2); observedSaleQueryMs = Math.round(performance.now() - saleStart);
  const saleDownloadEvent = page.waitForEvent("download"); await page.getByRole("button", { name: "Exportar CSV", exact: true }).click();
  const saleStream = await (await saleDownloadEvent).createReadStream(), saleChunks: Buffer[] = [];
  for await (const chunk of saleStream!) saleChunks.push(Buffer.from(chunk));
  const saleCsv = Buffer.concat(saleChunks).toString("utf8");
  assert.ok(saleCsv.includes(sale.id)); assert.ok(saleCsv.includes("15,00")); assert.ok(saleCsv.includes("5,00")); assert.ok(saleCsv.includes("10,00"));
  assert.ok(saleCsv.includes("'=Cliente")); assert.ok(saleCsv.includes("não representam recebimentos"));
  assert.equal(saleReads, 1); assert.equal(saleExports, 1); assert.equal(installmentReads, 2); assert.equal(reads, 1);
  assert.equal((await fixture.a.migrationPool.query("SELECT count(*)::int n FROM audit_events")).rows[0].n, auditBefore);
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); window.scrollTo(0, 0); }); await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.screenshot({ path: resolve(directory, `sale-report-real-${width}.png`), fullPage: true });
  }
  stage = "orders";
  const orderStart = performance.now(); await page.getByLabel("Tipo de relatório", { exact: true }).selectOption("orders");
  const orderTotals = page.getByRole("region", { name: "Totais da seleção" });
  await expect(orderTotals.getByText("Serviços registrados", { exact: true }).locator("..").getByText("R$ 12,50", { exact: true })).toBeVisible();
  await expect(orderTotals.getByText("Serviços aprovados", { exact: true }).locator("..").getByText("R$ 10,00", { exact: true })).toBeVisible();
  await expect(orderTotals.getByText("Serviços sem aprovação", { exact: true }).locator("..").getByText("R$ 2,50", { exact: true })).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(3); observedOrderQueryMs = Math.round(performance.now() - orderStart);
  const orderDownloadEvent = page.waitForEvent("download"); await page.getByRole("button", { name: "Exportar CSV", exact: true }).click();
  const orderStream = await (await orderDownloadEvent).createReadStream(), orderChunks: Buffer[] = [];
  for await (const chunk of orderStream!) orderChunks.push(Buffer.from(chunk));
  const orderCsv = Buffer.concat(orderChunks).toString("utf8");
  assert.ok(orderCsv.includes(order.id)); assert.ok(orderCsv.includes("12,50")); assert.ok(orderCsv.includes("10,00")); assert.ok(orderCsv.includes("2,50"));
  assert.ok(orderCsv.includes("'=Cliente")); assert.ok(orderCsv.includes("'=Técnico")); assert.ok(!orderCsv.includes("Defeito privado"));
  assert.ok(orderCsv.includes("não representam recebimentos"));
  assert.equal(orderReads, 1); assert.equal(orderExports, 1); assert.equal(saleReads, 1); assert.equal(installmentReads, 2); assert.equal(reads, 1);
  assert.equal((await fixture.a.migrationPool.query("SELECT count(*)::int n FROM audit_events")).rows[0].n, auditBefore);
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); window.scrollTo(0, 0); }); await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.screenshot({ path: resolve(directory, `order-report-real-${width}.png`), fullPage: true });
  }
  success = true;
} catch (error) {
  console.error(JSON.stringify({ event: "report.browser.failed", stage, code: error && typeof error === "object" && "code" in error ? String(error.code) : "VERIFICATION_FAILED" })); process.exitCode = 1;
} finally {
  for (const close of [() => context?.close(), () => browser?.close(), () => app?.close(), () => control?.end(), () => fixture?.close()]) {
    try { await close(); } catch { cleanup = false; process.exitCode = 1; }
  }
  console.log(JSON.stringify({ event: "report.browser.result", success, cleanup, stage, reads, exports, installmentReads, installmentExports, saleReads, saleExports, orderReads, orderExports, observedQueryMs, observedInstallmentQueryMs, observedSaleQueryMs, observedOrderQueryMs, compiledApi: true }));
}
