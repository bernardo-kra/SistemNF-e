import { expect, test, type Page } from "@playwright/test";
const tenant = "10000000-0000-4000-8000-000000000001", technician = "20000000-0000-4000-8000-000000000002";
const headers = { "access-control-allow-origin": "http://127.0.0.1:3000", "access-control-allow-credentials": "true" };
async function api(page: Page, options: { known?: boolean; failOnce?: boolean; update?: boolean; advance?: boolean } = {}) {
  const calls: string[] = [], commands: any[] = [];
  let row: any = { id: "30000000-0000-4000-8000-000000000003", number: 123, customerId: "customer-qa", customerName: "Cliente QA", technicianId: options.known ? technician : null, technicianName: options.known ? "Técnico QA" : null, equipment: "Aparelho QA", issue: "Examinar QA", diagnosis: "", due: options.known ? "2100-02-01" : null, laborCents: null, stage: "received", approved: false, tested: false, version: 1, createdAt: "2026-11-09T12:00:00Z", updatedAt: "2026-11-09T12:00:00Z" };
  await page.route("http://127.0.0.1:4000/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname; calls.push(path); let json: any;
    if (path.endsWith("/me")) json = { user: { id: "qa", name: "Operador QA", email: "qa@example.test" }, tenants: [{ id: tenant, name: "Loja QA", role: "owner", permissions: ["customers.read", "orders.read", "orders.create", "orders.deliver", "finance.read", ...(options.update === false ? [] : ["orders.update"]), ...(options.advance === false ? [] : ["orders.advance"])] }] };
    else if (path.endsWith("/branding")) json = { branding: { version: 0, logo: null, background: null, backgroundOpacity: 10 } };
    else if (path.endsWith("/receipt")) json = { tenantId: tenant, companyName: "Loja QA", generatedAt: "2026-11-09T12:30:00Z", order: row, branding: { version: 0, logo: null, background: null, backgroundOpacity: 10 } };
    else if (path.endsWith("/technicians")) json = { tenantId: tenant, items: [{ id: technician, name: "Técnico QA" }], total: 1 };
    else if (path.endsWith("/customers")) json = { tenantId: tenant, items: [{ id: "customer-qa", name: "Cliente QA", active: true, phone: "", email: "" }], total: 1 };
    else if (path.endsWith("/commands")) {
      const input = route.request().postDataJSON(); commands.push(input);
      if (options.failOnce && commands.length === 1) { await route.fulfill({ status: 503, headers, json: { error: { code: "SERVICE_UNAVAILABLE" } } }); return; }
      row = { ...row, ...input.data, version: row.version + 1, ...(input.data.technicianId === undefined ? {} : { technicianName: input.data.technicianId ? "Técnico QA" : null }), ...(input.type === "order.advance" ? { stage: "diagnosing" } : {}) };
      json = { tenantId: tenant, entityType: "order", entity: row };
    } else if (path.includes("/reports/orders")) json = { tenantId: tenant, filters: { from: url.searchParams.get("from"), to: url.searchParams.get("to"), q: "", stage: "all", approval: "all" }, generatedAt: "2026-11-09T12:30:00Z", limit: 25, offset: 0, totals: { count: 1, laborCents: 0, approvedCents: 0, unapprovedCents: 0, unpricedCount: 1 }, items: [{ ...row, at: row.createdAt, date: "2026-11-09" }] };
    else if (path.includes("/reports/")) json = { tenantId: tenant, filters: { from: "2026-11-01", to: "2026-11-30", q: "", method: "" }, generatedAt: "2026-11-09T12:30:00Z", limit: 25, offset: 0, totals: { count: 0, amountCents: 0 }, items: [] };
    else json = { tenantId: tenant, items: [row], total: 1, limit: 25, offset: 0 };
    await route.fulfill({ headers, json });
  }); return { calls, commands };
}

