import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Browser, BrowserContext } from "@playwright/test";
import { Pool } from "pg";
import { createFixture, TENANT_A, type Fixture } from "./helpers.ts";

// Explicit local-only integration: Chrome → compiled app → isolated generic PostgreSQL.
if (!process.argv.includes("--run")) throw new Error("Execute com --run após o build, com a porta 4000 livre.");
const { chromium, expect } = createRequire(new URL("../../package.json", import.meta.url))("@playwright/test") as typeof import("@playwright/test");
const { buildApp } = await import(new URL("../dist/app.js", import.meta.url).href) as typeof import("../src/app.ts");
const origin = "http://127.0.0.1:4000", base = `${origin}/api/v1/tenants/${TENANT_A}`;
let fixture: Fixture | undefined, control: Pool | undefined, app: Awaited<ReturnType<typeof buildApp>> | undefined;
let browser: Browser | undefined, context: BrowserContext | undefined;
let success = false, cleanup = true, stage = "setup", commands = 0, reads = 0, technicianReads = 0, observedReturnMs = 0;
try {
  fixture = await createFixture();
  await fixture.a.migrationPool.query("INSERT INTO tenant_admission(singleton,slot_id,tenant_id,claimed_at) VALUES(true,$1,$2,clock_timestamp())", [randomUUID(), TENANT_A]);
  const actor = await fixture.user(); control = new Pool({ connectionString: fixture.control.runtimeUrl, max: 2 });
  app = await buildApp({ config: { ...fixture.config, frontendOrigin: origin }, controlPool: control, frontendRoot: fileURLToPath(new URL("../../out/", import.meta.url)), logger: false });
  await app.listen({ host: "127.0.0.1", port: 4000 }); browser = await chromium.launch({ channel: "chrome", headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); stage = "seed";
  assert.equal((await context.request.post(origin + "/api/auth/sign-in/email", { headers: { origin }, data: { email: actor.email, password: actor.password } })).status(), 200);
  const created = await context.request.post(base + "/customers", { headers: { origin }, data: { name: "Cliente fictício QA", type: "Pessoa física" } });
  assert.equal(created.status(), 201); const customer = (await created.json()).customer;
  async function command(type: string, data: unknown) {
    const response = await context!.request.post(base + "/operations/commands", { headers: { origin }, data: { requestId: randomUUID(), type, data } });
    assert.equal(response.status(), 200); return (await response.json()).entity;
  }
  const tech = await command("technician.create", { name: "Técnico fictício QA" });
  let order = await command("order.create", { customerId: customer.id, technicianId: tech.id, equipment: "Equipamento fictício QA", issue: "Não liga", due: "2100-01-01", laborCents: 1000 });
  order = await command("order.advance", { id: order.id, version: order.version }); order = await command("order.advance", { id: order.id, version: order.version });
  const before = (await fixture.a.migrationPool.query("SELECT count(*)::int n FROM audit_events")).rows[0].n;
  const page = await context.newPage();
  page.on("request", request => { const path = new URL(request.url()).pathname; if (path.endsWith("/operations/commands")) commands++; if (path.endsWith("/operations/orders")) reads++; if (path.endsWith("/operations/technicians")) technicianReads++; });
  stage = "return"; await page.goto(origin + "/ordens/"); await expect(page.getByRole("button", { name: "Devolver sem reparo", exact: true })).toBeVisible();
  const initialReads = reads, start = performance.now(); await page.getByRole("button", { name: "Devolver sem reparo", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Devolver equipamento sem reparo", exact: true }); await dialog.getByLabel("Motivo da devolução", { exact: true }).selectOption("estimate_declined");
  assert.equal(reads, initialReads); assert.equal(commands, 0);
  await dialog.getByRole("button", { name: "Confirmar devolução a Cliente fictício QA", exact: true }).click();
  await expect(dialog).toHaveCount(0); await expect(page.getByRole("cell").filter({ hasText: "Devolvida sem reparo" })).toBeVisible(); observedReturnMs = Math.round(performance.now() - start);
  assert.equal(commands, 1); assert.equal(reads, initialReads + 1);
  await expect(page.getByRole("button", { name: "Editar OS", exact: true })).toHaveCount(0);
  const stored = (await fixture.a.migrationPool.query("SELECT body,updated_by FROM operational_records WHERE id=$1", [order.id])).rows[0];
  assert.equal(stored.body.stage, "closed_without_repair"); assert.equal(stored.body.approved, false); assert.equal(stored.body.tested, false);
  assert.equal(stored.body.laborCents, 1000); assert.equal(stored.body.returnWithoutRepair.recipientName, customer.name); assert.equal(stored.updated_by, actor.id);
  assert.equal((await fixture.a.migrationPool.query("SELECT count(*)::int n FROM audit_events")).rows[0].n, before + 1);
  for (const table of ["finance_payments", "finance_agreements", "finance_movements", "stock_movements"])
    assert.equal((await fixture.a.migrationPool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n, 0);
  const report = await context.request.get(base + "/reports/orders?from=1900-01-01&to=9999-12-31&stage=closed_without_repair");
  assert.equal(report.status(), 200); assert.equal((await report.json()).totals.count, 1);
  const directory = fileURLToPath(new URL("../.local/validation/", import.meta.url)); await mkdir(directory, { recursive: true }); stage = "layout";
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 1000 }); await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); window.scrollTo(0, 0); });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.screenshot({ path: resolve(directory, `order-return-real-${width}.png`), fullPage: true });
  }
  stage = "receipt"; await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Imprimir comprovante da OS 1", exact: true }).click();
  const receipt = page.getByRole("dialog", { name: "Comprovante da OS", exact: true });
  await expect(receipt.getByText("Devolvida sem reparo", { exact: true })).toBeVisible();
  await expect(receipt.getByText("Orçamento recusado", { exact: true })).toBeVisible(); await expect(receipt.getByText("Valor proposto (serviço não executado)", { exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(directory, "order-return-receipt-real.png"), fullPage: true });
  await receipt.getByRole("button", { name: "Fechar comprovante", exact: true }).click();
  assert.equal(commands, 1); assert.equal((await fixture.a.migrationPool.query("SELECT count(*)::int n FROM audit_events")).rows[0].n, before + 1);
  // Budget regression in the same isolated app: unknown is not a free service.
  stage = "budget";
  let pending = await command("order.create", { customerId: customer.id, technicianId: tech.id, equipment: "Orçamento pendente QA", issue: "Examinar QA", due: "2100-01-01", laborCents: null });
  pending = await command("order.advance", { id: pending.id, version: pending.version });
  pending = await command("order.advance", { id: pending.id, version: pending.version });
  const budgetBefore = (await fixture.a.migrationPool.query("SELECT count(*)::int n FROM audit_events")).rows[0].n;
  await page.reload();
  await expect(page.getByRole("cell", { name: "Orçamento pendente", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Registrar aprovação", exact: true })).toBeDisabled();
  const pendingReport = await context.request.get(base + "/reports/orders?from=1900-01-01&to=9999-12-31");
  assert.equal(pendingReport.status(), 200); assert.equal((await pendingReport.json()).totals.unpricedCount, 1);
  const budgetCommands = commands;
  await page.getByRole("button", { name: "Editar OS", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Editar OS", exact: true });
  const labor = editor.getByLabel("Mão de obra", { exact: true }); await expect(labor).toHaveValue("");
  const budgetReads = reads; await labor.fill("0");
  await editor.getByLabel("Serviço proposto", { exact: true }).fill("Inspeção e limpeza gratuitas QA");
  assert.equal(reads, budgetReads); assert.equal(commands, budgetCommands);
  await page.setViewportSize({ width: 320, height: 1000 }); await labor.scrollIntoViewIfNeeded();
  const box = await labor.boundingBox(); assert.ok(box && box.x >= 0 && box.x + box.width <= 320);
  await page.screenshot({ path: resolve(directory, "order-budget-real-320.png"), fullPage: true });
  await editor.getByRole("button", { name: "Salvar OS", exact: true }).click(); await expect(editor).toHaveCount(0);
  assert.equal(commands, budgetCommands + 1); assert.equal(reads, budgetReads + 1);
  await expect(page.getByRole("button", { name: "Registrar aprovação", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Registrar aprovação", exact: true }).click();
  const approval = page.getByRole("dialog", { name: "Registrar aprovação", exact: true });
  const approvalReads = reads, approvalTechnicians = technicianReads;
  const approvalStarted = performance.now();
  await approval.getByLabel("Como o cliente autorizou?", { exact: true }).selectOption("phone");
  assert.equal(reads, approvalReads); assert.equal(technicianReads, approvalTechnicians);
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({ path: resolve(directory, `order-approval-real-${width}.png`), fullPage: true });
  }
  await approval.getByRole("button", { name: "Confirmar aprovação", exact: true }).click();
  await expect(approval).toHaveCount(0);
  assert.equal(reads, approvalReads + 1);
  const observedApprovalMs = Math.round(performance.now() - approvalStarted);
  console.log(JSON.stringify({ stage: "budget_approval", budgetRevision: 2, additionalWrites: 1, additionalReads: 1, technicianReads: 0, observedApprovalMs, includesAutomationAndScreenshots: true }));
  await expect(page.getByRole("button", { name: "Registrar aprovação", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Avançar etapa", exact: true }).click();
  await expect(page.getByRole("cell").filter({ hasText: "Em execução" })).toBeVisible();
  const free = (await fixture.a.migrationPool.query("SELECT body,version FROM operational_records WHERE id=$1", [pending.id])).rows[0];
  assert.equal(free.body.laborCents, 0); assert.equal(free.body.approved, true); assert.equal(free.body.stage, "in_progress");
  assert.equal(free.body.budgetRevision, 2); assert.equal(free.body.budgetHistory.length, 2);
  assert.equal(free.body.budgetHistory[0].laborCents, null); assert.equal(free.body.budgetHistory[0].scope, "Examinar QA");
  assert.equal(free.body.budgetApproval.revision, 2); assert.equal(free.body.budgetApproval.channel, "phone");
  assert.equal(free.body.budgetApproval.scope, "Inspeção e limpeza gratuitas QA"); assert.equal(free.body.budgetApproval.actorId, actor.id);
  assert.equal(free.version, pending.version + 3); assert.equal(commands, budgetCommands + 3);
  assert.equal((await fixture.a.migrationPool.query("SELECT count(*)::int n FROM audit_events")).rows[0].n, budgetBefore + 3);
  for (const table of ["finance_payments", "finance_agreements", "finance_movements", "stock_movements"])
    assert.equal((await fixture.a.migrationPool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n, 0);
  // Intake regression in the same compiled app: no assignment, promise or price is invented.
  stage = "intake_create";
  const intakeCommands = commands, intakeReads = reads;
  const intakeAudit = (await fixture.a.migrationPool.query("SELECT count(*)::int n FROM audit_events")).rows[0].n;
  await page.getByRole("button", { name: "Nova OS", exact: true }).click();
  const intake = page.getByRole("dialog", { name: "Nova OS", exact: true });
  for (const label of ["Técnico responsável", "Previsão", "Mão de obra"])
    await expect(intake.getByLabel(label, { exact: true })).toHaveValue("");
  await intake.getByRole("combobox", { name: "Cliente", exact: true }).fill(customer.name);
  await intake.getByRole("option", { name: new RegExp(customer.name) }).click();
  await intake.getByLabel("Equipamento", { exact: true }).fill("Recebimento mínimo QA");
  await intake.getByLabel("Serviço solicitado", { exact: true }).fill("Examinar aparelho QA");
  await intake.getByRole("button", { name: "Salvar OS", exact: true }).click(); await expect(intake).toHaveCount(0);
  await expect(page.getByRole("cell").filter({ hasText: "Recebimento mínimo QA" })).toBeVisible();
  assert.equal(commands, intakeCommands + 1); assert.equal(reads, intakeReads + 1);
  const received = (await fixture.a.migrationPool.query("SELECT id,body,version FROM operational_records WHERE entity_type='order' AND body->>'equipment'='Recebimento mínimo QA'")).rows[0];
  for (const field of ["technicianId", "technicianName", "due", "laborCents"]) assert.equal(received.body[field], null);
  assert.equal(received.body.stage, "received");
  stage = "intake_receipt";
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: `Imprimir comprovante da OS ${received.body.number}`, exact: true }).click();
  const pendingReceipt = page.getByRole("dialog", { name: "Comprovante da OS", exact: true });
  await expect(pendingReceipt.getByText("Técnico a definir", { exact: true })).toBeVisible();
  await expect(pendingReceipt.getByText("Sem previsão", { exact: true })).toBeVisible();
  await expect(pendingReceipt.getByText("Valor a definir", { exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(directory, "order-intake-receipt-real.png"), fullPage: true });
  await pendingReceipt.getByRole("button", { name: "Fechar comprovante", exact: true }).click();
  const techniciansBefore = technicianReads;
  stage = "intake_assignment";
  await page.setViewportSize({ width: 320, height: 1000 });
  await page.getByRole("button", { name: "Iniciar diagnóstico", exact: true }).click();
  const assignment = page.getByRole("dialog", { name: "Iniciar diagnóstico", exact: true });
  await expect(assignment.getByRole("option", { name: tech.name, exact: true })).toHaveCount(1);
  assert.equal(technicianReads, techniciansBefore + 1);
  await assignment.getByLabel("Técnico responsável", { exact: true }).selectOption(tech.id);
  assert.equal(technicianReads, techniciansBefore + 1); assert.equal(commands, intakeCommands + 1); assert.equal(reads, intakeReads + 1);
  await page.screenshot({ path: resolve(directory, "order-intake-assignment-real-320.png"), fullPage: true });
  await assignment.getByRole("button", { name: "Iniciar diagnóstico", exact: true }).click(); await expect(assignment).toHaveCount(0);
  await expect(page.getByRole("cell").filter({ hasText: "Em diagnóstico" })).toBeVisible();
  assert.equal(commands, intakeCommands + 2); assert.equal(reads, intakeReads + 2);
  const assigned = (await fixture.a.migrationPool.query("SELECT body,version FROM operational_records WHERE id=$1", [received.id])).rows[0];
  assert.equal(assigned.body.technicianId, tech.id); assert.equal(assigned.body.technicianName, tech.name);
  assert.equal(assigned.body.stage, "diagnosing"); assert.equal(assigned.body.due, null); assert.equal(assigned.body.laborCents, null);
  assert.equal(assigned.version, received.version + 1);
  assert.equal((await fixture.a.migrationPool.query("SELECT count(*)::int n FROM audit_events")).rows[0].n, intakeAudit + 2);
  for (const table of ["finance_payments", "finance_agreements", "finance_movements", "stock_movements"])
    assert.equal((await fixture.a.migrationPool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n, 0);
  success = true;
} catch {
  console.error(JSON.stringify({ event: "order.return.browser.failed", stage, code: "VERIFICATION_FAILED" })); process.exitCode = 1;
} finally {
  for (const close of [() => context?.close(), () => browser?.close(), () => app?.close(), () => control?.end(), () => fixture?.close()]) {
    try { await close(); } catch { cleanup = false; process.exitCode = 1; }
  }
  console.log(JSON.stringify({ event: "order.return.browser.result", success, cleanup, stage, commands, reads, observedReturnMs, compiledApi: true }));
}
