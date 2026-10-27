import { expect, test, type Page } from "@playwright/test";

// QA independente: respostas controladas da API. Integração real é verificação separada.
const tenantId = "10000000-0000-4000-8000-000000000001";
const customer = { id: "10000000-0000-4000-8000-000000000010", name: "Cliente financeiro QA", type: "Pessoa física", active: true, version: 1 };
const product = { id: "10000000-0000-4000-8000-000000000020", name: "Capa QA", sku: "CAPA-QA", gtin: "7891234567895", salePriceCents: 10000, costCents: 5000, category: "Capas", active: true, serialized: false, unit: "UN", version: 1, stock: { physical: 5, reserved: 0, available: 5, version: 1 } };
const bank = { id: "10000000-0000-4000-8000-000000000030", name: "Banco QA", type: "bank", active: true, balanceCents: 0, version: 1 };
const cash = { id: "10000000-0000-4000-8000-000000000031", name: "Caixa QA", type: "cash", active: true, balanceCents: 0, version: 1 };
const shift = { id: "10000000-0000-4000-8000-000000000040", accountId: cash.id, status: "open", openedBy: "manager-qa", openedAt: "2026-10-26T12:00:00Z", openingBalanceCents: 0, version: 1 };
const rights = ["customers.read", "customers.create", "products.read", "products.create", "products.update", "products.cost.read", "stock.read", "stock.receive", "sales.read", "sales.create", "sales.deliver", "finance.read", "finance.agreements.create", "finance.receive", "finance.accounts.manage", "finance.cash.manage", "audit.read"];
const installments = [
  { id: "10000000-0000-4000-8000-000000000050", agreementId: "agreement-qa", customerId: customer.id, customerName: customer.name, sourceType: "sale", sourceId: "sale-qa", sourceLabel: "Venda QA", kind: "installment", number: 1, count: 2, amountCents: 10000, paidCents: 0, balanceCents: 10000, due: "2100-01-01" },
  { id: "10000000-0000-4000-8000-000000000051", agreementId: "agreement-qa", customerId: customer.id, customerName: customer.name, sourceType: "sale", sourceId: "sale-qa", sourceLabel: "Venda QA", kind: "installment", number: 2, count: 2, amountCents: 20000, paidCents: 0, balanceCents: 20000, due: "2100-02-01" },
];
function paid(amountCents = 15000) {
  let remaining = amountCents;
  const allocations = installments.flatMap((row) => { const applied = Math.min(remaining, row.balanceCents); remaining -= applied; return applied > 0 ? [{ installmentId: row.id, sourceType: row.sourceType, sourceId: row.sourceId, sourceLabel: row.sourceLabel, due: row.due, amountCents: applied, remainingCents: row.balanceCents - applied }] : []; });
  return { id: "10000000-0000-4000-8000-000000000060", customerId: customer.id, amountCents, allocations, receipt: { code: "REC-QA", companyName: "Loja QA", customerName: customer.name, amountCents, method: "pix", accountName: bank.name, receivedAt: "2026-10-26T12:00:00Z", receivedBy: "manager-qa", reference: "Pix conferido", tenderedCents: amountCents, changeCents: 0, allocations, remainingCents: 30000 - amountCents } };
}
type Handler = (input: any, index: number) => Promise<{ status?: number; body: any }> | { status?: number; body: any };
async function connected(page: Page, options: { rights?: string[]; command?: Handler; openShift?: boolean; receiptGate?: Promise<void>; receiptHistory?: boolean; pricePending?: boolean; emptyStock?: boolean } = {}) {
  const commands: any[] = [], queries: string[] = [];
  let shifts = options.openShift ? [shift] : [], lastPayment = paid();
  let catalogProduct: any = { ...product, salePriceCents: options.pricePending ? null : product.salePriceCents, stock: { ...product.stock, ...(options.emptyStock ? { physical: 0, available: 0 } : {}) } };
  await page.route("http://127.0.0.1:4000/**", async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const headers = { "access-control-allow-origin": "http://127.0.0.1:3000", "access-control-allow-credentials": "true", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST,PATCH,OPTIONS" };
    if (request.method() === "OPTIONS") { await route.fulfill({ status: 204, headers }); return; }
    queries.push(`${request.method()} ${path}`); let result: { status?: number; body: any };
    const pageData = (items: any[]) => ({ tenantId, items, total: items.length, limit: 25, offset: 0 });
    if (path.endsWith("/me")) result = { body: { user: { id: "manager-qa", name: "Gestora QA", email: "qa@example.test" }, tenants: [{ id: tenantId, name: "Loja QA", role: "owner", permissions: options.rights ?? rights }] } };
    else if (path.endsWith("/commands")) {
      const input = request.postDataJSON(); commands.push(input);
      if (options.command) result = await options.command(input, commands.length);
      else if (input.type === "shift.open") { shifts = [shift]; result = { body: { tenantId, entityType: "shift", entity: shift } }; }
      else if (input.type === "payment.receive") result = { body: { tenantId, entityType: "payment", entity: paid(input.data.amountCents) } };
      else if (input.type === "product.update") { catalogProduct = { ...catalogProduct, salePriceCents: input.data.salePriceCents, version: catalogProduct.version + 1 }; result = { body: { tenantId, entityType: "product", entity: catalogProduct } }; }
      else if (input.type === "stock.receive") { catalogProduct = { ...catalogProduct, stock: { ...catalogProduct.stock, physical: catalogProduct.stock.physical + input.data.quantity, available: catalogProduct.stock.available + input.data.quantity, version: catalogProduct.stock.version + 1 } }; result = { body: { tenantId, entityType: "product", entity: catalogProduct } }; }
      else {
        if (input.data.payment) {
          lastPayment = paid(input.data.payment.amountCents);
          const allocation = { installmentId: "10000000-0000-4000-8000-000000000052", sourceType: "sale", sourceId: "sale-checkout-qa", sourceLabel: "Venda 1", due: input.data.terms.downPaymentDue ?? "2026-10-26", amountCents: input.data.payment.amountCents, remainingCents: 0 };
          lastPayment = { ...lastPayment, allocations: [allocation], receipt: { ...lastPayment.receipt, amountCents: input.data.payment.amountCents, method: input.data.payment.method, accountName: input.data.payment.accountId === cash.id ? cash.name : bank.name, reference: input.data.payment.reference ?? "Recebimento em dinheiro", allocations: [allocation], remainingCents: 40000 - input.data.payment.amountCents } };
        }
        result = { body: { tenantId, entityType: "sale", entity: { id: "sale-checkout-qa", number: 1, status: input.data.deliver ? "delivered" : "confirmed", customerId: customer.id, totalCents: 10000, agreementId: "agreement-qa", ...(input.data.payment ? { checkoutPaymentId: lastPayment.id } : {}), financeStatus: "integrated", version: 1 } } };
      }
    }
    else if (path.endsWith("/overview")) result = { body: { ...pageData([{ id: customer.id, customerId: customer.id, customerName: customer.name, outstandingCents: 30000, overdueCents: 0, paidCents: 0 }]), accounts: [bank, cash], shifts, asOf: "2026-10-26" } };
    else if (path.endsWith("/installments")) result = { body: pageData(installments) };
    else if (path.endsWith("/payments")) result = { body: pageData(options.receiptHistory ? [paid()] : []) };
    else if (path.includes("/payments/")) { if (options.receiptGate) await options.receiptGate; result = { body: { tenantId, payment: lastPayment } }; }
    else if (path.endsWith("/customers")) result = { body: pageData([customer]) };
    else if (path.endsWith("/products")) result = { body: pageData([catalogProduct]) };
    else result = { body: pageData([]) };
    await route.fulfill({ status: result.status ?? 200, headers, json: result.body });
  });
  return { commands, queries };
}
async function openSale(page: Page) {
  await page.goto("/operacao/"); await page.getByRole("button", { name: "Vendas", exact: true }).click(); await page.getByRole("button", { name: "Nova venda", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Nova venda", exact: true });
  await expect(dialog.getByLabel("Cliente", { exact: true }).locator("option")).toHaveCount(2);
  await dialog.getByLabel("Cliente", { exact: true }).selectOption(customer.id);
  await expect(dialog.getByLabel("Produto 1", { exact: true }).locator("option")).toHaveCount(2);
  await dialog.getByLabel("Produto 1", { exact: true }).selectOption(product.id); return dialog;
}
async function openReceive(page: Page) {
  await page.goto("/operacao/"); await page.getByRole("button", { name: "Financeiro", exact: true }).click();
  await page.getByRole("button", { name: `Receber de ${customer.name}`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Receber de ${customer.name}`, exact: true });
  await dialog.getByLabel("Valor recebido", { exact: true }).fill("150,00");
  await dialog.getByLabel("Meio de pagamento", { exact: true }).selectOption("pix");
  await dialog.getByLabel("Conta", { exact: true }).selectOption(bank.id);
  await dialog.getByLabel("Referência", { exact: true }).fill("Pix conferido");
  await dialog.getByLabel("Crédito conferido manualmente", { exact: true }).check(); return dialog;
}

test("FIN-UI01 pagar depois e entregar agora conclui o conjunto em um comando sem navegação extra", async ({ page }) => {
  const { commands } = await connected(page); const dialog = await openSale(page);
  let navigations = 0; page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigations++; });
  await expect(dialog.getByLabel("Condição de pagamento", { exact: true })).toHaveValue("later");
  await dialog.getByLabel("Vencimento", { exact: true }).fill("2100-01-30");
  await expect(dialog.getByLabel("Entregar agora", { exact: true })).toBeChecked();
  await dialog.getByRole("button", { name: "Concluir venda", exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect(commands).toHaveLength(1); expect(commands[0].type).toBe("sale.checkout"); expect(commands[0].data.customerId).toBe(customer.id); expect(commands[0].data.deliver).toBe(true);
  expect(commands[0].data.terms).toMatchObject({ downPaymentCents: 0, installmentCount: 1, firstDue: "2100-01-30" }); expect(commands[0].data.payment).toBeUndefined(); expect(navigations).toBe(0);
});

test("FIN-UI02 erro de conclusão conserva condição, carrinho e identidade da tentativa", async ({ page }) => {
  const { commands } = await connected(page, { command: (_input, index) => index === 1 ? { status: 503, body: { error: { code: "SERVICE_UNAVAILABLE", message: "Serviço indisponível", requestId: "qa-503" } } } : { body: { tenantId, entityType: "sale", entity: { id: "saved-qa", status: "confirmed", agreementId: "agreement-qa" } } } });
  const dialog = await openSale(page); await dialog.getByLabel("Vencimento", { exact: true }).fill("2100-01-30");
  await dialog.getByLabel("Entregar agora", { exact: true }).uncheck();
  await dialog.getByRole("button", { name: "Concluir venda", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible(); await expect(dialog.getByLabel("Vencimento", { exact: true })).toHaveValue("2100-01-30"); await expect(dialog.getByLabel("Produto 1", { exact: true })).toHaveValue(product.id);
  await dialog.getByRole("button", { name: "Concluir venda", exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect(commands).toHaveLength(2); expect(commands[0].requestId).toBe(commands[1].requestId); expect(commands[0].data).toEqual(commands[1].data);
});

test("FIN-UI03 leitura repetida do SKU agrega quantidade sem abrir outra linha ou confirmar a venda", async ({ page }) => {
  const { commands } = await connected(page); await page.goto("/operacao/"); await page.getByRole("button", { name: "Vendas", exact: true }).click(); await page.getByRole("button", { name: "Nova venda", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Nova venda", exact: true }), reader = dialog.getByLabel("Ler código ou SKU", { exact: true });
  await reader.fill(product.sku); await reader.press("Enter"); await expect(dialog.getByLabel("Produto 1", { exact: true })).toHaveValue(product.id);
  await reader.fill(product.sku); await reader.press("Enter"); await expect(dialog.getByLabel("Quantidade 1", { exact: true })).toHaveValue("2");
  await expect(dialog.getByLabel("Produto 2", { exact: true })).toHaveCount(0); expect(commands).toHaveLength(0);
});

test("FIN-UI15 código ambíguo fora do catálogo carregado não escolhe produto nem altera carrinho", async ({ page }) => {
  const { commands } = await connected(page);
  const resolutions: string[] = [];
  await page.route("**/operations/products?**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("code") !== product.gtin) { await route.fallback(); return; }
    resolutions.push(product.gtin);
    await route.fulfill({ json: { tenantId, items: [product, { ...product, id: "other-product", sku: "OTHER-SKU" }], total: 2, limit: 2, offset: 0 },
      headers: { "access-control-allow-origin": "http://127.0.0.1:3000", "access-control-allow-credentials": "true" } });
  });
  await page.goto("/operacao/"); await page.getByRole("button", { name: "Vendas", exact: true }).click();
  await page.getByRole("button", { name: "Nova venda", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Nova venda", exact: true });
  await expect(dialog.getByLabel("Produto 1", { exact: true }).locator("option")).toHaveCount(2);
  await dialog.getByLabel("Ler código ou SKU", { exact: true }).fill(product.gtin);
  await dialog.getByLabel("Ler código ou SKU", { exact: true }).press("Enter");
  await expect(dialog.getByRole("alert")).toContainText("mais de um produto");
  await expect(dialog.getByLabel("Produto 1", { exact: true })).toHaveValue("");
  expect(resolutions).toEqual([product.gtin]); expect(commands).toHaveLength(0);
});

test("FIN-UI04 entrada recebida e restante parcelado são conferidos e enviados juntos", async ({ page }) => {
  const { commands } = await connected(page); const dialog = await openSale(page);
  await dialog.getByLabel("Condição de pagamento", { exact: true }).selectOption("installments");
  await dialog.getByLabel("Entrada", { exact: true }).fill("20,00"); await dialog.getByLabel("Número de parcelas", { exact: true }).fill("4"); await dialog.getByLabel("Primeiro vencimento", { exact: true }).fill("2100-01-31");
  await dialog.getByLabel("Receber entrada agora", { exact: true }).check();
  await dialog.getByLabel("Meio de pagamento", { exact: true }).selectOption("pix"); await dialog.getByLabel("Conta", { exact: true }).selectOption(bank.id); await dialog.getByLabel("Referência", { exact: true }).fill("Crédito da entrada conferido"); await dialog.getByLabel("Crédito conferido manualmente", { exact: true }).check();
  await dialog.getByRole("button", { name: "Concluir venda", exact: true }).click();
  const receipt = page.getByRole("dialog", { name: "Recibo de recebimento", exact: true }); await expect(receipt).toBeVisible(); await expect(receipt).toContainText("20,00");
  await receipt.getByRole("button", { name: "Fechar recibo", exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect(commands).toHaveLength(1); expect(commands[0].data.terms).toMatchObject({ downPaymentCents: 2000, installmentCount: 4, firstDue: "2100-01-31" }); expect(commands[0].data.payment).toMatchObject({ amountCents: 2000, method: "pix", accountId: bank.id, creditConfirmed: true, reference: "Crédito da entrada conferido" });
});

test("FIN-UI05 receber por cliente distribui automaticamente várias parcelas em um POST e abre recibo", async ({ page }) => {
  const { commands } = await connected(page); const dialog = await openReceive(page);
  await dialog.getByRole("button", { name: "Confirmar recebimento", exact: true }).click(); await expect(dialog).toHaveCount(0);
  const receipt = page.getByRole("dialog", { name: "Recibo de recebimento", exact: true }); await expect(receipt).toBeVisible(); await expect(receipt).toContainText(customer.name); await expect(receipt).toContainText("150,00");
  expect(commands).toHaveLength(1); expect(commands[0].type).toBe("payment.receive"); expect(commands[0].data).toMatchObject({ customerId: customer.id, amountCents: 15000, method: "pix", accountId: bank.id, creditConfirmed: true }); expect(commands[0].data.allocations).toBeUndefined();
});

test("FIN-UI06 pagamento pendente bloqueia edição e falha preserva valor e tentativa para recuperação", async ({ page }) => {
  let release: (() => void) | undefined; const gate = new Promise<void>((resolve) => { release = resolve; });
  const { commands } = await connected(page, { command: async (_input, index) => { if (index === 1) { await gate; return { status: 503, body: { error: { code: "SERVICE_UNAVAILABLE", message: "Serviço indisponível", requestId: "qa-payment" } } }; } return { body: { tenantId, entityType: "payment", entity: paid() } }; } });
  const dialog = await openReceive(page);
  try {
    await dialog.getByRole("button", { name: "Confirmar recebimento", exact: true }).click(); await expect(dialog.getByLabel("Valor recebido", { exact: true })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Cancelar", exact: true })).toBeDisabled();
  } finally { release?.(); }
  await expect(dialog.getByRole("alert")).toBeVisible(); await expect(dialog.getByLabel("Valor recebido", { exact: true })).toHaveValue("150,00");
  await dialog.getByRole("button", { name: "Confirmar recebimento", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Recibo de recebimento", exact: true })).toBeVisible(); expect(commands).toHaveLength(2); expect(commands[0].requestId).toBe(commands[1].requestId);
});

test("FIN-UI07 perfil sem financeiro não consulta saldos e conserva o editor operacional anterior", async ({ page }) => {
  const { queries } = await connected(page, { rights: rights.filter((permission) => !permission.startsWith("finance.")) });
  const dialog = await openSale(page); await expect(page.getByRole("button", { name: "Financeiro", exact: true })).toHaveCount(0); await expect(dialog.getByLabel("Condição de pagamento", { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Confirmar venda", exact: true })).toBeVisible(); expect(queries.some((query) => query.includes("/finance/"))).toBe(false);
});

test("FIN-UI08 abrir caixa no contexto não conclui venda nem perde carrinho e condições em tela móvel", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const { commands } = await connected(page); const dialog = await openSale(page);
  await dialog.getByLabel("Condição de pagamento", { exact: true }).selectOption("cash");
  await dialog.getByLabel("Meio de pagamento", { exact: true }).selectOption("cash"); await dialog.getByLabel("Conta", { exact: true }).selectOption(cash.id);
  await dialog.getByRole("button", { name: "Abrir caixa aqui", exact: true }).click();
  const child = page.getByRole("dialog", { name: "Abrir caixa", exact: true }); await child.getByLabel("Conta", { exact: true }).selectOption(cash.id);
  await child.getByRole("button", { name: "Confirmar abertura", exact: true }).click(); await expect(child).toHaveCount(0);
  await expect(dialog.getByLabel("Cliente", { exact: true })).toHaveValue(customer.id); await expect(dialog.getByLabel("Produto 1", { exact: true })).toHaveValue(product.id); await expect(dialog.getByLabel("Condição de pagamento", { exact: true })).toHaveValue("cash");
  expect(commands).toHaveLength(1); expect(commands[0].type).toBe("shift.open"); await expect(dialog.getByRole("button", { name: "Concluir venda", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("FIN-UI09 fechar após confirmação e antes do recibo informa venda concluída e não permite reenviar", async ({ page }) => {
  let release: (() => void) | undefined; const gate = new Promise<void>((resolve) => { release = resolve; });
  const { commands } = await connected(page, { receiptGate: gate }), dialog = await openSale(page);
  await dialog.getByLabel("Condição de pagamento", { exact: true }).selectOption("cash"); await dialog.getByLabel("Meio de pagamento", { exact: true }).selectOption("pix"); await dialog.getByLabel("Conta", { exact: true }).selectOption(bank.id); await dialog.getByLabel("Referência", { exact: true }).fill("À vista conferido"); await dialog.getByLabel("Crédito conferido manualmente", { exact: true }).check();
  const response = page.waitForResponse((result) => result.request().method() === "POST" && result.url().endsWith("/commands"));
  try {
    await dialog.getByRole("button", { name: "Concluir venda", exact: true }).click(); await response;
    await expect(dialog.getByRole("button", { name: "Concluir venda", exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "Fechar janela", exact: true }).click(); await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("main")).toContainText("Venda concluída. O recibo pode ser consultado no Financeiro."); expect(commands).toHaveLength(1);
  } finally { release?.(); }
});

test("FIN-UI10 distribuição manual inválida não é silenciosamente tratada como zero", async ({ page }) => {
  const { commands } = await connected(page), dialog = await openReceive(page);
  await dialog.getByLabel("Valor recebido", { exact: true }).fill("100,00");
  await dialog.getByText("Alterar distribuição", { exact: true }).click();
  await dialog.getByLabel("Escolher valores por parcela", { exact: true }).check();
  const first = dialog.getByLabel(/Venda QA.*2100-01-01/), second = dialog.getByLabel(/Venda QA.*2100-02-01/);
  await first.fill("100,00"); await second.fill("abc");
  await expect(second).toHaveValue("abc"); expect(commands).toHaveLength(0);
  await expect(dialog.getByRole("button", { name: "Confirmar recebimento", exact: true })).toBeDisabled();
});

test("FIN-UI11 extrato reabre recibo anterior sem registrar outro pagamento", async ({ page }) => {
  const { commands, queries } = await connected(page, { receiptHistory: true });
  await page.goto("/operacao/"); await page.getByRole("button", { name: "Financeiro", exact: true }).click();
  await page.getByRole("button", { name: `Extrato de ${customer.name}`, exact: true }).click();
  const statement = page.getByRole("dialog", { name: `Extrato de ${customer.name}`, exact: true });
  const history = statement.getByRole("button", { name: "Recebimentos", exact: true }); await expect(history).toBeVisible(); await history.click();
  await statement.getByRole("button", { name: "Abrir recibo REC-QA", exact: true }).click();
  const receipt = page.getByRole("dialog", { name: "Recibo de recebimento", exact: true }); await expect(receipt).toBeVisible(); await expect(receipt).toContainText(customer.name); await expect(receipt).toContainText("150,00");
  expect(commands).toHaveLength(0); expect(queries.some((query) => query.startsWith("GET ") && query.endsWith("/payments"))).toBe(true);
});

test("FIN-UI12 preço pendente é resolvido na linha sem perder cliente/carrinho ou concluir a venda", async ({ page }) => {
  const { commands } = await connected(page, { pricePending: true }), dialog = await openSale(page);
  const action = dialog.getByRole("button", { name: "Definir preço aqui", exact: true }); await expect(action).toBeVisible(); await action.click();
  const child = page.getByRole("dialog", { name: "Definir preço", exact: true });
  await child.getByLabel("Preço de venda", { exact: true }).fill("25,00"); await child.getByRole("button", { name: "Salvar preço", exact: true }).click(); await expect(child).toHaveCount(0);
  await expect(dialog.getByLabel("Cliente", { exact: true })).toHaveValue(customer.id); await expect(dialog.getByLabel("Produto 1", { exact: true })).toHaveValue(product.id); await expect(dialog.getByLabel("Condição de pagamento", { exact: true })).toHaveValue("later");
  expect(commands).toHaveLength(1); expect(commands[0].type).toBe("product.update"); expect(commands[0].data).toMatchObject({ id: product.id, version: 1, salePriceCents: 2500 });
});

test("FIN-UI13 entrada de produto no contexto preserva condição e seleção sem concluir automaticamente", async ({ page }) => {
  const { commands } = await connected(page, { emptyStock: true }), dialog = await openSale(page);
  await dialog.getByLabel("Condição de pagamento", { exact: true }).selectOption("installments"); await dialog.getByLabel("Entrada", { exact: true }).fill("20,00"); await dialog.getByLabel("Número de parcelas", { exact: true }).fill("4"); await dialog.getByLabel("Primeiro vencimento", { exact: true }).fill("2100-01-31");
  const action = dialog.getByRole("button", { name: "Registrar entrada aqui", exact: true }); await expect(action).toBeVisible(); await action.click();
  const child = page.getByRole("dialog", { name: "Registrar entrada", exact: true }); await child.getByLabel("Quantidade", { exact: true }).fill("2"); await child.getByLabel("Referência da entrada", { exact: true }).fill("Entrada conferida QA");
  await child.getByRole("button", { name: "Confirmar entrada", exact: true }).click(); await expect(child).toHaveCount(0);
  await expect(dialog.getByLabel("Cliente", { exact: true })).toHaveValue(customer.id); await expect(dialog.getByLabel("Produto 1", { exact: true })).toHaveValue(product.id); await expect(dialog.getByLabel("Condição de pagamento", { exact: true })).toHaveValue("installments"); await expect(dialog.getByLabel("Entrada", { exact: true })).toHaveValue("20,00");
  await expect(dialog.getByLabel("Produto 1", { exact: true }).locator(`option[value="${product.id}"]`)).toContainText("2 disponíveis"); expect(commands).toHaveLength(1); expect(commands[0].type).toBe("stock.receive"); expect(commands[0].data).toMatchObject({ productId: product.id, quantity: 2, reference: "Entrada conferida QA" });
});

test("FIN-UI14 Escape na abertura de caixa fecha somente o auxiliar e preserva a venda preenchida", async ({ page }) => {
  const { commands } = await connected(page), dialog = await openSale(page);
  await dialog.getByLabel("Condição de pagamento", { exact: true }).selectOption("cash"); await dialog.getByLabel("Meio de pagamento", { exact: true }).selectOption("cash"); await dialog.getByLabel("Conta", { exact: true }).selectOption(cash.id);
  await dialog.getByRole("button", { name: "Abrir caixa aqui", exact: true }).click();
  const child = page.getByRole("dialog", { name: "Abrir caixa", exact: true }); await expect(child).toBeVisible();
  await page.keyboard.press("Escape"); await expect(child).toHaveCount(0); await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Cliente", { exact: true })).toHaveValue(customer.id); await expect(dialog.getByLabel("Produto 1", { exact: true })).toHaveValue(product.id); await expect(dialog.getByLabel("Condição de pagamento", { exact: true })).toHaveValue("cash");
  expect(commands).toHaveLength(0);
});
