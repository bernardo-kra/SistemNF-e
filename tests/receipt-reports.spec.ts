import { expect, test, type Page } from "@playwright/test";
const tenant = "10000000-0000-4000-8000-000000000001";
const headers = { "access-control-allow-origin": "http://127.0.0.1:3000", "access-control-allow-credentials": "true" };
function report(query: URLSearchParams, exporting = false) {
  const offset = Number(query.get("offset") ?? 0);
  const items = Array.from({ length: 26 }, (_, index) => ({ id: `payment-${index}`, at: "2026-11-06T12:00:00Z", date: "2026-11-06", customerName: index === 25 ? "Último QA" : index === 0 ? '=HYPERLINK("QA")' : `Cliente QA ${index}`, accountName: "Conta QA", receivedByName: "Pessoa QA", method: "pix", amountCents: 100 }));
  return { tenantId: tenant, filters: { from: query.get("from"), to: query.get("to"), q: query.get("q") ?? "", method: query.get("method") ?? "" }, generatedAt: "2026-11-06T12:00:00Z", limit: 25, offset,
    totals: { count: 26, amountCents: 2600 }, items: exporting ? items : items.slice(offset, offset + 25) };
}
async function api(page: Page, rights = ["finance.read"]) {
  const calls: string[] = [];
  await page.route("http://127.0.0.1:4000/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    let json: unknown = {};
    if (path.endsWith("/me")) json = { user: { id: "qa", name: "Pessoa QA", email: "qa@example.test" }, tenants: [{ id: tenant, name: "Empresa QA", role: "owner", permissions: rights }] };
    else if (path.endsWith("/branding")) json = { branding: { version: 0, logo: null, background: null, backgroundOpacity: 10 } };
    else if (path.includes("/reports/receipts")) { calls.push(url.pathname + url.search); json = report(url.searchParams, path.endsWith("/export")); }
    await route.fulfill({ headers, json });
  });
  return calls;
}
for (const width of [1440, 320]) test(`REL-UI01 consulta única, total integral, filtros aplicados e CSV seguro em ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 1000 }); const calls = await api(page);
  await page.goto("/relatorios/"); await expect(page.getByRole("heading", { name: "Recebimentos da loja" })).toBeVisible();
  await expect(page.getByText("R$ 26,00", { exact: true })).toBeVisible(); expect(calls).toHaveLength(1);
  await page.getByLabel("Buscar cliente", { exact: true }).fill("QA");
  await expect(page.getByRole("button", { name: "Exportar CSV" })).toBeDisabled(); expect(calls).toHaveLength(1);
  await page.getByLabel("Data inicial", { exact: true }).fill("2026-11-01"); await page.getByLabel("Data final", { exact: true }).fill("2026-11-30");
  await page.getByRole("button", { name: "Consultar", exact: true }).click();
  await expect.poll(() => calls.length).toBe(2); expect(new URL(calls[1], "http://qa").searchParams.get("q")).toBe("QA");
  await expect(page.getByRole("button", { name: "Exportar CSV" })).toBeEnabled();
  const downloadPromise = page.waitForEvent("download"); await page.getByRole("button", { name: "Exportar CSV" }).click();
  const download = await downloadPromise, stream = await download.createReadStream(); let csv = ""; for await (const chunk of stream!) csv += chunk.toString();
  expect(calls.filter(value => value.includes("/export"))).toHaveLength(1); expect(csv).toContain("'=HYPERLINK"); expect(csv).toContain('""QA""'); expect(csv).toContain("2026-11-01"); expect(csv).toContain("Último QA");
  await page.getByRole("button", { name: "Próxima página" }).click(); await expect(page.getByText("Último QA", { exact: true })).toBeVisible();
  expect(new URL(calls.at(-1)!, "http://qa").searchParams.get("offset")).toBe("25");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); window.scrollTo(0, 0); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: info.outputPath(`report-${width}.png`), fullPage: true });
});
test("REL-UI02 sem direito não consulta e falha não exibe saldo zero; retentativa mantém filtros", async ({ page }) => {
  const calls = await api(page, []); await page.goto("/relatorios/");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("permissão"); expect(calls).toHaveLength(0);
  await page.unrouteAll({ behavior: "wait" }); await api(page);
  let failures = 0;
  await page.route("**/reports/receipts?**", async route => {
    failures++; if (failures === 1) await route.fulfill({ status: 503, headers, json: { error: { code: "SERVICE_UNAVAILABLE" } } });
    else await route.fulfill({ headers, json: report(new URL(route.request().url()).searchParams) });
  });
  await page.reload(); await expect(page.getByRole("main").getByRole("alert")).toContainText("Não foi possível"); await expect(page.getByText("R$ 0,00", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Exportar CSV" })).toBeDisabled();
  await page.getByLabel("Buscar cliente", { exact: true }).fill("Repetir QA"); await page.getByRole("button", { name: "Consultar", exact: true }).click();
  await expect(page.getByText("R$ 26,00", { exact: true })).toBeVisible(); await expect(page.getByLabel("Buscar cliente", { exact: true })).toHaveValue("Repetir QA");
});
test("REL-UI03 resposta tardia de outra empresa não altera sessão nem mostra registros", async ({ page }) => {
  await api(page); let release = () => {}, seen = false;
  await page.route("**/reports/receipts?**", async route => {
    seen = true; await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ status: 403, headers, json: { error: { code: "FORBIDDEN" } } }).catch(() => {});
  });
  try {
    await page.goto("/relatorios/"); await expect.poll(() => seen).toBe(true);
    await page.getByLabel("Empresa", { exact: true }).selectOption(""); release();
    await expect(page.getByText("Selecione uma empresa para continuar.", { exact: true })).toBeVisible();
    await expect(page.getByText("Você não tem permissão para realizar esta ação.", { exact: true })).toHaveCount(0);
  } finally { release(); }
});
test("REL-UI04 exportação excessiva pede período menor, sem gerar arquivo parcial", async ({ page }) => {
  await api(page); await page.route("**/reports/receipts/export?**", async route => route.fulfill({ status: 413, headers, json: { error: { code: "REPORT_TOO_LARGE" } } }));
  await page.goto("/relatorios/"); await expect(page.getByRole("button", { name: "Exportar CSV" })).toBeEnabled();
  let downloads = 0; page.on("download", () => downloads++); await page.getByRole("button", { name: "Exportar CSV" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("10 mil"); expect(downloads).toBe(0);
});
test("REL-UI05 busca normalizada não deixa exportação bloqueada e seleção vazia é explícita", async ({ page }) => {
  await api(page);
  await page.route("**/reports/receipts?**", async route => {
    const response = report(new URL(route.request().url()).searchParams);
    response.filters.q = response.filters.q.trim();
    if (response.filters.q === "Sem registros QA") { response.items = []; response.totals = { count: 0, amountCents: 0 }; }
    await route.fulfill({ headers, json: response });
  });
  await page.goto("/relatorios/"); await expect(page.getByRole("button", { name: "Exportar CSV" })).toBeEnabled();
  await page.getByLabel("Buscar cliente", { exact: true }).fill("  QA  "); await page.getByRole("button", { name: "Consultar", exact: true }).click();
  await expect(page.getByLabel("Buscar cliente", { exact: true })).toHaveValue("QA");
  await expect(page.getByRole("button", { name: "Exportar CSV" })).toBeEnabled();
  await page.getByLabel("Buscar cliente", { exact: true }).fill("Sem registros QA"); await page.getByRole("button", { name: "Consultar", exact: true }).click();
  await expect(page.getByText("Nenhum recebimento nesta seleção.", { exact: true })).toBeVisible();
  await expect(page.getByText("R$ 0,00", { exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: "Próxima página" })).toBeDisabled();
});