for (const width of [1440, 320]) test(`OS-EN-UI01 entrada mínima sem técnico/data/preço em ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 1000 }); const state = await api(page); await page.goto("/ordens/");
  await page.getByRole("button", { name: "Nova OS", exact: true }).click(); const dialog = page.getByRole("dialog", { name: "Nova OS", exact: true });
  for (const label of ["Técnico responsável", "Previsão", "Mão de obra"]) { const input = dialog.getByLabel(label, { exact: true }); await expect(input).toHaveValue(""); await expect(input).not.toHaveAttribute("required"); }
  await dialog.getByRole("combobox", { name: "Cliente", exact: true }).fill("Cliente QA"); await dialog.getByRole("option", { name: /Cliente QA/ }).click();
  await dialog.getByLabel("Equipamento", { exact: true }).fill("Aparelho de entrada QA"); await dialog.getByLabel("Serviço solicitado", { exact: true }).fill("Não liga QA");
  const save = dialog.getByRole("button", { name: "Salvar OS", exact: true });
  for (const input of [dialog.getByLabel("Previsão", { exact: true }), save]) { await input.scrollIntoViewIfNeeded(); const box = await input.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width); }
  await page.screenshot({ path: info.outputPath(`order-intake-${width}.png`), fullPage: true });
  const listReads = state.calls.filter(path => path.endsWith("/operations/orders")).length;
  await save.click(); await expect(dialog).toHaveCount(0);
  expect(state.commands).toHaveLength(1); expect(state.commands[0].data).toMatchObject({ technicianId: null, due: null, laborCents: null });
  expect(state.calls.filter(path => path.endsWith("/operations/orders"))).toHaveLength(listReads + 1);
});

test("OS-EN-UI02 atribuir/iniciar tem um campo e uma confirmação; falha recupera escolha e ID", async ({ page }) => {
  const state = await api(page, { failOnce: true }); await page.goto("/ordens/"); await expect(page.getByText("Técnico a definir", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Iniciar diagnóstico", exact: true }).click(); let dialog = page.getByRole("dialog", { name: "Iniciar diagnóstico", exact: true });
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click(); expect(state.commands).toHaveLength(0);
  await page.getByRole("button", { name: "Iniciar diagnóstico", exact: true }).click(); dialog = page.getByRole("dialog", { name: "Iniciar diagnóstico", exact: true });
  await expect(dialog.getByRole("option", { name: "Técnico QA", exact: true })).toHaveCount(1);
  const reads = state.calls.length, listReads = state.calls.filter(path => path.endsWith("/operations/orders")).length;
  await dialog.getByLabel("Técnico responsável", { exact: true }).selectOption(technician);
  await expect(dialog.getByLabel("Previsão", { exact: true })).toHaveCount(0); await expect(dialog.getByLabel("Mão de obra", { exact: true })).toHaveCount(0);
  expect(state.commands).toHaveLength(0); expect(state.calls).toHaveLength(reads);
  await dialog.getByRole("button", { name: "Iniciar diagnóstico", exact: true }).click(); await expect(dialog.getByRole("alert")).toBeVisible();
  expect(state.calls.filter(path => path.endsWith("/operations/orders"))).toHaveLength(listReads);
  await expect(dialog.getByLabel("Técnico responsável", { exact: true })).toHaveValue(technician);
  await dialog.getByRole("button", { name: "Iniciar diagnóstico", exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect(state.commands).toHaveLength(2); expect(state.commands[0]).toEqual(state.commands[1]); expect(state.commands[0].type).toBe("order.advance"); expect(state.commands[0].data.technicianId).toBe(technician);
  await expect(page.getByRole("cell").filter({ hasText: "Em diagnóstico" })).toBeVisible();
  expect(state.calls.filter(path => path.endsWith("/operations/orders"))).toHaveLength(listReads + 1);
});

test("OS-EN-UI03 edição preserva os dados conhecidos; campos vazios limpam a entrada ainda não iniciada", async ({ page }) => {
  const state = await api(page, { known: true }); await page.goto("/ordens/"); await page.getByRole("button", { name: "Editar OS", exact: true }).click(); let dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Técnico responsável", { exact: true })).toHaveValue(technician); await expect(dialog.getByLabel("Previsão", { exact: true })).toHaveValue("2100-02-01");
  await dialog.getByRole("button", { name: "Salvar OS", exact: true }).click(); await expect(dialog).toHaveCount(0); expect(state.commands[0].data).toMatchObject({ technicianId: technician, due: "2100-02-01" });
  await page.getByRole("button", { name: "Editar OS", exact: true }).click(); dialog = page.getByRole("dialog");
  await dialog.getByLabel("Técnico responsável", { exact: true }).selectOption(""); await dialog.getByLabel("Previsão", { exact: true }).fill("");
  await dialog.getByRole("button", { name: "Salvar OS", exact: true }).click(); await expect(dialog).toHaveCount(0); expect(state.commands[1].data).toMatchObject({ technicianId: null, due: null });
});

test("OS-EN-UI04 atribuição conjunta não aparece sem os dois direitos e não consulta técnicos", async ({ page }) => {
  for (const rights of [{ update: false }, { advance: false }]) {
    await page.unrouteAll({ behavior: "wait" }); const state = await api(page, rights); await page.goto("/ordens/");
    await expect(page.getByRole("cell", { name: /Aparelho QA/ })).toBeVisible(); await expect(page.getByRole("button", { name: "Iniciar diagnóstico", exact: true })).toHaveCount(0);
    expect(state.calls.some(path => path.endsWith("/technicians"))).toBe(false); expect(state.commands).toHaveLength(0);
  }
});

test("OS-EN-UI05 comprovante e CSV não inventam responsável nem data", async ({ page }) => {
  await api(page); await page.goto("/ordens/"); await page.getByRole("button", { name: "Imprimir comprovante da OS 123", exact: true }).click();
  const receipt = page.getByRole("dialog", { name: "Comprovante da OS", exact: true }); await expect(receipt.getByText("Técnico a definir", { exact: true })).toBeVisible(); await expect(receipt.getByText("Sem previsão", { exact: true })).toBeVisible();
  await expect(receipt.getByText(/1970/)).toHaveCount(0); await receipt.getByRole("button", { name: "Fechar comprovante", exact: true }).click();
  await page.goto("/relatorios/"); await page.getByLabel("Tipo de relatório", { exact: true }).selectOption("orders"); await expect(page.getByRole("cell", { name: "Técnico a definir", exact: true })).toBeVisible();
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Exportar CSV", exact: true }).click();
  const stream = await (await download).createReadStream(), chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(Buffer.from(chunk)); const csv = Buffer.concat(chunks).toString("utf8");
  const line = csv.split(/\r?\n/).find(line => line.includes('"123"') && line.includes('"Aparelho QA"')); expect(line).toContain('"Cliente QA";"";"Aparelho QA"');
});
