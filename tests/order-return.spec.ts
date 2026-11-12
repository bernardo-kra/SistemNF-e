import { expect, test, type Page } from "@playwright/test";
const tenant = "10000000-0000-4000-8000-000000000001", orderId = "30000000-0000-4000-8000-000000000003";
const headers = { "access-control-allow-origin": "http://127.0.0.1:3000", "access-control-allow-credentials": "true" };
async function api(page: Page, options: { deliver?: boolean; failOnce?: boolean; stage?: string; approved?: boolean } = {}) {
  const calls: string[] = [], commands: any[] = [];
  let value: any = { id: orderId, number: 123, customerId: "qa-customer", customerName: "Cliente QA", equipment: "Aparelho QA", technicianName: "Técnico QA", due: "2100-01-01", laborCents: 1000, approved: options.approved ?? false, tested: false, stage: options.stage ?? "awaiting_approval", version: 3, createdAt: "2026-11-01T12:00:00Z", updatedAt: "2026-11-01T12:00:00Z" };
  await page.route("http://127.0.0.1:4000/**", async route => {
    const path = new URL(route.request().url()).pathname; calls.push(path); let json: any;
    if (path.endsWith("/me")) json = { user: { id: "qa", name: "Operador QA", email: "qa@example.test" }, tenants: [{ id: tenant, name: "Loja QA", role: "operator", permissions: ["customers.read", "orders.read", "orders.update", "orders.advance", ...(options.deliver === false ? [] : ["orders.deliver"])] }] };
    else if (path.endsWith("/branding")) json = { branding: { version: 0, logo: null, background: null, backgroundOpacity: 10 } };
    else if (path.endsWith("/receipt")) json = { tenantId: tenant, companyName: "Loja QA", generatedAt: "2026-11-08T12:30:00Z", order: value, branding: { version: 0, logo: null, background: null, backgroundOpacity: 10 } };
    else if (path.endsWith("/commands")) {
      const input = route.request().postDataJSON(); commands.push(input);
      if (options.failOnce && commands.length === 1) { await route.fulfill({ status: 503, headers, json: { error: { code: "SERVICE_UNAVAILABLE" } } }); return; }
      value = { ...value, stage: "closed_without_repair", version: 4, returnWithoutRepair: { reason: input.data.reason, details: input.data.details ?? "", recipientType: input.data.recipient.type, recipientName: input.data.recipient.type === "customer" ? value.customerName : input.data.recipient.name, authorization: input.data.recipient.authorization ?? "", actorId: "qa", actorName: "Operador QA", at: "2026-11-08T12:00:00Z" } };
      json = { tenantId: tenant, entityType: "order", entity: value };
    } else json = { tenantId: tenant, items: [value], total: 1, limit: 25, offset: 0 };
    await route.fulfill({ headers, json });
  }); return { calls, commands };
}
for (const width of [1440, 320]) test(`OS-SR-UI01 motivo e uma confirmação ao cliente conhecido em ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 1000 }); const state = await api(page); await page.goto("/ordens/");
  await page.getByRole("button", { name: "Devolver sem reparo", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Devolver equipamento sem reparo", exact: true }); await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Cliente QA/).first()).toBeVisible(); await expect(dialog.getByText(/Aparelho QA/).first()).toBeVisible();
  await dialog.getByLabel("Motivo da devolução", { exact: true }).selectOption("estimate_declined");
  await expect(dialog.getByLabel("Nome do retirante", { exact: true })).toHaveCount(0); expect(state.commands).toHaveLength(0);
  const save = dialog.getByRole("button", { name: "Confirmar devolução a Cliente QA", exact: true });
  await save.click(); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("cell").filter({ hasText: "Devolvida sem reparo" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Editar OS", exact: true })).toHaveCount(0); await expect(page.getByRole("button", { name: "Avançar etapa", exact: true })).toHaveCount(0);
  expect(state.commands).toHaveLength(1); expect(state.commands[0].type).toBe("order.return_without_repair");
  expect(state.commands[0].data).toMatchObject({ id: orderId, version: 3, reason: "estimate_declined", recipient: { type: "customer" }, confirmed: true });
  expect(state.commands[0].data.recipient.name).toBeUndefined(); expect(state.calls.some(path => /\/customers|\/technicians|\/finance\//.test(path))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath(`order-return-${width}.png`), fullPage: true });
});
test("OS-SR-UI02 outro retirante/motivo só pede os complementos necessários", async ({ page }) => {
  const state = await api(page); await page.goto("/ordens/"); await page.getByRole("button", { name: "Devolver sem reparo", exact: true }).click();
  const dialog = page.getByRole("dialog"); await dialog.getByLabel("Motivo da devolução", { exact: true }).selectOption("other");
  await dialog.getByLabel("Detalhe do motivo", { exact: true }).fill("Serviço não disponível nesta unidade");
  await dialog.getByLabel("Outra pessoa vai retirar", { exact: true }).check(); await dialog.getByLabel("Nome do retirante", { exact: true }).fill("Retirante QA");
  await dialog.getByLabel("Autorização da retirada", { exact: true }).fill("Cliente autorizou pelo contato cadastrado");
  await dialog.getByRole("button", { name: "Confirmar devolução a Retirante QA", exact: true }).click();
  await expect(dialog).toHaveCount(0); expect(state.commands[0].data.recipient).toEqual({ type: "other", name: "Retirante QA", authorization: "Cliente autorizou pelo contato cadastrado" });
});
test("OS-SR-UI03 falha mantém motivo/retirante e ID da tentativa; cancelar não escreve", async ({ page }) => {
  const state = await api(page, { failOnce: true }); await page.goto("/ordens/"); await page.getByRole("button", { name: "Devolver sem reparo", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancelar", exact: true }).click(); expect(state.commands).toHaveLength(0);
  await page.getByRole("button", { name: "Devolver sem reparo", exact: true }).click(); const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Motivo da devolução", { exact: true }).selectOption("customer_withdrew");
  await dialog.getByRole("button", { name: "Confirmar devolução a Cliente QA", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible(); await expect(dialog.getByLabel("Motivo da devolução", { exact: true })).toHaveValue("customer_withdrew");
  await dialog.getByRole("button", { name: "Confirmar devolução a Cliente QA", exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect(state.commands).toHaveLength(2); expect(state.commands[0]).toEqual(state.commands[1]);
});
test("OS-SR-UI04 sem direito, com aprovação e encerrada não oferecem devolução indevida", async ({ page }) => {
  for (const option of [{ deliver: false }, { approved: true }, { stage: "in_progress" }, { stage: "closed_without_repair" }]) {
    await page.unrouteAll({ behavior: "wait" }); const state = await api(page, option); await page.goto("/ordens/"); await expect(page.getByText("Aparelho QA", { exact: false }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Devolver sem reparo", exact: true })).toHaveCount(0); expect(state.commands).toHaveLength(0);
  }
});
test("OS-SR-UI05 confirmação e motivo ficam dentro do celular antes de concluir", async ({ page }, info) => {
  const width = 320; await page.setViewportSize({ width, height: 1000 }); await api(page); await page.goto("/ordens/");
  await page.getByRole("button", { name: "Devolver sem reparo", exact: true }).click(); const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Motivo da devolução", { exact: true }).selectOption("repair_unavailable");
  for (const control of [dialog.getByLabel("Motivo da devolução", { exact: true }), dialog.getByRole("button", { name: "Confirmar devolução a Cliente QA", exact: true })]) {
    const box = await control.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  }
  await page.screenshot({ path: info.outputPath("order-return-dialog-320.png"), fullPage: true });
});
test("OS-SR-UI06 comprovante diferencia o instante da retirada do momento de imprimir", async ({ page }) => {
  await api(page); await page.goto("/ordens/"); await page.getByRole("button", { name: "Devolver sem reparo", exact: true }).click();
  const dialog = page.getByRole("dialog"); await dialog.getByLabel("Motivo da devolução", { exact: true }).selectOption("estimate_declined");
  await dialog.getByRole("button", { name: "Confirmar devolução a Cliente QA", exact: true }).click(); await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Imprimir comprovante da OS 123", exact: true }).click();
  const receipt = page.getByRole("dialog", { name: "Comprovante da OS", exact: true });
  await expect(receipt.getByText(/^Retirado por:/)).toContainText("08/11/2026, 09:00");
  await expect(receipt.getByText(/^Comprovante gerado em/)).toContainText("09:30");
});
