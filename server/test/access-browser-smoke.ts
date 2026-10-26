import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { createFixture, ORIGIN, PASSWORD, TENANT_A, type Fixture, type TestApp } from "./helpers.ts";

// Smoke explícito: Chrome -> HTTP/cookie -> Better Auth -> PostgreSQL isolado.
// Não usa mocks, trace com credenciais, contas reais ou dados do protótipo.
const { chromium, expect } = createRequire(new URL("../../package.json", import.meta.url))("@playwright/test") as typeof import("@playwright/test");
const artifacts = new URL("../.local/validation/", import.meta.url);
const pictures = new URL("../../docs/evidencias/", import.meta.url);
const api = "http://127.0.0.1:4000";
let fixture: Fixture | undefined, app: TestApp | undefined, browser: Browser | undefined;
let managerContext: BrowserContext | undefined, employeeContext: BrowserContext | undefined;
let stage = "prepare", succeeded = false;
const traffic: { method: string; resource: string }[] = [];
const statuses: Record<string, number> = {};
let navigations = 0, createToVisibleMs: number | undefined;
async function enter(page: Page, email: string, password: string) {
  await page.goto(`${ORIGIN}/acessos/`);
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
}

try {
  fixture = await createFixture();
  const owner = await fixture.user();
  app = await fixture.app();
  await app.instance.listen({ host: "127.0.0.1", port: 4000 });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  managerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  statuses.ready = (await managerContext.request.get(`${api}/health/ready`)).status();
  assert.equal(statuses.ready, 200);
  const manager = await managerContext.newPage();
  manager.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin === api && request.method() !== "OPTIONS") {
      const suffix = url.pathname.split("/").at(-1) ?? "";
      traffic.push({ method: request.method(), resource: ["me", "members", "access-options", "access-audit"].includes(suffix) ? suffix : url.pathname.includes("/members/") ? "member" : url.pathname.includes("sign-in") ? "login" : "logout" });
    }
  });
  stage = "manager-login";
  await enter(manager, owner.email, owner.password);
  await expect(manager.getByRole("button", { name: "Novo funcionário", exact: true })).toBeVisible();
  manager.on("framenavigated", (frame) => { if (frame === manager.mainFrame()) navigations++; });
  const email = `smoke-${randomUUID()}@example.test`, employeeName = "Funcionário smoke real";
  stage = "employee-create";
  await manager.getByRole("button", { name: "Novo funcionário", exact: true }).click();
  let dialog = manager.getByRole("dialog");
  await dialog.getByLabel("Nome", { exact: true }).fill(employeeName);
  await dialog.getByLabel("E-mail", { exact: true }).fill(email);
  await dialog.getByLabel("Senha inicial", { exact: true }).fill(PASSWORD);
  await dialog.getByLabel("Perfil", { exact: true }).selectOption("viewer");
  const creating = performance.now();
  await dialog.getByRole("button", { name: "Salvar funcionário", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(manager.getByText(employeeName, { exact: true }).first()).toBeVisible();
  createToVisibleMs = Math.round(performance.now() - creating);
  assert.equal(traffic.filter((request) => request.method === "POST" && request.resource === "members").length, 1);
  const identity = await fixture.control.migrationPool.query('SELECT id FROM "user" WHERE email=$1', [email]);
  assert.equal(identity.rowCount, 1);

  stage = "employee-login-and-denial";
  employeeContext = await browser.newContext();
  const employee = await employeeContext.newPage();
  await enter(employee, email, PASSWORD);
  await expect(employee.getByText("Seu perfil não permite administrar a equipe.", { exact: true })).toBeVisible();
  const customers = `${api}/api/v1/tenants/${TENANT_A}/customers`;
  const customer = { name: "Cliente smoke fictício", type: "Empresa" };
  statuses.readBeforeGrant = (await employeeContext.request.get(customers)).status();
  statuses.createBeforeGrant = (await employeeContext.request.post(customers, { headers: { origin: ORIGIN }, data: customer })).status();
  assert.equal(statuses.readBeforeGrant, 200); assert.equal(statuses.createBeforeGrant, 403);

  stage = "grant-through-ui";
  const edit = manager.getByRole("button", { name: `Editar acessos de ${employeeName}`, exact: true });
  await edit.click(); dialog = manager.getByRole("dialog");
  await dialog.getByText("Personalizar permissões de clientes", { exact: true }).click();
  await dialog.getByLabel(/^(?:Cadastrar|Criar) clientes$/).check();
  await dialog.getByRole("button", { name: "Salvar acessos", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  statuses.createAfterGrant = (await employeeContext.request.post(customers, { headers: { origin: ORIGIN }, data: customer })).status();
  assert.equal(statuses.createAfterGrant, 201);

  stage = "revoke-through-ui";
  await expect(manager.getByText("Permissões personalizadas", { exact: true })).toBeVisible();
  await mkdir(pictures, { recursive: true });
  await manager.screenshot({ path: fileURLToPath(new URL("equipe-acessos.png", pictures)), fullPage: true });
  await edit.click(); dialog = manager.getByRole("dialog");
  await dialog.getByLabel("Acesso ativo", { exact: true }).uncheck();
  await dialog.getByRole("button", { name: "Salvar acessos", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  statuses.readAfterRevoke = (await employeeContext.request.get(customers)).status();
  assert.equal(statuses.readAfterRevoke, 403);
  const membership = await fixture.control.migrationPool.query("SELECT active,version FROM memberships WHERE tenant_id=$1 AND user_id=$2", [TENANT_A, identity.rows[0].id]);
  assert.equal(membership.rows[0].active, false); assert.equal(membership.rows[0].version, 3);
  assert.equal((await fixture.a.migrationPool.query("SELECT count(*)::int AS count FROM customers WHERE name=$1", [customer.name])).rows[0].count, 1);

  stage = "mobile-evidence";
  await expect(manager.getByText("Inativo", { exact: true })).toBeVisible();
  await manager.setViewportSize({ width: 390, height: 844 });
  await edit.click(); dialog = manager.getByRole("dialog");
  await expect(dialog.getByLabel("Acesso ativo", { exact: true })).not.toBeChecked();
  await manager.screenshot({ path: fileURLToPath(new URL("equipe-acessos-mobile.png", pictures)), fullPage: true });
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await manager.setViewportSize({ width: 1440, height: 1000 });

  stage = "manager-logout";
  await manager.getByRole("button", { name: "Sair", exact: true }).click();
  await expect(manager.getByLabel("E-mail", { exact: true })).toBeVisible();
  statuses.meAfterLogout = (await managerContext.request.get(`${api}/api/v1/me`)).status();
  assert.equal(statuses.meAfterLogout, 401);
  assert.equal(navigations, 0);
  succeeded = true; stage = "complete";
} catch {
  // A failing assertion can carry cookies or synthetic PII; expose only the fixed stage.
  process.exitCode = 1;
} finally {
  let cleanup = true;
  for (const close of [() => employeeContext?.close(), () => managerContext?.close(), () => browser?.close(), () => app?.close(), () => fixture?.close()]) {
    try { await close(); } catch { cleanup = false; process.exitCode = 1; }
  }
  const result = { kind: "ACC_BROWSER_REAL", success: succeeded && cleanup, stage, cleanup,
    environment: "Chrome local, loopback HTTP, Better Auth, PostgreSQL isolado, dados fictícios", statuses,
    managerApiRequests: traffic.length, requests: traffic, managerDocumentNavigations: navigations, createToVisibleMs,
    evidenceOnlyUiActions: 2 };
  await mkdir(artifacts, { recursive: true });
  await writeFile(new URL("access-browser-real-result.json", artifacts), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
