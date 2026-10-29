import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import sharp from "sharp";
import { createFixture, ORIGIN, TENANT_A, type Fixture, type TestApp, type TestUser } from "./helpers.ts";

// Critérios definidos antes do utilitário:
// login real; preview sem escrita; save único/reload; viewer lê e não edita; assets privados;
// OS/duas imagens decodificadas antes do print; PDF/PNG fictícios; sem efeitos de domínio ao imprimir.
// Sem interceptação de rede, banco remoto, .env, localStorage operacional ou registros de empresa real.
const { chromium, expect } = createRequire(new URL("../../package.json", import.meta.url))("@playwright/test") as typeof import("@playwright/test");
const api = "http://127.0.0.1:4000", base = `${api}/api/v1/tenants/${TENANT_A}`;
const artifacts = new URL("../.local/validation/", import.meta.url);
let fixture: Fixture | undefined, app: TestApp | undefined, browser: Browser | undefined;
let ownerContext: BrowserContext | undefined, viewerContext: BrowserContext | undefined, anonymousContext: BrowserContext | undefined;
let stage = "prepare", success = false, cleanup = true, brandingWrites = 0;
const checks: Record<string, boolean> = {}, statuses: Record<string, number> = {};
let failure: { code?: string; location?: string } | undefined;

async function signIn(page: Page, actor: TestUser) {
  await page.goto(`${ORIGIN}/entrar/`);
  await page.getByLabel("E-mail", { exact: true }).fill(actor.email);
  await page.getByLabel("Senha", { exact: true }).fill(actor.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sair", exact: true })).toBeVisible();
}
async function post(path: string, data: unknown) {
  const response = await ownerContext!.request.post(`${base}/${path}`, { headers: { origin: ORIGIN }, data });
  assert.ok(response.ok()); return response.json();
}
async function command(type: string, data: Record<string, unknown>) {
  return (await post("operations/commands", { requestId: randomUUID(), type, data })).entity;
}
async function domainSnapshot() {
  return (await fixture!.a.migrationPool.query(`SELECT
    (SELECT md5(COALESCE(string_agg(id::text||version::text||body::text,',' ORDER BY id),'')) FROM operational_records WHERE entity_type='order') AS orders,
    (SELECT count(*)::int FROM audit_events) AS audits,
    (SELECT count(*)::int FROM stock_movements) AS stock_movements,
    (SELECT count(*)::int FROM finance_agreements) AS agreements,
    (SELECT count(*)::int FROM finance_payments) AS payments,
    (SELECT count(*)::int FROM finance_movements) AS money_movements`)).rows[0];
}
async function decoded(locator: import("@playwright/test").Locator) {
  await expect(locator).toBeVisible();
  await expect.poll(() => locator.evaluate((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)).toBe(true);
}

console.log(JSON.stringify({ event: "branding.e2e.start", apiProcessId: process.pid, apiPort: 4000 }));
try {
  fixture = await createFixture();
  const owner = await fixture.user(), viewer = await fixture.user("viewer");
  app = await fixture.app(); await app.instance.listen({ host: "127.0.0.1", port: 4000 });
  console.log(JSON.stringify({ event: "branding.e2e.api_ready", apiProcessId: process.pid, apiPort: 4000 }));
  browser = await chromium.launch({ channel: "chrome", headless: true });
  ownerContext = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  const page = await ownerContext.newPage();
  page.on("request", (request) => { const url = new URL(request.url()); if (url.origin === api && url.pathname === `/api/v1/tenants/${TENANT_A}/branding` && request.method() === "PATCH") brandingWrites++; });

  stage = "real-login"; await signIn(page, owner); checks.realLogin = true;
  const customer = (await post("customers", { requestId: randomUUID(), name: "Cliente fictício do ensaio de impressão", type: "Pessoa física", phone: "11900000000" })).customer;
  const technician = await command("technician.create", { name: "Técnico fictício QA" });
  const order = await command("order.create", { customerId: customer.id, technicianId: technician.id, equipment: "Telefone fictício QA", issue: "Troca de tela para ensaio de impressão", due: "2100-01-31", laborCents: 15990 });

  stage = "upload-preview"; await page.getByRole("link", { name: "Configurações", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Personalização da loja", exact: true })).toBeVisible();
  const logo = await sharp(Buffer.from('<svg width="600" height="240" xmlns="http://www.w3.org/2000/svg"><rect width="600" height="240" rx="25" fill="#164a70"/><text x="300" y="152" text-anchor="middle" font-family="sans-serif" font-size="92" font-weight="bold" fill="white">LOJA QA</text></svg>')).png().toBuffer();
  const background = await sharp(Buffer.from('<svg width="1000" height="1400" xmlns="http://www.w3.org/2000/svg"><rect width="1000" height="1400" fill="white"/><g stroke="#164a70" stroke-width="12"><path d="M0 180L1000 1180M0 480L920 1400M80 0L1000 920"/></g><text x="500" y="770" text-anchor="middle" font-family="sans-serif" font-size="300" fill="#164a70">QA</text></svg>')).png().toBuffer();
  await page.getByLabel("Logotipo da loja", { exact: true }).setInputFiles({ name: "logo-generico-qa.png", mimeType: "image/png", buffer: logo });
  await page.getByLabel("Imagem de fundo da OS", { exact: true }).setInputFiles({ name: "fundo-generico-qa.png", mimeType: "image/png", buffer: background });
  await page.getByLabel("Intensidade do fundo (%)", { exact: true }).fill("12");
  const preview = page.getByRole("region", { name: "Prévia da ordem de serviço", exact: true });
  await decoded(preview.getByRole("img", { name: "Logotipo da loja", exact: true }));
  await expect(preview.getByTestId("order-watermark")).toHaveAttribute("src", /^data:image\/png;base64,/);
  assert.equal(brandingWrites, 0); checks.previewWithoutWrite = true;

  stage = "single-save";
  const savedResponse = page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === `/api/v1/tenants/${TENANT_A}/branding`);
  await page.getByRole("button", { name: "Salvar personalização", exact: true }).click();
  const saved = await savedResponse; statuses.brandingSave = saved.status(); assert.equal(saved.status(), 200);
  await expect(page.getByText("Personalização salva.", { exact: true })).toBeVisible();
  assert.equal(brandingWrites, 1); checks.singleSave = true;
  const stored = await ownerContext.request.get(`${base}/branding`); assert.equal(stored.status(), 200); const branding = (await stored.json()).branding;
  assert.equal(branding.version, 1); assert.equal(branding.backgroundOpacity, 12); assert.ok(branding.logo && branding.background);

  stage = "reload-persistence"; await page.reload();
  await expect(page.getByLabel("Intensidade do fundo (%)", { exact: true })).toHaveValue("12");
  await decoded(page.getByRole("region", { name: "Prévia da ordem de serviço", exact: true }).getByRole("img", { name: "Logotipo da loja", exact: true }));
  await decoded(page.getByRole("img", { name: "Logotipo de Loja A de teste", exact: true }));
  assert.equal(brandingWrites, 1); checks.reloadPersistence = true;

  stage = "viewer-read-only"; viewerContext = await browser.newContext(); const viewerPage = await viewerContext.newPage();
  await signIn(viewerPage, viewer); await viewerPage.getByRole("link", { name: "Configurações", exact: true }).click();
  await expect(viewerPage.getByText("A personalização é administrada pelo gestor da empresa.", { exact: true })).toBeVisible();
  await expect(viewerPage.getByRole("button", { name: "Salvar personalização", exact: true })).toHaveCount(0);
  await decoded(viewerPage.getByRole("region", { name: "Prévia da ordem de serviço", exact: true }).getByRole("img", { name: "Logotipo da loja", exact: true }));
  const denied = await viewerContext.request.patch(`${base}/branding`, { headers: { origin: ORIGIN }, data: { requestId: randomUUID(), version: branding.version, backgroundOpacity: 11 } }); statuses.viewerWrite = denied.status(); assert.equal(denied.status(), 403); checks.sharedReadOnlySession = true;
  anonymousContext = await browser.newContext(); const anonymousAsset = await anonymousContext.request.get(`${base}/branding/assets/logo?version=1`); statuses.anonymousAsset = anonymousAsset.status(); assert.equal(anonymousAsset.status(), 401); checks.privateAssets = true;

  stage = "open-real-order-document"; const beforePrint = await domainSnapshot();
  await page.getByRole("link", { name: "Ordens de serviço", exact: true }).click();
  await page.getByRole("button", { name: `Imprimir comprovante da OS ${order.number}`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Comprovante da OS", exact: true }), paper = dialog.getByRole("region", { name: "Comprovante da ordem de serviço", exact: true });
  const print = dialog.getByRole("button", { name: "Imprimir comprovante", exact: true }); await expect(print).toBeEnabled();
  await decoded(paper.getByRole("img", { name: "Logotipo da loja", exact: true }));
  await expect(paper.getByTestId("order-watermark")).toHaveCSS("opacity", "0.12");
  await expect(paper.getByTestId("order-watermark")).toHaveAttribute("src", /^blob:/);
  await expect.poll(() => paper.getByTestId("order-watermark").evaluate((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(paper).toContainText(customer.name); await expect(paper).toContainText(order.equipment); await expect(paper).toContainText("159,90");
  await expect(paper).toContainText("Não é documento fiscal nem comprovante de pagamento."); checks.authenticatedImagesDecoded = true;

  stage = "print-and-artifacts";
  await page.evaluate(() => { const view = window as Window & { __brandingPrints?: number }; view.__brandingPrints = 0; view.print = () => { view.__brandingPrints = (view.__brandingPrints ?? 0) + 1; }; });
  await print.click(); assert.equal(await page.evaluate(() => (window as Window & { __brandingPrints?: number }).__brandingPrints), 1); checks.printCalledOnce = true;
  await mkdir(artifacts, { recursive: true });
  await paper.screenshot({ path: fileURLToPath(new URL("branding-e2e.png", artifacts)) });
  await page.pdf({ path: fileURLToPath(new URL("branding-e2e.pdf", artifacts)), format: "A4", preferCSSPageSize: true, printBackground: true }); checks.pdfAndScreenshot = true;
  assert.deepEqual(await domainSnapshot(), beforePrint); checks.printReadOnly = true;
  await dialog.getByRole("button", { name: "Fechar comprovante", exact: true }).click();
  await expect(dialog).toHaveCount(0); checks.closeDocument = true;
  stage = "complete"; success = true;
} catch (error) {
  process.exitCode = 1; const detail = error as { code?: unknown; stack?: string };
  failure = { code: typeof detail.code === "string" && /^[A-Z_0-9]+$/.test(detail.code) ? detail.code : undefined, location: detail.stack?.split("\n").find((line) => /branding-browser-smoke\.ts:\d+:\d+/.test(line))?.trim() };
} finally {
  for (const close of [() => anonymousContext?.close(), () => viewerContext?.close(), () => ownerContext?.close(), () => browser?.close(), () => app?.close(), () => fixture?.close()]) {
    try { await close(); } catch { cleanup = false; process.exitCode = 1; }
  }
  const result = { kind: "BRANDING_BROWSER_REAL", success: success && cleanup, stage, cleanup, failure, checks, statuses, brandingWrites, environment: "Chrome, API/cookies reais e PostgreSQL local isolado; figuras e cadastros fictícios" };
  await mkdir(artifacts, { recursive: true }); await writeFile(new URL("branding-e2e-result.json", artifacts), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
}
