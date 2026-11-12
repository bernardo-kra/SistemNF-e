import { expect, test, type Page } from "@playwright/test";
const tenant = "10000000-0000-4000-8000-000000000001";
const headers = { "access-control-allow-origin": "http://127.0.0.1:3000", "access-control-allow-credentials": "true" };
async function api(page: Page, options: { failOnce?: boolean; update?: boolean; approved?: boolean; longScope?: boolean } = {}) {
  const commands: any[] = [], calls: string[] = [];
  let row: any = { id: "30000000-0000-4000-8000-000000000003", number: 123, version: 4, customerId: "customer-qa", customerName: "Cliente QA", technicianId: "tech-qa", technicianName: "Técnico QA", equipment: "Aparelho QA", issue: "Examinar conector", diagnosis: "Diagnóstico técnico", due: null, laborCents: 2500, approved: options.approved ?? false, tested: false, stage: "awaiting_approval", budgetScope: "Trocar conector", budgetRevision: 2,
    budgetHistory: [{ revision: 1, scope: "Examinar conector", laborCents: null, source: "created", at: "2026-11-12T12:00:00Z", actorId: "qa", actorName: "Operador QA" }, { revision: 2, scope: "Trocar conector", laborCents: 2500, source: "revision", at: "2026-11-12T13:00:00Z", actorId: "qa", actorName: "Operador QA" }], createdAt: "2026-11-12T12:00:00Z", updatedAt: "2026-11-12T13:00:00Z" };
  if (options.longScope) row.budgetScope = "ServicoQA".repeat(180);
  await page.route("http://127.0.0.1:4000/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname; calls.push(path); let json: any;
    if (path.endsWith("/me")) json = { user: { id: "qa", name: "Operador QA", email: "qa@example.test" }, tenants: [{ id: tenant, name: "Loja QA", role: "owner", permissions: ["orders.read", "orders.advance", ...(options.update === false ? [] : ["orders.update"])] }] };
    else if (path.endsWith("/branding")) json = { branding: { version: 0, logo: null, background: null, backgroundOpacity: 10 } };
    else if (path.endsWith("/receipt")) json = { tenantId: tenant, companyName: "Loja QA", generatedAt: row.updatedAt, order: row, branding: { version: 0, logo: null, background: null, backgroundOpacity: 10 } };
    else if (path.endsWith("/technicians")) json = { tenantId: tenant, items: [{ id: "tech-qa", name: "Técnico QA" }], total: 1 };
    else if (path.endsWith("/commands")) {
      const input = route.request().postDataJSON(); commands.push(input);
      if (options.failOnce && commands.length === 1) { await route.fulfill({ status: 503, headers, json: { error: { code: "SERVICE_UNAVAILABLE" } } }); return; }
      row = { ...row, ...input.data, version: row.version + 1 };
      if (input.type === "order.approve") row = { ...row, approved: true, budgetApproval: { revision: row.budgetRevision, scope: row.budgetScope, laborCents: row.laborCents, channel: input.data.channel, reference: input.data.reference ?? "", customerName: row.customerName, customerId: row.customerId, at: row.updatedAt, actorId: "qa", actorName: "Operador QA" } };
      json = { entityType: "order", entity: row };
    } else json = { tenantId: tenant, items: [row], total: 1, limit: 25, offset: 0 };
    await route.fulfill({ headers, json });
  }); return { commands, calls };
}

