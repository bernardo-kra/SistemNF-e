import { expect, test, type Page } from "@playwright/test";
const tenant = "40000000-0000-4000-8000-000000000001", customerId = "40000000-0000-4000-8000-000000000010", orderId = "40000000-0000-4000-8000-000000000020";
const installment = { id: "40000000-0000-4000-8000-000000000030", customerId, customerName: "Pessoa QA", sourceType: "order", sourceId: orderId, sourceLabel: "OS 42", amountCents: 12000, balanceCents: 12000, due: "2100-01-01" };
const bank = { id: "40000000-0000-4000-8000-000000000040", name: "Banco QA", type: "bank", active: true };
const order = { id: orderId, customerId, customerName: "Pessoa QA", number: 42, version: 1, equipment: "Aparelho QA", stage: "ready_for_pickup", approved: true, tested: true, laborCents: 12000, agreementId: "agreement-qa", finance: { outstandingCents: 12000, paidCents: 0 } };
async function api(page: Page, options: { receive?: boolean; agreement?: boolean; paid?: boolean; failPayment?: boolean; wrongSource?: boolean; failLoad?: boolean; partial?: boolean } = {}) {
  const commands: any[] = [], queries: URL[] = []; let failedPayment = false, failedLoad = false;
  await page.route("http://127.0.0.1:4000/**", async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const headers = { "access-control-allow-origin": "http://127.0.0.1:3000", "access-control-allow-credentials": "true", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST,OPTIONS" };
    if (request.method() === "OPTIONS") { await route.fulfill({ status: 204, headers }); return; }
    queries.push(url); const data = (items: any[]) => ({ tenantId: tenant, items, total: items.length, limit: 100, offset: 0 }); let body: any = data([]), status = 200;
    if (path.endsWith("/me")) body = { user: { id: "manager-qa", name: "Gestor QA", email: "os@example.test" }, tenants: [{ id: tenant, name: "Empresa QA", role: "owner", permissions: ["orders.read", "finance.read", "finance.agreements.create", ...(options.receive === false ? [] : ["finance.receive"])] }] };
    else if (path.endsWith("/branding")) body = { tenantId: tenant, branding: { version: 0, backgroundOpacity: 10, logo: null, background: null, updatedAt: null, updatedBy: null } };
    else if (path.endsWith("/orders")) body = data([{ ...order, ...(options.agreement === false ? { agreementId: null, finance: null } : {}), ...(options.paid ? { finance: { outstandingCents: 0, paidCents: 12000 } } : {}) }]);
    else if (path.endsWith("/overview")) body = { ...data([]), accounts: [bank], shifts: [] };
    else if (path.endsWith("/installments")) {
      if (options.failLoad && !failedLoad) { failedLoad = true; status = 503; body = { error: { code: "SERVICE_UNAVAILABLE" } }; }
      else body = { ...data([{ ...installment, ...(options.wrongSource ? { sourceId: "other-order" } : {}) }]), ...(options.partial ? { total: 2 } : {}) };
    } else if (path.endsWith("/commands")) {
      const input = request.postDataJSON(); commands.push(input);
      if (options.failPayment && !failedPayment) { failedPayment = true; status = 503; body = { error: { code: "SERVICE_UNAVAILABLE" } }; }
      else body = { tenantId: tenant, entity: { id: "payment-qa", receipt: { companyName: "Empresa QA", code: "REC-QA", customerName: "Pessoa QA", amountCents: input.data.amountCents, receivedAt: "2026-10-29T12:00:00Z", receivedBy: "manager-qa", method: "pix", accountName: bank.name, reference: input.data.reference, allocations: [{ installmentId: installment.id, sourceLabel: "OS 42", due: installment.due, amountCents: input.data.amountCents, remainingCents: 12000 - input.data.amountCents }], changeCents: 0, remainingCents: 22000 - input.data.amountCents } } };
    }
    await route.fulfill({ status, headers, json: body });
  }); return { commands, queries };
}
async function open(page: Page) {
  await page.goto("/ordens/"); await page.getByRole("button", { name: "Receber OS 42", exact: true }).click(); return page.getByRole("dialog", { name: "Receber OS 42", exact: true });
}
async function payment(dialog: ReturnType<Page["getByRole"]>) {
  await dialog.getByLabel("Meio de pagamento", { exact: true }).selectOption("pix"); await dialog.getByLabel("Conta", { exact: true }).selectOption(bank.id); await dialog.getByLabel("Referência", { exact: true }).fill("Crédito conferido QA"); await dialog.getByLabel("Crédito conferido manualmente", { exact: true }).check();
}
test("OS-REC-UI01 recebe a OS pelo saldo fresco, com alocação explícita, sem buscar cliente ou entregar", async ({ page }) => {
  const state = await api(page), dialog = await open(page); await expect(dialog.getByLabel("Valor recebido", { exact: true })).toHaveValue("120,00");
  expect(state.queries.filter((url) => url.pathname.endsWith("/installments"))).toHaveLength(1);
  const query = state.queries.find((url) => url.pathname.endsWith("/installments"))!; expect(query.searchParams.get("sourceType")).toBe("order"); expect(query.searchParams.get("sourceId")).toBe(orderId); expect(query.searchParams.get("customerId")).toBe(customerId);
  await payment(dialog); await dialog.getByLabel("Valor recebido", { exact: true }).fill("50,00"); await dialog.getByRole("button", { name: "Confirmar recebimento", exact: true }).click();
  const receipt = page.getByRole("dialog", { name: "Recibo de recebimento", exact: true }); await expect(receipt).toContainText("OS 42"); await expect(receipt).toContainText("50,00");
  expect(state.commands).toHaveLength(1); expect(state.commands[0]).toMatchObject({ type: "payment.receive", data: { customerId, sourceType: "order", sourceId: orderId, amountCents: 5000, allocations: [{ installmentId: installment.id, amountCents: 5000 }] } });
  expect(state.queries.some((url) => url.pathname.endsWith("/customers"))).toBe(false); expect(page.url()).toContain("/ordens/");
});
test("OS-REC-UI02 falha preserva valor e tentativa, cancelamento não recebe", async ({ page }) => {
  const state = await api(page, { failPayment: true }), dialog = await open(page); await payment(dialog); await dialog.getByLabel("Valor recebido", { exact: true }).fill("40,00");
  await dialog.getByRole("button", { name: "Confirmar recebimento", exact: true }).click(); await expect(dialog.getByRole("alert")).toBeVisible(); await expect(dialog.getByLabel("Valor recebido", { exact: true })).toHaveValue("40,00");
  await dialog.getByRole("button", { name: "Confirmar recebimento", exact: true }).click(); await expect(page.getByRole("dialog", { name: "Recibo de recebimento", exact: true })).toBeVisible(); expect(state.commands).toHaveLength(2); expect(state.commands[0]).toEqual(state.commands[1]);
});
test("OS-REC-UI03 erro de consulta permite retentar e origem diferente bloqueia recebimento", async ({ page }) => {
  const state = await api(page, { failLoad: true, wrongSource: true }), dialog = await open(page); await expect(dialog.getByRole("button", { name: "Confirmar recebimento", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Tentar carregar parcelas novamente", exact: true }).click(); await expect(dialog.getByRole("button", { name: "Tentar carregar parcelas novamente", exact: true })).toBeVisible();
  await expect.poll(() => state.queries.filter((url) => url.pathname.endsWith("/installments")).length).toBe(2);
  await expect(dialog.getByRole("button", { name: "Confirmar recebimento", exact: true })).toBeDisabled(); await dialog.getByRole("button", { name: "Cancelar", exact: true }).click(); expect(state.commands).toHaveLength(0); await expect(page.getByText("Aparelho QA", { exact: false })).toBeVisible();
});

test("OS-REC-UI06 página incompleta não é sugerida como saldo total da OS", async ({ page }) => {
  const state = await api(page, { partial: true }), dialog = await open(page);
  await expect(dialog.getByRole("button", { name: "Tentar carregar parcelas novamente", exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Valor recebido", { exact: true })).toHaveValue(""); await expect(dialog.getByRole("button", { name: "Confirmar recebimento", exact: true })).toBeDisabled(); expect(state.commands).toHaveLength(0);
});
test("OS-REC-UI04 sem direito, sem acordo ou já quitada não oferece recebimento", async ({ page }) => {
  for (const options of [{ receive: false }, { agreement: false }, { paid: true }]) {
    await page.unrouteAll({ behavior: "wait" }); await api(page, options); await page.goto("/ordens/"); await expect(page.getByRole("row").filter({ hasText: "OS 42" })).toBeVisible(); await expect(page.getByRole("button", { name: "Receber OS 42", exact: true })).toHaveCount(0);
  }
});
for (const width of [320, 390]) test(`OS-REC-UI05 ${width}px: valor acima do saldo bloqueia e cancelar preserva OS`, async ({ page }) => {
  await page.setViewportSize({ width, height: 850 }); const state = await api(page), dialog = await open(page); await expect(dialog.getByLabel("Valor recebido", { exact: true })).toHaveValue("120,00");
  await dialog.getByLabel("Valor recebido", { exact: true }).fill("120,01"); await expect(dialog.getByRole("button", { name: "Confirmar recebimento", exact: true })).toBeDisabled(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click(); await expect(dialog).toHaveCount(0); expect(state.commands).toHaveLength(0); expect(page.url()).toContain("/ordens/");
});
