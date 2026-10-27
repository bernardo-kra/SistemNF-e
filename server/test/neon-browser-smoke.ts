import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { Pool } from "pg";
import type { FastifyInstance } from "fastify";
import type { Browser } from "@playwright/test";
import { prepareRemoteDatabases } from "../scripts/remote-databases.ts";
import { provisionFirstOwner } from "../src/first-owner.ts";
import { readConfig } from "../src/config.ts";

// Teste opt-in real: cria/reutiliza dois bancos QA separados dos bancos da aplicação.
// Nunca remove bancos, modifica usuários reais ou imprime credenciais/cookies.
const { chromium, expect } = createRequire(new URL("../../package.json", import.meta.url))("@playwright/test") as typeof import("@playwright/test");
const root = resolve(import.meta.dirname, "../.."), origin = "http://127.0.0.1:4000";
let app: FastifyInstance | undefined, control: Pool | undefined, admin: Pool | undefined, tenant: Pool | undefined, browser: Browser | undefined;
let stage = "preflight";
const checks: Record<string, string | number | boolean> = {};
try {
  if (!process.argv.includes("--run")) throw new Error("RUN_FLAG_REQUIRED");
  const link = JSON.parse(await readFile(resolve(root, ".neon"), "utf8"));
  assert.equal(link.projectId, "round-wind-47684434"); assert.equal(link.branch, "production");
  const url = new URL(process.env.DATABASE_URL_UNPOOLED ?? "");
  assert.ok(url.hostname.endsWith(".neon.tech") && !url.hostname.includes("-pooler"));
  url.searchParams.set("sslmode", "verify-full");
  const directory = resolve(root, "server/.local/neon", link.projectId);
  await mkdir(directory, { recursive: true });
  const statePath = resolve(directory, "qa-state.json");
  type State = { host: string; tenantId: string; controlPassword: string; tenantPassword: string; authSecret: string; email: string; password: string };
  let state: State;
  try { state = JSON.parse(await readFile(statePath, "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const secret = () => randomBytes(48).toString("base64url");
    state = { host: url.hostname, tenantId: randomUUID(), controlPassword: secret(), tenantPassword: secret(), authSecret: secret(), email: `neon-qa-${randomUUID()}@example.test`, password: secret() };
    await writeFile(statePath, JSON.stringify(state), { mode: 0o600, flag: "wx" });
  }
  assert.equal(state.host, url.hostname);
  stage = "qa-databases";
  const prefix = `sistem_${createHash("sha256").update(link.projectId).digest("hex").slice(0, 10)}_qa`;
  const databases = await prepareRemoteDatabases({ adminUrl: url.toString(), prefix, credentials: state });
  const config = readConfig({ NODE_ENV: "development", API_BASE_URL: origin, FRONTEND_ORIGIN: origin, BETTER_AUTH_SECRET: state.authSecret,
    CONTROL_DATABASE_URL: databases.controlUrl, TENANT_DATABASE_URLS: JSON.stringify({ main: databases.tenantUrl }) });
  const adminUrl = new URL(url); adminUrl.pathname = new URL(databases.controlUrl).pathname;
  admin = new Pool({ connectionString: adminUrl.toString(), max: 2, connectionTimeoutMillis: 15000 });
  stage = "qa-owner";
  await provisionFirstOwner(admin, config, state.tenantId, "main", { name: "Gestor QA Neon", companyName: "Empresa QA isolada", email: state.email, password: state.password });
  control = new Pool({ connectionString: databases.controlUrl, max: 2, connectionTimeoutMillis: 15000 });
  tenant = new Pool({ connectionString: databases.tenantUrl, max: 1, connectionTimeoutMillis: 15000 });
  const { buildApp } = await import(pathToFileURL(resolve(root, "server/dist/app.js")).href) as typeof import("../src/app.ts");
  app = await buildApp({ config, controlPool: control, frontendRoot: resolve(root, "out"), logger: false });
  await app.listen({ host: "127.0.0.1", port: 4000 });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext(); const page = await context.newPage();
  const base = `${origin}/api/v1/tenants/${state.tenantId}`;
  stage = "health"; checks.readyStatus = (await context.request.get(`${origin}/health/ready`)).status(); assert.equal(checks.readyStatus, 200);
  checks.anonymousStatus = (await context.request.get(`${origin}/api/v1/me`)).status(); assert.equal(checks.anonymousStatus, 401);
  stage = "browser-login";
  await page.goto(`${origin}/operacao/`);
  await page.getByLabel("E-mail", { exact: true }).fill(state.email); await page.getByLabel("Senha", { exact: true }).fill(state.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Novo produto", exact: true })).toBeVisible(); checks.browserLogin = true;
  stage = "session-reload"; await page.reload(); await expect(page.getByRole("button", { name: "Novo produto", exact: true })).toBeVisible(); checks.sessionAfterReload = true;
  stage = "browser-write"; const name = `Produto QA Neon ${randomUUID()}`;
  await page.getByRole("button", { name: "Novo produto", exact: true }).click(); const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome", { exact: true }).fill(name); await dialog.getByLabel("Preço de compra", { exact: true }).fill("10,00");
  await dialog.getByLabel("Preço de venda", { exact: true }).fill("20,00"); await dialog.getByRole("button", { name: "Salvar produto", exact: true }).click();
  await expect(dialog).toHaveCount(0); await expect(page.getByText(name, { exact: true })).toBeVisible();
  const stored = await tenant.query("SELECT id,version,body->>'name' AS name FROM operational_records WHERE entity_type='product' AND body->>'name'=$1", [name]);
  assert.equal(stored.rowCount, 1); checks.browserWritePersistedInNeon = true;
  const audit = await tenant.query("SELECT count(*)::int AS n FROM audit_events WHERE entity_id=$1 AND action='product.create'", [stored.rows[0].id]);
  assert.equal(audit.rows[0].n, 1); checks.auditRecorded = true;
  stage = "second-browser"; const second = await browser.newContext(); const page2 = await second.newPage();
  await page2.goto(`${origin}/operacao/`); await page2.getByLabel("E-mail", { exact: true }).fill(state.email); await page2.getByLabel("Senha", { exact: true }).fill(state.password);
  await page2.getByRole("button", { name: "Entrar", exact: true }).click(); await expect(page2.getByText(name, { exact: true })).toBeVisible(); checks.sharedAcrossBrowsers = true;
  // Aceite financeiro antes da publicação: venda R$20, entrada R$5, duas parcelas
  // de R$7,50; receber R$10 depois deixa R$5, sem repetir venda/baixa/entrada.
  stage = "code-resolution";
  async function command(type: string, data: unknown, requestId = randomUUID()) {
    const response = await context.request.post(`${base}/operations/commands`, { headers: { origin }, data: { requestId, type, data } });
    assert.equal(response.status(), 200); return (await response.json()).entity;
  }
  const gtin = randomBytes(6).readUIntBE(0, 6).toString();
  const updated = await command("product.update", { id: stored.rows[0].id, version: stored.rows[0].version, gtin });
  stored.rows[0].version = updated.version;
  await command("product.create", { sku: `DUP-${randomUUID()}`, name: "Outro produto QA com mesmo GTIN", gtin, salePriceCents: 3000 });
  const exactResponse = await context.request.get(`${base}/operations/products?status=active&limit=2&code=${gtin}`);
  assert.equal(exactResponse.status(), 200); const exact = await exactResponse.json();
  assert.equal(exact.total, 2); assert.equal(exact.items.length, 2);
  const partialResponse = await context.request.get(`${base}/operations/products?status=active&limit=2&code=${gtin.slice(0,-1)}`);
  assert.equal(partialResponse.status(), 200); assert.equal((await partialResponse.json()).total, 0);
  checks.exactCodeResolution = true;
  stage = "financial-checkout";
  const customerResponse = await context.request.post(`${base}/customers`, { headers: { origin }, data: { requestId: randomUUID(), name: "Cliente QA financeiro", type: "Pessoa física" } });
  assert.equal(customerResponse.status(), 201); const customer = (await customerResponse.json()).customer;
  await command("stock.receive", { productId: stored.rows[0].id, quantity: 2, reference: "Conferencia QA" });
  const bank = await command("account.create", { name: `Conta QA ${randomUUID()}`, type: "bank" });
  const attempt = randomUUID(), checkout = { customerId: customer.id, items: [{ productId: stored.rows[0].id, quantity: 1, version: stored.rows[0].version }], deliver: true,
    terms: { downPaymentCents: 500, installmentCount: 2, firstDue: "2100-01-31" },
    payment: { accountId: bank.id, amountCents: 500, method: "pix", creditConfirmed: true, reference: "Conferencia manual QA" } };
  const sale = await command("sale.checkout", checkout, attempt);
  assert.equal(sale.status, "delivered"); assert.equal(sale.totalCents, 2000);
  assert.equal((await command("sale.checkout", checkout, attempt)).id, sale.id);
  stage = "financial-payment";
  const payment = await command("payment.receive", { customerId: customer.id, accountId: bank.id, amountCents: 1000, method: "transfer", creditConfirmed: true, reference: "Conferencia manual QA" });
  assert.equal(payment.receipt.remainingCents, 500); assert.equal(payment.allocations.length, 2);
  const titles = await tenant.query("SELECT amount_cents::int AS amount FROM finance_installments WHERE agreement_id=$1 ORDER BY number", [sale.agreementId]);
  assert.deepEqual(titles.rows.map((row) => row.amount).sort((a,b) => a-b), [500,750,750]);
  assert.equal((await tenant.query("SELECT count(*)::int AS n FROM finance_payments WHERE customer_id=$1", [customer.id])).rows[0].n, 2);
  const stock = (await tenant.query("SELECT physical::int,reserved::int FROM stock_balances WHERE product_id=$1", [stored.rows[0].id])).rows[0];
  assert.deepEqual(stock, { physical: 1, reserved: 0 });
  checks.financialFlow = true; checks.checkoutReplayedOnce = true;
  stage = "permissions"; const employee = { requestId: randomUUID(), name: "Consulta QA Neon", email: `viewer-${randomUUID()}@example.test`, password: randomBytes(32).toString("base64url"), role: "viewer" };
  const created = await context.request.post(`${base}/members`, { headers: { origin }, data: employee }); assert.equal(created.status(), 201);
  const employeeContext = await browser.newContext(); const signed = await employeeContext.request.post(`${origin}/api/auth/sign-in/email`, { headers: { origin }, data: { email: employee.email, password: employee.password } }); assert.equal(signed.status(), 200);
  checks.employeeProductsStatus = (await employeeContext.request.get(`${base}/operations/products`)).status(); assert.equal(checks.employeeProductsStatus, 403);
  stage = "logout"; const logout = await context.request.post(`${origin}/api/auth/sign-out`, { headers: { origin }, data: {} }); assert.equal(logout.status(), 200);
  checks.afterLogoutStatus = (await context.request.get(`${origin}/api/v1/me`)).status(); assert.equal(checks.afterLogoutStatus, 401);
  await page.reload(); await expect(page.getByRole("button", { name: "Entrar", exact: true })).toBeVisible(); checks.logoutBrowser = true;
  const result = { success: true, project: link.projectId, databaseScope: "isolated-qa", checks };
  await writeFile(resolve(root, "server/.local/validation/neon-browser-result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(JSON.stringify({ success: false, stage, code: typeof (error as {code?:unknown}).code === "string" ? (error as {code:string}).code : "CHECK_FAILED", checks }));
  process.exitCode = 1;
} finally { await browser?.close(); await app?.close(); await control?.end(); await admin?.end(); await tenant?.end(); }