for (const width of [1440, 320]) test(`OS-OV-UI01 aceite reaproveita cliente/escopo/valor e pede somente canal em ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 1000 }); const state = await api(page); await page.goto("/ordens/");
  const open = page.getByRole("button", { name: "Registrar aprovação", exact: true }); await expect(open).toBeVisible();
  const initialReads = state.calls.filter(x => x.endsWith("/operations/orders")).length;
  await open.click(); expect(state.calls.filter(x => x.endsWith("/operations/orders"))).toHaveLength(initialReads);
  const dialog = page.getByRole("dialog", { name: "Registrar aprovação", exact: true });
  await expect(dialog.getByText("Cliente QA", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Trocar conector", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/Orçamento 2.*R\$\s*25,00/)).toBeVisible();
  expect(state.calls.filter(x => x.endsWith("/technicians"))).toHaveLength(0);
  const channel = dialog.getByLabel("Como o cliente autorizou?", { exact: true }); await expect(channel).toHaveValue("");
  const count = state.calls.length; await channel.selectOption("whatsapp"); expect(state.calls).toHaveLength(count);
  await expect(dialog.getByLabel("Referência da autorização (opcional)", { exact: true })).not.toHaveAttribute("required");
  const confirm = dialog.getByRole("button", { name: "Confirmar aprovação", exact: true });
  for (const control of [channel, confirm]) { await control.scrollIntoViewIfNeeded(); const box = await control.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width); }
  await page.screenshot({ path: info.outputPath(`order-approval-${width}.png`), fullPage: true });
  if (width === 320) await confirm.press("Enter"); else await confirm.click(); await expect(dialog).toHaveCount(0);
  expect(state.commands).toHaveLength(1); expect(state.commands[0]).toMatchObject({ type: "order.approve", data: { version: 4, budgetRevision: 2, channel: "whatsapp" } });
  expect(state.commands[0].data).not.toHaveProperty("customerId"); expect(state.commands[0].data).not.toHaveProperty("laborCents");
  expect(state.calls.filter(x => x.endsWith("/operations/orders"))).toHaveLength(initialReads + 1);
  await page.getByRole("button", { name: "Imprimir comprovante da OS 123", exact: true }).click();
  const receipt = page.getByRole("dialog", { name: "Comprovante da OS", exact: true });
  await expect(receipt.getByText("Trocar conector", { exact: true })).toBeVisible();
  await expect(receipt.getByText(/WhatsApp/)).toBeVisible();
});

test("OS-OV-UI02 erro preserva canal/referência e repete o mesmo pedido; cancelar não grava", async ({ page }) => {
  const state = await api(page, { failOnce: true }); await page.goto("/ordens/");
  await page.getByRole("button", { name: "Registrar aprovação", exact: true }).click(); let dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click(); expect(state.commands).toHaveLength(0);
  await page.getByRole("button", { name: "Registrar aprovação", exact: true }).click(); dialog = page.getByRole("dialog");
  await dialog.getByLabel("Como o cliente autorizou?", { exact: true }).selectOption("phone");
  await dialog.getByLabel("Referência da autorização (opcional)", { exact: true }).fill("Conversa do atendimento QA");
  await dialog.getByRole("button", { name: "Confirmar aprovação", exact: true }).click(); await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("Como o cliente autorizou?", { exact: true })).toHaveValue("phone");
  await expect(dialog.getByLabel("Referência da autorização (opcional)", { exact: true })).toHaveValue("Conversa do atendimento QA");
  await dialog.getByRole("button", { name: "Confirmar aprovação", exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect(state.commands).toHaveLength(2); expect(state.commands[0]).toEqual(state.commands[1]);
  await page.getByRole("button", { name: "Editar OS", exact: true }).click();
  await expect(page.getByRole("dialog").getByText("Referência: Conversa do atendimento QA", { exact: true })).toBeVisible();
});

test("OS-OV-UI03 escopo tem campo próprio e histórico recolhido, orçamento aprovado bloqueia edição material", async ({ page }) => {
  const state = await api(page); await page.goto("/ordens/"); await page.getByRole("button", { name: "Editar OS", exact: true }).click();
  const dialog = page.getByRole("dialog"); await expect(dialog.getByLabel("Serviço proposto", { exact: true })).toHaveValue("Trocar conector");
  await dialog.getByText("Versões do orçamento", { exact: true }).click();
  await expect(dialog.getByText("Examinar conector", { exact: true })).toBeVisible();
  await dialog.getByLabel("Serviço proposto", { exact: true }).fill("Substituir conector e limpar placa");
  await dialog.getByRole("button", { name: "Salvar OS", exact: true }).click(); expect(state.commands[0].data.budgetScope).toBe("Substituir conector e limpar placa");
  await page.getByRole("button", { name: "Registrar aprovação", exact: true }).click();
  const approval = page.getByRole("dialog"); await approval.getByLabel("Como o cliente autorizou?", { exact: true }).selectOption("in_person"); await approval.getByRole("button", { name: "Confirmar aprovação", exact: true }).click();
  await page.getByRole("button", { name: "Editar OS", exact: true }).click();
  await expect(page.getByRole("dialog").getByLabel("Serviço proposto", { exact: true })).toBeDisabled();
  await expect(page.getByRole("dialog").getByLabel("Mão de obra", { exact: true })).toBeDisabled();
});

test("OS-OV-UI04 leitura sem edição não oferece aceite", async ({ page }) => {
  await api(page, { update: false }); await page.goto("/ordens/");
  await expect(page.getByRole("button", { name: "Registrar aprovação", exact: true })).toHaveCount(0);
});

test("OS-OV-UI05 escopo longo não transborda a confirmação no celular", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 1000 }); await api(page, { longScope: true }); await page.goto("/ordens/");
  await page.getByRole("button", { name: "Registrar aprovação", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Registrar aprovação", exact: true });
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
});
