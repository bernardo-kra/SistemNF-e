import { expect, test, type Page } from "@playwright/test";
const tenant = "10000000-0000-4000-8000-000000000001";
const headers = { "access-control-allow-origin": "http://127.0.0.1:3000", "access-control-allow-credentials": "true" };
function report(query: URLSearchParams) {
  return { tenantId: tenant, filters: { from: query.get("from"), to: query.get("to"), q: query.get("q")?.trim() ?? "", status: query.get("status") ?? "all" }, generatedAt: "2026-11-07T12:00:00Z", limit: 25, offset: 0,
    totals: { count: 1, grossCents: 6000, discountCents: 200, totalCents: 5800 },
    items: [{ id: "qa-sale", number: 123, at: "2026-11-07T12:00:00Z", date: "2026-11-07", customerName: '=Cliente "QA"', status: "confirmed", grossCents: 6000, discountCents: 200, totalCents: 5800 }] };
}
async function api(page: Page, rights = ["finance.read", "sales.read"]) {
  const calls: string[] = [];
  await page.route("http://127.0.0.1:4000/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname; let json: unknown = {};
    if (path.endsWith("/me")) json = { user: { id: "qa", name: "Pessoa QA", email: "qa@example.test" }, tenants: [{ id: tenant, name: "Empresa QA", role: "owner", permissions: rights }] };
    else if (path.endsWith("/branding")) json = { branding: { version: 0, logo: null, background: null, backgroundOpacity: 10 } };
    else if (path.includes("/reports/")) {
      calls.push(path + url.search);
      json = path.includes("sales") ? report(url.searchParams) : { tenantId: tenant, filters: { from: url.searchParams.get("from"), to: url.searchParams.get("to"), q: "", method: "" }, generatedAt: "2026-11-07T12:00:00Z", limit: 25, offset: 0, totals: { count: 0, amountCents: 0 }, items: [] };
    }
    await route.fulfill({ headers, json });
  }); return calls;
}
for (const width of [1440, 320]) test(`VEN-UI01 vendas sem redigitação, filtros conjuntos, totais/CSV em ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 1000 }); const calls = await api(page); await page.goto("/relatorios/");
  await expect(page.getByRole("button", { name: "Exportar CSV" })).toBeEnabled();
  await page.getByLabel("Tipo de relatório", { exact: true }).selectOption("sales");
  await expect(page.getByRole("heading", { name: "Vendas da loja", exact: true })).toBeVisible();
  await expect(page.getByLabel("Meio de pagamento", { exact: true })).toHaveCount(0); await expect(page.getByLabel("Data-base", { exact: true })).toHaveCount(0);
  const totals = page.getByRole("region", { name: "Totais da seleção" });
  await expect(totals.getByText("Valor vendido", { exact: true })).toBeVisible(); await expect(totals.getByText("Descontos", { exact: true })).toBeVisible();
  expect(calls.filter(url => url.includes("sales"))).toHaveLength(1);
  await page.getByLabel("Data inicial", { exact: true }).fill("2026-11-01"); await page.getByLabel("Data final", { exact: true }).fill("2026-11-30");
  await page.getByLabel("Situação atual", { exact: true }).selectOption("confirmed"); await page.getByLabel("Buscar cliente", { exact: true }).fill("  QA  ");
  await expect(page.getByRole("button", { name: "Exportar CSV" })).toBeDisabled(); expect(calls.filter(url => url.includes("sales"))).toHaveLength(1);
  await page.getByRole("button", { name: "Consultar", exact: true }).click(); await expect(page.getByLabel("Buscar cliente", { exact: true })).toHaveValue("QA");
  await expect(page.getByRole("button", { name: "Exportar CSV" })).toBeEnabled();
  const query = new URL(calls.at(-1)!, "http://qa").searchParams; expect(query.get("status")).toBe("confirmed"); expect(query.has("method")).toBe(false); expect(query.has("asOf")).toBe(false);
  const downloadEvent = page.waitForEvent("download"); await page.getByRole("button", { name: "Exportar CSV" }).click();
  const stream = await (await downloadEvent).createReadStream(), chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(Buffer.from(chunk)); const csv = Buffer.concat(chunks).toString("utf8");
  expect(csv).toContain("Situação atual"); expect(csv).toContain("'=Cliente"); expect(csv).toContain("58,00"); expect(csv).toContain("60,00"); expect(csv).toContain("2,00"); expect(csv).toContain("123"); expect(csv).toContain("não representam recebimentos");
  expect(calls.filter(url => url.includes("sales/export"))).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  for (const field of ["Tipo de relatório", "Data inicial", "Data final", "Buscar cliente", "Situação atual"]) {
    const box = await page.getByLabel(field, { exact: true }).boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
  }
  await page.screenshot({ path: info.outputPath(`sales-${width}.png`), fullPage: true });
});
test("VEN-UI02 troca ignora resposta tardia; sem direito de vendas não consulta esse relatório", async ({ page }) => {
  const calls = await api(page, ["finance.read"]); await page.goto("/relatorios/");
  await page.getByLabel("Tipo de relatório", { exact: true }).selectOption("sales");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("permissão"); expect(calls.filter(url => url.includes("sales"))).toHaveLength(0);
  await page.getByLabel("Tipo de relatório", { exact: true }).selectOption("receipts"); await expect(page.getByRole("button", { name: "Exportar CSV" })).toBeEnabled();
  await page.unrouteAll({ behavior: "wait" }); await api(page); await page.reload();
  let release = () => {}, seen = false;
  await page.route("**/reports/sales?**", async route => { seen = true; await new Promise<void>(resolve => { release = resolve; }); await route.fulfill({ status: 403, headers, json: { error: { code: "FORBIDDEN" } } }).catch(() => {}); });
  try {
    await page.getByLabel("Tipo de relatório", { exact: true }).selectOption("sales"); await expect.poll(() => seen).toBe(true);
    await page.getByLabel("Tipo de relatório", { exact: true }).selectOption("receipts"); release();
    await expect(page.getByRole("heading", { name: "Recebimentos da loja", exact: true })).toBeVisible();
    await expect(page.getByLabel("Meio de pagamento", { exact: true })).toBeVisible(); await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  } finally { release(); }
});
test("VEN-UI03 erro conserva filtros e não mostra totais zero; nova consulta recupera", async ({ page }) => {
  await api(page); let attempts = 0;
  await page.route("**/reports/sales?**", async route => { attempts++; await route.fulfill(attempts === 1 ? { status: 503, headers, json: { error: { code: "SERVICE_UNAVAILABLE" } } } : { headers, json: report(new URL(route.request().url()).searchParams) }); });
  await page.goto("/relatorios/"); await page.getByLabel("Tipo de relatório", { exact: true }).selectOption("sales");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Não foi possível"); await expect(page.getByText("R$ 0,00", { exact: true })).toHaveCount(0);
  await page.getByLabel("Buscar cliente", { exact: true }).fill("QA"); await page.getByRole("button", { name: "Consultar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Exportar CSV" })).toBeEnabled(); await expect(page.getByLabel("Buscar cliente", { exact: true })).toHaveValue("QA");
});
