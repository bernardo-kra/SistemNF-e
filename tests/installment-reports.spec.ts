import { expect, test, type Page } from "@playwright/test";
const tenant = "10000000-0000-4000-8000-000000000001";
const headers = { "access-control-allow-origin": "http://127.0.0.1:3000", "access-control-allow-credentials": "true" };
function report(query: URLSearchParams) {
  return { tenantId: tenant, filters: { from: query.get("from"), to: query.get("to"), q: query.get("q")?.trim() ?? "", asOf: query.get("asOf"), status: query.get("status") ?? "all" }, generatedAt: "2026-11-06T12:00:00Z", limit: 25, offset: 0,
    totals: { count: 1, principalCents: 1000, paidCents: 300, balanceCents: 700, overdueCents: 700 },
    items: [{ id: "qa-installment", agreementId: "qa-agreement", customerId: "qa-customer", customerName: '=Cliente "QA"', sourceType: "order", sourceId: "qa-order", sourceLabel: "OS QA", kind: "installment", number: 1, count: 2, due: "2026-11-05", amountCents: 1000, paidCents: 300, balanceCents: 700, overdueCents: 700, status: "overdue" }] };
}
async function api(page: Page, rights = ["finance.read"]) {
  const calls: string[] = [];
  await page.route("http://127.0.0.1:4000/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname; let json: unknown = {};
    if (path.endsWith("/me")) json = { user: { id: "qa", name: "Pessoa QA", email: "qa@example.test" }, tenants: [{ id: tenant, name: "Empresa QA", role: "owner", permissions: rights }] };
    else if (path.endsWith("/branding")) json = { branding: { version: 0, logo: null, background: null, backgroundOpacity: 10 } };
    else if (path.includes("/reports/")) {
      calls.push(url.pathname + url.search);
      json = path.includes("installments") ? report(url.searchParams) : { tenantId: tenant, filters: { from: url.searchParams.get("from"), to: url.searchParams.get("to"), q: "", method: "" }, generatedAt: "2026-11-06T12:00:00Z", limit: 25, offset: 0, totals: { count: 0, amountCents: 0 }, items: [] };
    }
    await route.fulfill({ headers, json });
  }); return calls;
}
for (const width of [1440, 320]) test(`PAR-UI01 filtros conjuntos, base explícita, totais e CSV em ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 1000 }); const calls = await api(page); await page.goto("/relatorios/");
  await expect(page.getByRole("button", { name: "Exportar CSV" })).toBeEnabled();
  await page.getByLabel("Tipo de relatório", { exact: true }).selectOption("installments");
  await expect(page.getByRole("heading", { name: "Parcelas da loja", exact: true })).toBeVisible();
  await expect(page.getByLabel("Data-base", { exact: true })).not.toHaveValue("");
  await expect(page.getByLabel("Meio de pagamento", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Valor das parcelas", { exact: true })).toBeVisible();
  expect(calls.filter(url => url.includes("installments"))).toHaveLength(1);
  await page.getByLabel("Data inicial", { exact: true }).fill("2026-11-01"); await page.getByLabel("Data final", { exact: true }).fill("2026-11-30");
  await page.getByLabel("Data-base", { exact: true }).fill("2026-11-06"); await page.getByLabel("Situação na data-base", { exact: true }).selectOption("overdue");
  await page.getByLabel("Buscar cliente", { exact: true }).fill("  QA  ");
  await expect(page.getByRole("button", { name: "Exportar CSV" })).toBeDisabled(); expect(calls.filter(url => url.includes("installments"))).toHaveLength(1);
  await page.getByRole("button", { name: "Consultar", exact: true }).click(); await expect(page.getByLabel("Buscar cliente", { exact: true })).toHaveValue("QA");
  await expect(page.getByRole("button", { name: "Exportar CSV" })).toBeEnabled();
  const query = new URL(calls.at(-1)!, "http://qa").searchParams; expect(query.get("asOf")).toBe("2026-11-06"); expect(query.get("status")).toBe("overdue"); expect(query.has("method")).toBe(false);
  const downloadEvent = page.waitForEvent("download"); await page.getByRole("button", { name: "Exportar CSV" }).click();
  const stream = await (await downloadEvent).createReadStream(), chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(Buffer.from(chunk)); const csv = Buffer.concat(chunks).toString("utf8");
  expect(csv).toContain("Data-base"); expect(csv).toContain("2026-11-06"); expect(csv).toContain("'=Cliente"); expect(csv).toContain("7,00"); expect(csv).toContain("OS QA");
  expect(calls.filter(url => url.includes("installments/export"))).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); window.scrollTo(0, 0); }); await page.waitForTimeout(300);
  await page.screenshot({ path: info.outputPath(`installments-${width}.png`), fullPage: true });
});
test("PAR-UI02 troca de relatório ignora erro tardio e não transfere campos incompatíveis", async ({ page }) => {
  await api(page); let release = () => {}, seen = false;
  await page.route("**/reports/installments?**", async route => { seen = true; await new Promise<void>(resolve => { release = resolve; }); await route.fulfill({ status: 403, headers, json: { error: { code: "FORBIDDEN" } } }).catch(() => {}); });
  try {
    await page.goto("/relatorios/"); await page.getByLabel("Tipo de relatório", { exact: true }).selectOption("installments"); await expect.poll(() => seen).toBe(true);
    await page.getByLabel("Tipo de relatório", { exact: true }).selectOption("receipts"); release();
    await expect(page.getByRole("heading", { name: "Recebimentos da loja", exact: true })).toBeVisible();
    await expect(page.getByLabel("Data-base", { exact: true })).toHaveCount(0); await expect(page.getByLabel("Meio de pagamento", { exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  } finally { release(); }
});
test("PAR-UI03 falha preserva filtros, não apresenta saldo zero; ausência de direito não consulta", async ({ page }) => {
  const calls = await api(page, []); await page.goto("/relatorios/"); await expect(page.getByRole("main").getByRole("alert")).toContainText("permissão"); expect(calls).toHaveLength(0);
  await page.unrouteAll({ behavior: "wait" }); await api(page); let attempts = 0;
  await page.route("**/reports/installments?**", async route => {
    attempts++; await route.fulfill(attempts === 1 ? { status: 503, headers, json: { error: { code: "SERVICE_UNAVAILABLE" } } } : { headers, json: report(new URL(route.request().url()).searchParams) });
  });
  await page.reload(); await page.getByLabel("Tipo de relatório", { exact: true }).selectOption("installments"); await expect(page.getByRole("main").getByRole("alert")).toContainText("Não foi possível");
  await expect(page.getByText("R$ 0,00", { exact: true })).toHaveCount(0); await page.getByLabel("Data-base", { exact: true }).fill("2026-11-06");
  await page.getByRole("button", { name: "Consultar", exact: true }).click(); await expect(page.getByRole("button", { name: "Exportar CSV" })).toBeEnabled(); await expect(page.getByLabel("Data-base", { exact: true })).toHaveValue("2026-11-06");
});
