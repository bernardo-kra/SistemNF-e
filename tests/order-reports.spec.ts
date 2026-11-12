import { expect, test, type Page } from "@playwright/test";
const tenant = "10000000-0000-4000-8000-000000000001";
const headers = { "access-control-allow-origin": "http://127.0.0.1:3000", "access-control-allow-credentials": "true" };
function report(query: URLSearchParams) {
  return { tenantId: tenant, filters: { from: query.get("from"), to: query.get("to"), q: query.get("q")?.trim() ?? "", stage: query.get("stage") ?? "all", approval: query.get("approval") ?? "all" }, generatedAt: "2026-11-08T12:00:00Z", limit: 25, offset: 0,
    totals: { count: 1, laborCents: 1000, approvedCents: 1000, unapprovedCents: 0, unpricedCount: 0 },
    items: [{ id: "qa-order", number: 123, at: "2026-11-08T12:00:00Z", date: "2026-11-08", customerName: '=Cliente "QA"', technicianName: "Técnico QA", equipment: "Equipamento QA", stage: "in_progress", approved: true, laborCents: 1000 }] };
}
async function api(page: Page, rights = ["finance.read", "orders.read", "customers.read"]) {
  const calls: string[] = [];
  await page.route("http://127.0.0.1:4000/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname; let json: unknown = {};
    if (path.endsWith("/me")) json = { user: { id: "qa", name: "Pessoa QA", email: "qa@example.test" }, tenants: [{ id: tenant, name: "Empresa QA", role: "owner", permissions: rights }] };
    else if (path.endsWith("/branding")) json = { branding: { version: 0, logo: null, background: null, backgroundOpacity: 10 } };
    else if (path.includes("/reports/")) {
      calls.push(path + url.search);
      json = path.includes("orders") ? report(url.searchParams) : { tenantId: tenant, filters: { from: url.searchParams.get("from"), to: url.searchParams.get("to"), q: "", method: "" }, generatedAt: "2026-11-08T12:00:00Z", limit: 25, offset: 0, totals: { count: 0, amountCents: 0 }, items: [] };
    }
    await route.fulfill({ headers, json });
  }); return calls;
}
for (const width of [1440, 320]) test(`OSR-UI01 filtros em conjunto, dados atuais, CSV e layout ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 1000 }); const calls = await api(page); await page.goto("/relatorios/");
  await expect(page.getByRole("button", { name: "Exportar CSV" })).toBeEnabled();
  await page.getByLabel("Tipo de relatório", { exact: true }).selectOption("orders");
  await expect(page.getByRole("heading", { name: "Ordens de serviço da loja", exact: true })).toBeVisible();
  await expect(page.getByLabel("Meio de pagamento", { exact: true })).toHaveCount(0); await expect(page.getByLabel("Data-base", { exact: true })).toHaveCount(0);
  const totals = page.getByRole("region", { name: "Totais da seleção" }); await expect(totals.getByText("Serviços aprovados", { exact: true })).toBeVisible();
  expect(calls.filter(url => url.includes("orders"))).toHaveLength(1);
  await page.getByLabel("Data inicial", { exact: true }).fill("2026-11-01"); await page.getByLabel("Data final", { exact: true }).fill("2026-11-30");
  await page.getByLabel("Etapa atual", { exact: true }).selectOption("in_progress"); await page.getByLabel("Aprovação", { exact: true }).selectOption("approved"); await page.getByLabel("Buscar cliente", { exact: true }).fill("  QA  ");
  await expect(page.getByRole("button", { name: "Exportar CSV" })).toBeDisabled(); expect(calls.filter(url => url.includes("orders"))).toHaveLength(1);
  await page.getByRole("button", { name: "Consultar", exact: true }).click(); await expect(page.getByLabel("Buscar cliente", { exact: true })).toHaveValue("QA");
  await expect(page.getByRole("button", { name: "Exportar CSV" })).toBeEnabled();
  const query = new URL(calls.at(-1)!, "http://qa").searchParams; expect(query.get("stage")).toBe("in_progress"); expect(query.get("approval")).toBe("approved"); expect(query.has("method")).toBe(false); expect(query.has("status")).toBe(false);
  const downloadEvent = page.waitForEvent("download"); await page.getByRole("button", { name: "Exportar CSV" }).click();
  const stream = await (await downloadEvent).createReadStream(), chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(Buffer.from(chunk)); const csv = Buffer.concat(chunks).toString("utf8");
  expect(csv).toContain("Etapa atual"); expect(csv).toContain("'=Cliente"); expect(csv).toContain("10,00"); expect(csv).toContain("Técnico QA"); expect(csv).toContain("Equipamento QA"); expect(csv).toContain("não representam recebimentos");
  expect(calls.filter(url => url.includes("orders/export"))).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  for (const field of ["Tipo de relatório", "Data inicial", "Data final", "Buscar cliente", "Etapa atual", "Aprovação"]) {
    const box = await page.getByLabel(field, { exact: true }).boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
  }
  await page.screenshot({ path: info.outputPath(`orders-${width}.png`), fullPage: true });
});
test("OSR-UI02 falta de direito não consulta; troca ignora erro tardio e filtros incompatíveis", async ({ page }) => {
  const calls = await api(page, ["finance.read"]); await page.goto("/relatorios/");
  await page.getByLabel("Tipo de relatório", { exact: true }).selectOption("orders"); await expect(page.getByRole("main").getByRole("alert")).toContainText("permissão"); expect(calls.filter(url => url.includes("orders"))).toHaveLength(0);
  await page.getByLabel("Tipo de relatório", { exact: true }).selectOption("receipts"); await expect(page.getByRole("button", { name: "Exportar CSV" })).toBeEnabled();
  await page.unrouteAll({ behavior: "wait" }); await api(page); await page.reload();
  let release = () => {}, seen = false;
  await page.route("**/reports/orders?**", async route => { seen = true; await new Promise<void>(resolve => { release = resolve; }); await route.fulfill({ status: 403, headers, json: { error: { code: "FORBIDDEN" } } }).catch(() => {}); });
  try {
    await page.getByLabel("Tipo de relatório", { exact: true }).selectOption("orders"); await expect.poll(() => seen).toBe(true);
    await page.getByLabel("Tipo de relatório", { exact: true }).selectOption("receipts"); release();
    await expect(page.getByRole("heading", { name: "Recebimentos da loja", exact: true })).toBeVisible(); await expect(page.getByLabel("Etapa atual", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  } finally { release(); }
});
test("OSR-UI03 falha mantém filtros, não mostra total zero; nova consulta e estado vazio explícito", async ({ page }) => {
  await api(page); let attempts = 0;
  await page.route("**/reports/orders?**", async route => { attempts++; const json = report(new URL(route.request().url()).searchParams); if (attempts > 2) { json.items = []; json.totals = { count: 0, laborCents: 0, approvedCents: 0, unapprovedCents: 0, unpricedCount: 0 }; } await route.fulfill(attempts === 1 ? { status: 503, headers, json: { error: { code: "SERVICE_UNAVAILABLE" } } } : { headers, json }); });
  await page.goto("/relatorios/"); await page.getByLabel("Tipo de relatório", { exact: true }).selectOption("orders"); await expect(page.getByRole("main").getByRole("alert")).toContainText("Não foi possível");
  await expect(page.getByRole("region", { name: "Totais da seleção" })).toHaveCount(0); await page.getByLabel("Buscar cliente", { exact: true }).fill("QA");
  await page.getByRole("button", { name: "Consultar", exact: true }).click(); await expect(page.getByRole("button", { name: "Exportar CSV" })).toBeEnabled(); await expect(page.getByLabel("Buscar cliente", { exact: true })).toHaveValue("QA");
  await page.getByRole("button", { name: "Consultar", exact: true }).click(); await expect(page.getByText("Nenhuma ordem de serviço nesta seleção.", { exact: true })).toBeVisible();
});
