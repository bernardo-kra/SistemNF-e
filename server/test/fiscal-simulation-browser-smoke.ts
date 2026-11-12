import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import type { Browser, BrowserContext } from "@playwright/test";
import { createFixture, TENANT_A, type Fixture } from "./helpers.ts";

if (!process.argv.includes("--run")) throw Error("Execute com --run após build, porta4000 livre; somente banco genérico isolado.");
const { chromium, expect } = createRequire(new URL("../../package.json", import.meta.url))("@playwright/test") as typeof import("@playwright/test");
const { buildApp } = await import(new URL("../dist/app.js", import.meta.url).href) as typeof import("../src/app.ts");
const origin = "http://127.0.0.1:4000", base = `/api/v1/tenants/${TENANT_A}`;
let fixture: Fixture | undefined, control: Pool | undefined, app: Awaited<ReturnType<typeof buildApp>> | undefined;
let browser: Browser | undefined, context: BrowserContext | undefined;
let success = false, cleanup = true, stage = "setup", commands = 0, otherFiscalWrites = 0;
let loadMs = 0, startMs = 0, reconcileMs = 0;

async function domainSnapshot() {
  const values = [];
  for (const table of ["operational_records", "stock_balances", "stock_movements", "finance_accounts", "finance_agreements", "finance_installments", "finance_payments", "finance_movements", "fiscal_records", "nfse_dps_counters", "nfse_dps_drafts", "nfse_a1_custody"])
    values.push((await fixture!.a.migrationPool.query(`SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) v FROM ${table} t`)).rows[0].v);
  return values;
}

try {
  fixture = await createFixture();
  await fixture.a.migrationPool.query("INSERT INTO tenant_admission(singleton,slot_id,tenant_id,claimed_at) VALUES(true,$1,$2,clock_timestamp())", [randomUUID(), TENANT_A]);
  const user = await fixture.user(); control = new Pool({ connectionString: fixture.control.runtimeUrl, max: 2 });
  app = await buildApp({ config: { ...fixture.config, frontendOrigin: origin, fiscalSimulatorEnabled: true }, controlPool: control, frontendRoot: fileURLToPath(new URL("../../out/", import.meta.url)), logger: false });
  await app.listen({ host: "127.0.0.1", port: 4000 }); browser = await chromium.launch({ channel: "chrome", headless: true }); context = await browser.newContext({ viewport: { width: 320, height: 1000 } });
  assert.equal((await context.request.post(origin + "/api/auth/sign-in/email", { headers: { origin }, data: { email: user.email, password: user.password } })).status(), 200);
  async function post(path: string, data: unknown, status = 200) {
    const response = await context!.request.post(origin + base + path, { headers: { origin }, data });
    assert.equal(response.status(), status); return response.json();
  }
  async function command(type: string, data: unknown) { return (await post("/operations/commands", { requestId: randomUUID(), type, data })).entity; }
  const customer = (await post("/customers", { name: "Cliente genérico QA", type: "Pessoa física" }, 201)).customer;
  const technician = await command("technician.create", { name: "Técnico genérico QA" });
  let order = await command("order.create", { customerId: customer.id, technicianId: technician.id, equipment: "Aparelho QA", issue: "Reparo QA", laborCents: 1250 });
  for (let i = 0; i < 2; i++) order = await command("order.advance", { id: order.id, version: order.version });
  order = await command("order.approve", { id: order.id, version: order.version, budgetRevision: order.budgetRevision, channel: "in_person" });
  const before = await domainSnapshot();
  const page = await context.newPage();
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith(base + "/fiscal/") && ["POST", "PATCH", "PUT", "DELETE"].includes(request.method())) {
      if (path.includes("/simulations")) commands++; else otherFiscalWrites++;
    }
  });
  stage = "simulation"; const openedAt = performance.now(); await page.goto(origin + "/fiscal/");
  await page.getByRole("button", { name: "Simulador", exact: true }).click();
  await expect(page.getByText("Simulação — sem validade fiscal", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "OS para simular", exact: true }).fill(String(order.number));
  await page.getByRole("option", { name: new RegExp(`OS ${order.number}.*Cliente genérico QA`) }).click();
  await page.getByLabel("Cenário de teste", { exact: true }).selectOption("unknown_after_accept");
  await expect(page.getByRole("button", { name: "Simular emissão", exact: true })).toBeEnabled(); loadMs = Math.round(performance.now() - openedAt);
  const startedAt = performance.now();
  await page.getByRole("button", { name: "Simular emissão", exact: true }).click();
  await expect(page.getByText("Resultado simulado desconhecido", { exact: true })).toBeVisible();
  startMs = Math.round(performance.now() - startedAt);
  const unknown = (await fixture.a.migrationPool.query("SELECT id,reference,state FROM fiscal_simulations")).rows;
  assert.equal(unknown.length, 1); assert.equal(unknown[0].state, "simulated_unknown");
  stage = "reconcile"; const reconciledAt = performance.now(); await page.getByRole("button", { name: "Consultar resultado simulado", exact: true }).click();
  await expect(page.getByText("Aceite simulado — sem validade fiscal", { exact: true })).toBeVisible();
  reconcileMs = Math.round(performance.now() - reconciledAt);
  const accepted = (await fixture.a.migrationPool.query("SELECT id,reference,state,version FROM fiscal_simulations")).rows;
  assert.equal(accepted.length, 1); assert.equal(accepted[0].id, unknown[0].id); assert.equal(accepted[0].reference, unknown[0].reference);
  assert.equal(accepted[0].state, "simulated_accepted"); assert.equal(accepted[0].version, 2);
  assert.equal((await fixture.a.migrationPool.query("SELECT count(*)::int n FROM fiscal_simulation_events")).rows[0].n, 2);
  assert.equal((await fixture.a.migrationPool.query("SELECT count(*)::int n FROM audit_events WHERE entity_type='fiscal_simulation'")).rows[0].n, 2);
  await page.reload(); await page.getByRole("button", { name: "Simulador", exact: true }).click();
  await page.getByRole("option", { name: new RegExp(`OS ${order.number}.*Cliente genérico QA`) }).click();
  await page.getByRole("button", { name: "Abrir simulação", exact: true }).click();
  await expect(page.getByText("Aceite simulado — sem validade fiscal", { exact: true })).toBeVisible();
  const directory = fileURLToPath(new URL("../.local/validation/", import.meta.url)); await mkdir(directory, { recursive: true });
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 1000 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: resolve(directory, `fiscal-simulator-real-${width}.png`), fullPage: true });
  }
  assert.deepEqual(await domainSnapshot(), before); assert.equal(commands, 2); assert.equal(otherFiscalWrites, 0);
  success = true;
} catch { console.error(JSON.stringify({ event: "fiscal.simulation.failed", stage, code: "VERIFICATION_FAILED" })); process.exitCode = 1; }
finally {
  for (const close of [() => context?.close(), () => browser?.close(), () => app?.close(), () => control?.end(), () => fixture?.close()]) {
    try { await close(); } catch { cleanup = false; process.exitCode = 1; }
  }
  console.log(JSON.stringify({ event: "fiscal.simulation.result", success, cleanup, stage, commands, otherFiscalWrites, loadMs, startMs, reconcileMs, compiledApi: true, officialTransmission: false }));
}
