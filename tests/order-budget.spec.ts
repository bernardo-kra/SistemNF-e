import { expect, test, type Page } from "@playwright/test";
const tenant = "10000000-0000-4000-8000-000000000001";
const headers = { "access-control-allow-origin": "http://127.0.0.1:3000", "access-control-allow-credentials": "true" };
async function api(page: Page, options: { labor?: number | null; approved?: boolean; failOnce?: boolean; update?: boolean } = {}) {
  const calls: string[] = [], commands: any[] = [];
  let value: any = { id: "30000000-0000-4000-8000-000000000003", number: 123, customerId: "customer-qa", customerName: "Cliente QA", technicianId: "tech-qa", technicianName: "Técnico QA", equipment: "Aparelho QA", issue: "Diagnóstico QA", diagnosis: "", due: "2100-01-01", laborCents: options.labor === undefined ? null : options.labor, approved: options.approved ?? false, tested: false, stage: "awaiting_approval", version: 3, createdAt: "2026-11-01T12:00:00Z", updatedAt: "2026-11-01T12:00:00Z" };
  await page.route("http://127.0.0.1:4000/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname; calls.push(path); let json: any;
    if (path.endsWith("/me")) json = { user: { id: "qa", name: "Operador QA", email: "qa@example.test" }, tenants: [{ id: tenant, name: "Loja QA", role: "owner", permissions: ["customers.read", "orders.read", "orders.create", "orders.advance", "orders.deliver", "finance.read", "finance.agreements.create", ...(options.update === false ? [] : ["orders.update"])] }] };
    else if (path.endsWith("/branding")) json = { branding: { version: 0, logo: null, background: null, backgroundOpacity: 10 } };
    else if (path.endsWith("/receipt")) json = { tenantId: tenant, companyName: "Loja QA", generatedAt: "2026-11-09T12:00:00Z", order: value, branding: { version: 0, logo: null, background: null, backgroundOpacity: 10 } };
    else if (path.endsWith("/technicians")) json = { tenantId: tenant, items: [{ id: "tech-qa", name: "Técnico QA" }], total: 1 };
    else if (path.endsWith("/customers")) json = { tenantId: tenant, items: [{ id: "customer-qa", name: "Cliente QA", phone: "", email: "", active: true }], total: 1 };
    else if (path.endsWith("/commands")) {
      const input = route.request().postDataJSON(); commands.push(input);
      if (options.failOnce && commands.length === 1) { await route.fulfill({ status: 503, headers, json: { error: { code: "SERVICE_UNAVAILABLE" } } }); return; }
      value = { ...value, ...input.data, version: value.version + 1 }; json = { tenantId: tenant, entityType: "order", entity: value };
    } else if (path.includes("/reports/orders")) json = { tenantId: tenant, filters: { from: url.searchParams.get("from"), to: url.searchParams.get("to"), q: "", stage: "all", approval: "all" }, generatedAt: "2026-11-09T12:00:00Z", limit: 25, offset: 0,
      totals: { count: 2, laborCents: 0, approvedCents: 0, unapprovedCents: 0, unpricedCount: 1 },
      items: [value, { ...value, id: "free-qa", number: 124, equipment: "Gratuito QA", laborCents: 0 }].map(item => ({ ...item, at: item.createdAt, date: "2026-11-01" })) };
    else if (path.includes("/reports/")) json = { tenantId: tenant, filters: { from: "2026-11-01", to: "2026-11-30", q: "", method: "" }, generatedAt: "2026-11-09T12:00:00Z", limit: 25, offset: 0, totals: { count: 0, amountCents: 0 }, items: [] };
    else json = { tenantId: tenant, items: [value], total: 1, limit: 25, offset: 0 };
    await route.fulfill({ headers, json });
  }); return { calls, commands };
}

for (const width of [1440, 320]) test(`OS-OP-UI01 preço pendente não vira zero e pode ser definido em ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 1000 }); const state = await api(page); await page.goto("/ordens/");
  await expect(page.getByRole("cell", { name: "Orçamento pendente", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Registrar aprovação", exact: true })).toBeDisabled();
  await expect(page.getByText("Defina a mão de obra em Editar OS antes de registrar a aprovação.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Editar OS", exact: true }).click(); const dialog = page.getByRole("dialog");
  const input = dialog.getByLabel("Mão de obra", { exact: true }); await expect(input).toHaveValue(""); await expect(input).not.toHaveAttribute("required");
  await input.fill("12,50"); const save = dialog.getByRole("button", { name: "Salvar OS", exact: true });
  for (const control of [input, save]) { await control.scrollIntoViewIfNeeded(); const box = await control.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width); }
  await page.screenshot({ path: info.outputPath(`order-budget-${width}.png`), fullPage: true });
  await save.click(); await expect(dialog).toHaveCount(0); expect(state.commands).toHaveLength(1); expect(state.commands[0].data.laborCents).toBe(1250);
  await expect(page.getByRole("button", { name: "Registrar aprovação", exact: true })).toBeEnabled();
});

test("OS-OP-UI02 nova OS deixa valor vazio, cliente conhecido e uma gravação sem preço inventado", async ({ page }) => {
  const state = await api(page); await page.goto("/ordens/"); await page.getByRole("button", { name: "Nova OS", exact: true }).click(); const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Mão de obra", { exact: true })).toHaveValue("");
  await dialog.getByRole("combobox", { name: "Cliente", exact: true }).fill("Cliente QA"); await dialog.getByRole("option", { name: /Cliente QA/ }).click();
  await dialog.getByLabel("Técnico responsável", { exact: true }).selectOption("tech-qa");
  await dialog.getByLabel("Equipamento", { exact: true }).fill("Aparelho novo QA"); await dialog.getByLabel("Serviço solicitado", { exact: true }).fill("Examinar QA");
  await dialog.getByRole("button", { name: "Salvar OS", exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect(state.commands).toHaveLength(1); expect(state.commands[0].data.laborCents).toBeNull(); expect(state.commands[0].data.customerId).toBe("customer-qa");
});

test("OS-OP-UI03 limpar proposta preserva null e ID após falha; cancelar não escreve", async ({ page }) => {
  const state = await api(page, { labor: 1250, failOnce: true }); await page.goto("/ordens/"); await page.getByRole("button", { name: "Editar OS", exact: true }).click(); let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Mão de obra", { exact: true }).fill(""); await dialog.getByRole("button", { name: "Cancelar", exact: true }).click(); expect(state.commands).toHaveLength(0);
  await page.getByRole("button", { name: "Editar OS", exact: true }).click(); dialog = page.getByRole("dialog"); await expect(dialog.getByLabel("Mão de obra", { exact: true })).toHaveValue("12,50");
  await dialog.getByLabel("Mão de obra", { exact: true }).fill(""); await dialog.getByRole("button", { name: "Salvar OS", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible(); await expect(dialog.getByLabel("Mão de obra", { exact: true })).toHaveValue("");
  await dialog.getByRole("button", { name: "Salvar OS", exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect(state.commands).toHaveLength(2); expect(state.commands[0]).toEqual(state.commands[1]); expect(state.commands[0].data.laborCents).toBeNull();
});

test("OS-OP-UI04 valor zero legado permanece zero; aprovado gratuito não oferece cobrança", async ({ page }) => {
  const state = await api(page, { labor: 0, approved: true }); await page.goto("/ordens/");
  await expect(page.getByRole("cell", { name: "R$ 0,00", exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: "Combinar pagamento", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Editar OS", exact: true }).click(); const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Mão de obra", { exact: true })).toHaveValue("0,00"); await expect(dialog.getByLabel("Mão de obra", { exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Salvar OS", exact: true }).click(); await expect(dialog).toHaveCount(0); expect(state.commands[0].data.laborCents).toBe(0);
});

test("OS-OP-UI05 comprovante pendente não apresenta gratuidade nem valor zero", async ({ page }) => {
  await api(page, { update: false }); await page.goto("/ordens/"); await expect(page.getByRole("button", { name: "Editar OS", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Imprimir comprovante da OS 123", exact: true }).click(); const receipt = page.getByRole("dialog");
  await expect(receipt.getByRole("heading", { name: "Orçamento ainda não definido", exact: true })).toBeVisible(); await expect(receipt.getByText("Valor a definir", { exact: true })).toBeVisible();
  await expect(receipt.getByText("R$ 0,00", { exact: true })).toHaveCount(0);
});

test("OS-OP-UI06 relatório/CSV mantêm pendente separado do gratuito", async ({ page }) => {
  const state = await api(page); await page.goto("/relatorios/"); await page.getByLabel("Tipo de relatório", { exact: true }).selectOption("orders");
  await expect(page.getByText("1 OS com orçamento pendente. Totais somam somente valores definidos.", { exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Orçamento pendente", exact: true })).toBeVisible(); await expect(page.getByRole("cell", { name: "R$ 0,00", exact: true })).toBeVisible();
  const downloaded = page.waitForEvent("download"); await page.getByRole("button", { name: "Exportar CSV", exact: true }).click();
  const stream = await (await downloaded).createReadStream(), chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(Buffer.from(chunk)); const csv = Buffer.concat(chunks).toString("utf8");
  expect(csv).toContain('"OS com orçamento pendente";"1"');
  const lines = csv.split(/\r?\n/); expect(lines.find(line => line.includes('"123"') && line.includes('"Aparelho QA"'))).toMatch(/;""$/);
  expect(lines.find(line => line.includes('"124"') && line.includes('"Gratuito QA"'))).toMatch(/;"0,00"$/);
  expect(state.calls.filter(path => path.includes("/reports/orders/export"))).toHaveLength(1);
});
