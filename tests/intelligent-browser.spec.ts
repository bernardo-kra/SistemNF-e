import { expect, test, type Page } from "@playwright/test";
import { intelligentAt, intelligentFixture, intelligentKey, knownPurchasing, purchaseDocument, purchaseLine, savedIntelligent, startIntelligent, uploadPurchase, expectNoMoneyOrFiscal } from "./intelligent-helpers";

async function receiveMode(page: Page) {
  await expect(page.getByLabel("Registrar recebimento", { exact: true })).toBeVisible({ timeout: 2000 });
  await page.getByLabel("Registrar recebimento", { exact: true }).check();
}
async function confirmPurchase(page: Page, receive = false) {
  const action = page.getByRole("button", { name: receive ? "Confirmar recebimento" : "Confirmar cadastros", exact: true });
  await expect(action).toBeVisible({ timeout: 2000 });
  await action.click();
  await expect(page.getByText("Importação concluída", { exact: true })).toBeVisible();
}
async function activateReader(page: Page) {
  const action = page.getByRole("button", { name: "Ativar leitor de OS", exact: true });
  await expect(action).toBeVisible({ timeout: 2000 });
  await action.click();
}
async function readCode(page: Page, code = "SISTEM-OS:o1040") {
  await page.keyboard.type(code);
  await page.keyboard.press("Enter");
}
async function beginPrint(page: Page) {
  await page.addInitScript(() => {
    const context = window as Window & { __qaPrints?: number };
    context.__qaPrints = 0;
    window.print = () => { context.__qaPrints = (context.__qaPrints || 0) + 1; };
  });
}

for (const count of [50, 500]) {
  test(`USO-01/09 ${count} vínculos conhecidos: upload e uma confirmação, sem ações por item ou navegação`, async ({ page }, info) => {
    const state = intelligentFixture();
    const document = purchaseDocument({ key: `QA-LOTE-${count}`, items: Array.from({ length: count }, (_, i) => purchaseLine({ id: String(i + 1), code: `000${i}`, quantity: 1 })) });
    state.purchasing = knownPurchasing(document);
    await startIntelligent(page, "/importar/", state);
    const before = await savedIntelligent(page);
    const route = page.url();
    let navigations = 0;
    const requests: string[] = [];
    page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigations++; });
    page.on("request", (request) => { if (["fetch", "xhr"].includes(request.resourceType()) && !request.url().includes("__next")) requests.push(request.url()); });
    const started = Date.now();
    await uploadPurchase(page, document);
    await expect(page.getByLabel("Registrar recebimento", { exact: true })).toBeVisible({ timeout: 2000 });
    const preparedMs = Date.now() - started;
    await expect(page.getByRole("button", { name: "Revisar cadastro", exact: true })).toHaveCount(0);
    await receiveMode(page);
    const confirming = Date.now();
    await confirmPurchase(page, true);
    const persistedMs = Date.now() - confirming;
    const after = await savedIntelligent(page);
    expect(after.products).toHaveLength(before.products.length);
    expect(after.products.find((product) => product.id === "cover-15pro")).toMatchObject({ stock: 2 + count, reserved: 1, price: 2500 });
    expect(after.purchasing?.receipts).toHaveLength(1);
    expect(after.purchasing?.receipts[0].items).toHaveLength(count);
    expectNoMoneyOrFiscal(after, before);
    expect(page.url()).toBe(route);
    expect(navigations).toBe(0);
    expect(requests).toEqual([]);
    const measurement = { environment: "Chrome local, Playwright, dados fictícios", count, uploadToSummaryMs: preparedMs, confirmationToSavedMs: persistedMs, perLineActions: 0, typedFields: 0, documentNavigations: navigations, applicationFetches: requests.length };
    await info.attach(`uso-${count}-medicao`, { body: JSON.stringify(measurement), contentType: "application/json" });
    console.log("QA_USO_MEDICAO", JSON.stringify(measurement));
  });
}

test("USO-02 47 resolvidos e três dúvidas independentes mantêm decisões na mesma página", async ({ page }) => {
  const state = intelligentFixture();
  const resolved = Array.from({ length: 47 }, (_, i) => purchaseLine({ id: String(i + 1), code: `known-${i}`, quantity: 1 }));
  const doubts = ["CAPA IPHONE 15 PRO CORES SORTIDAS A", "CAPA IPHONE 15 PRO CORES SORTIDAS B", "CAPA IPHONE 15 PRO CORES SORTIDAS C"].map((description, i) => purchaseLine({ id: String(48 + i), code: `doubt-${i}`, description, quantity: 1 }));
  const document = purchaseDocument({ items: [...resolved, ...doubts] });
  state.purchasing = knownPurchasing({ ...document, items: resolved });
  await startIntelligent(page, "/importar/", state);
  await uploadPurchase(page, document);
  await expect(page.getByLabel("Somente cadastrar", { exact: true })).toBeVisible({ timeout: 2000 });
  // O nome acessível do select exclui as opções; o texto bruto do label não.
  const destination = (description: string) => page.getByRole("combobox", { name: `Ação para ${description}`, exact: true });
  for (const line of doubts) await expect(destination(line.description)).toBeVisible();
  await destination(doubts[0].description).selectOption("ignore");
  await destination(doubts[1].description).selectOption("new");
  await destination(doubts[2].description).selectOption("ignore");
  await expect(destination(doubts[0].description)).toHaveValue("ignore");
  await expect(destination(doubts[1].description)).toHaveValue("new");
  const before = await savedIntelligent(page);
  await confirmPurchase(page);
  const after = await savedIntelligent(page);
  expect(after.products).toHaveLength(before.products.length + 1);
  expect(after.purchasing?.documents[0].lines).toHaveLength(50);
  expect(after.purchasing?.receipts).toEqual([]);
  expectNoMoneyOrFiscal(after, before);
});

test("NOM-02 XML preserva identificador alfanumérico do fornecedor e reutiliza vínculo conhecido", async ({ page }) => {
  const state = intelligentFixture();
  const document = purchaseDocument({ key: "QA-ALFA-001", supplierId: "AB123456000199" });
  state.purchasing = knownPurchasing(document);
  await startIntelligent(page, "/importar/", state);
  const before = await savedIntelligent(page);
  await uploadPurchase(page, document);
  await expect(page.getByLabel("Somente cadastrar", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Dúvidas da importação", exact: true })).toHaveCount(0);
  await confirmPurchase(page);
  const after = await savedIntelligent(page);
  expect(after.purchasing?.documents[0].supplierId).toBe("AB123456000199");
  expect(after.purchasing?.links).toHaveLength(1);
  expect(after.products).toEqual(before.products);
  expectNoMoneyOrFiscal(after, before);
});

test("USO-03 recebe novo produto sem preço e só libera venda depois de definir preço", async ({ page }) => {
  const document = purchaseDocument({ items: [purchaseLine({ id: "1", code: "QA-CABO-NOVO", description: "CABO USB-C PARA USB-C 2 METROS 100W", quantity: 3 })] });
  await startIntelligent(page);
  const before = await savedIntelligent(page);
  await uploadPurchase(page, document);
  await receiveMode(page);
  await confirmPurchase(page, true);
  const after = await savedIntelligent(page);
  const product = after.products.find((p) => !before.products.some((old) => old.id === p.id))!;
  expect(product).toMatchObject({ stock: 3, reserved: 0, pricePending: true });
  expectNoMoneyOrFiscal(after, before);
  await page.goto("/demo/vendas/");
  await page.getByRole("button", { name: "Nova venda", exact: true }).click();
  let sale = page.getByRole("dialog", { name: "Nova venda", exact: true });
  await sale.getByLabel(/^Produto/).selectOption(product.id);
  await expect(sale.getByRole("button", { name: "Confirmar e reservar", exact: true })).toBeDisabled();
  await expect(sale).toContainText(/preço.*pendente|defin.*preço/i);
  await sale.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.goto("/demo/produtos/");
  await page.getByRole("button", { name: `Editar ${product.name}`, exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Editar produto", exact: true });
  await editor.getByLabel(/^Preço de venda/).fill("49.90");
  await editor.getByRole("button", { name: "Salvar produto", exact: true }).click();
  await expect(editor).toHaveCount(0);
  expect((await savedIntelligent(page)).products.find((p) => p.id === product.id)).toMatchObject({ price: 4990, pricePending: false });
  await page.goto("/demo/vendas/");
  await page.getByRole("button", { name: "Nova venda", exact: true }).click();
  sale = page.getByRole("dialog", { name: "Nova venda", exact: true });
  await sale.getByLabel(/^Produto/).selectOption(product.id);
  await expect(sale.getByRole("button", { name: "Confirmar e reservar", exact: true })).toBeEnabled();
});

test("USO-08 falha de gravação não conclui importação nem perde documento e escolhas", async ({ page }) => {
  const state = intelligentFixture();
  const document = purchaseDocument();
  state.purchasing = knownPurchasing(document);
  await startIntelligent(page, "/importar/", state);
  await uploadPurchase(page, document);
  await receiveMode(page);
  const before = await savedIntelligent(page);
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (item, value) { if (item === key) throw new DOMException("QA fictício: gravação negada", "QuotaExceededError"); return original.call(this, item, value); };
  }, intelligentKey);
  await page.getByRole("button", { name: "Confirmar recebimento", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(page.getByText("Importação concluída", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Registrar recebimento", { exact: true })).toBeChecked();
  await expect(page.getByRole("button", { name: "Confirmar recebimento", exact: true })).toBeVisible();
  expect(await savedIntelligent(page)).toEqual(before);
});

test("LEI-01/10 salvar e imprimir reutiliza campos, gera uma OS e mascara documento", async ({ page }) => {
  const state = intelligentFixture();
  state.customers[0].document = "52998224725";
  await beginPrint(page);
  await startIntelligent(page, "/ordens/", state);
  await page.getByRole("button", { name: "Nova ordem de serviço", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Nova ordem de serviço", exact: true });
  await form.getByLabel(/^Equipamento \/ marca e modelo/).fill("Notebook recebido para impressão");
  await form.getByLabel(/^Número de série/).fill("SERIE-QA-IMPRESSAO");
  await form.getByRole("textbox", { name: /^Problema relatado/ }).fill("Falha de inicialização.");
  const action = form.getByRole("button", { name: "Salvar e imprimir", exact: true });
  await expect(action).toBeVisible({ timeout: 2000 });
  const before = await savedIntelligent(page);
  await action.click();
  const receipt = page.getByRole("region", { name: "Comprovante da ordem de serviço", exact: true });
  await expect(receipt).toContainText("Notebook recebido para impressão");
  await expect(receipt).toContainText("SERIE-QA-IMPRESSAO");
  await expect(receipt).toContainText(state.customers[0].name);
  await expect(receipt).not.toContainText("52998224725");
  await expect(receipt).not.toContainText("529.982.247-25");
  const after = await savedIntelligent(page);
  expect(after.orders).toHaveLength(before.orders.length + 1);
  expect(after.customers).toEqual(before.customers);
  expect(after.finance).toEqual(before.finance);
  expect(after.products).toEqual(before.products);
  const code = await receipt.locator("[data-order-code]").getAttribute("data-order-code");
  expect(code).toBe(`SISTEM-OS:${after.orders[0].id}`);
  await expect.poll(() => page.evaluate(() => (window as Window & { __qaPrints?: number }).__qaPrints)).toBe(1);
});

test("LEI-02 reimprimir mantém referência e estado sem gerar operação", async ({ page }) => {
  await beginPrint(page);
  await startIntelligent(page, "/ordens/?os=o1040");
  const action = page.getByRole("button", { name: "Imprimir comprovante", exact: true });
  await expect(action).toBeVisible({ timeout: 2000 });
  const before = await savedIntelligent(page);
  await action.click();
  const receipt = page.getByRole("region", { name: "Comprovante da ordem de serviço", exact: true });
  await expect(receipt).toContainText("1040");
  const code = await receipt.locator("[data-order-code]").getAttribute("data-order-code");
  // A impressão abre um diálogo: a reimpressão usa a ação acessível do próprio diálogo.
  await page.getByRole("dialog").getByRole("button", { name: "Imprimir comprovante", exact: true }).click();
  expect(await receipt.locator("[data-order-code]").getAttribute("data-order-code")).toBe(code);
  expect(await savedIntelligent(page)).toEqual(before);
  await expect.poll(() => page.evaluate(() => (window as Window & { __qaPrints?: number }).__qaPrints)).toBe(2);
});

test("LEI-03/07 leitor abre OS atual sem busca ou mutação, inclusive leitura repetida", async ({ page }) => {
  await startIntelligent(page, "/ordens/");
  await activateReader(page);
  const before = await savedIntelligent(page);
  await readCode(page);
  await expect(page.getByRole("heading", { name: "OS #1040", exact: true })).toBeVisible();
  expect(await savedIntelligent(page)).toEqual(before);
  await readCode(page);
  await expect(page.getByRole("heading", { name: "OS #1040", exact: true })).toBeVisible();
  expect(await savedIntelligent(page)).toEqual(before);
});

test("LEI-08 leitor desconhecido preserva contexto e não executa conteúdo", async ({ page }) => {
  await startIntelligent(page, "/ordens/");
  await activateReader(page);
  const before = await savedIntelligent(page);
  await readCode(page, "SISTEM-OS:missing-order");
  await expect(page.getByRole("status")).toContainText(/não encontr|desconhecid/i);
  await expect(page.getByRole("heading", { name: "Ordens de serviço", exact: true })).toBeVisible();
  expect(await savedIntelligent(page)).toEqual(before);
});

test("LEI-06 leitura de OS já entregue abre histórico sem repetir entrega", async ({ page }) => {
  const state = intelligentFixture();
  state.orders.find((order) => order.id === "o1040")!.stage = "delivered";
  await startIntelligent(page, "/ordens/", state);
  await activateReader(page);
  const before = await savedIntelligent(page);
  await readCode(page);
  await expect(page.getByRole("heading", { name: "OS #1040", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Histórico", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Atendimento concluído", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Confirmar entrega a Rafael Almeida", exact: true })).toHaveCount(0);
  expect(await savedIntelligent(page)).toEqual(before);
});

test("LEI-09 leitor suspenso preserva rascunho e Enter do código não envia formulário principal", async ({ page }) => {
  await startIntelligent(page, "/ordens/");
  await activateReader(page);
  await page.getByRole("button", { name: "Nova ordem de serviço", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Nova ordem de serviço", exact: true });
  await form.getByLabel(/^Equipamento \/ marca e modelo/).fill("Rascunho preservado");
  await form.getByRole("textbox", { name: /^Problema relatado/ }).fill("Digitação normal do atendente.");
  const before = await savedIntelligent(page);
  await form.getByLabel(/^Número de série/).focus();
  await readCode(page);
  await expect(form).toBeVisible();
  await expect(form.getByLabel(/^Equipamento \/ marca e modelo/)).toHaveValue("Rascunho preservado");
  await expect(form.getByRole("textbox", { name: /^Problema relatado/ })).toHaveValue("Digitação normal do atendente.");
  expect(await savedIntelligent(page)).toEqual(before);
  await expect(page.getByText(/leitor.*suspens|leitura.*suspens/i)).toBeVisible();
});

test("LEI-04/07 entrega ao cliente conhecido é ação própria única e não registra pagamento", async ({ page }) => {
  await startIntelligent(page, "/ordens/?os=o1040");
  const action = page.getByRole("button", { name: "Confirmar entrega a Rafael Almeida", exact: true });
  await expect(action).toBeVisible({ timeout: 2000 });
  const before = await savedIntelligent(page);
  await action.dblclick();
  await expect(page.getByText("Atendimento concluído", { exact: false }).first()).toBeVisible();
  const after = await savedIntelligent(page);
  const old = before.orders.find((order) => order.id === "o1040")!;
  const delivered = after.orders.find((order) => order.id === "o1040")!;
  expect(delivered.stage).toBe("delivered");
  expect(delivered.history).toHaveLength(old.history.length + 1);
  expect(delivered.history[0].label).toContain("Rafael Almeida");
  expect(after.finance).toEqual(before.finance);
  expect(after.products).toEqual(before.products);
  expect(after.documents).toEqual(before.documents);
  await expect(action).toHaveCount(0);
});

test("LEI-05 retirada por outra pessoa pede apenas exceção e mantém nome no histórico", async ({ page }) => {
  await startIntelligent(page, "/ordens/?os=o1040");
  const action = page.getByRole("button", { name: "Outra pessoa vai retirar", exact: true });
  await expect(action).toBeVisible({ timeout: 2000 });
  await action.click();
  await page.getByLabel(/^Nome do responsável pela retirada/).fill("Pessoa autorizada fictícia");
  await page.getByLabel("Equipamento e acessórios foram conferidos e entregues.", { exact: true }).check();
  const before = await savedIntelligent(page);
  await page.getByRole("button", { name: "Confirmar etapa", exact: true }).click();
  const after = await savedIntelligent(page);
  expect(after.orders.find((order) => order.id === "o1040")?.history[0].label).toContain("Pessoa autorizada fictícia");
  expect(after.finance).toEqual(before.finance);
});

test("LEI-05 testes incompletos ou saldo aberto aparecem como impedimento sem entrega inferida", async ({ page }) => {
  const state = intelligentFixture();
  const ready = state.orders.find((order) => order.id === "o1040")!;
  ready.tested = false;
  ready.received = 0;
  await startIntelligent(page, "/ordens/?os=o1040", state);
  const before = await savedIntelligent(page);
  await expect(page.getByText(/testes.*pend|testes.*conclu|checklist.*pend/i).first()).toBeVisible({ timeout: 2000 });
  const action = page.getByRole("button", { name: "Confirmar entrega a Rafael Almeida", exact: true });
  await expect(action).toBeDisabled();
  expect(await savedIntelligent(page)).toEqual(before);
});

test("LEI-05 saldo pendente exige aceite demonstrativo e não quita a OS", async ({ page }) => {
  const state = intelligentFixture();
  const ready = state.orders.find((order) => order.id === "o1040")!;
  ready.received = 0;
  await startIntelligent(page, "/ordens/?os=o1040", state);
  const before = await savedIntelligent(page);
  const action = page.getByRole("button", { name: "Confirmar entrega a Rafael Almeida", exact: true });
  await expect(action).toBeVisible({ timeout: 2000 });
  await expect(action).toBeDisabled();
  await page.getByLabel("Confirmo a entrega com saldo pendente nesta demonstração", { exact: true }).check();
  await expect(action).toBeEnabled();
  await action.click();
  const after = await savedIntelligent(page);
  expect(after.orders.find((order) => order.id === "o1040")).toMatchObject({ stage: "delivered", received: 0 });
  expect(after.finance).toEqual(before.finance);
  expect(after.products).toEqual(before.products);
  expect(after.documents).toEqual(before.documents);
});

test("LEI-05 etapa pronta sem aprovação não autoriza entrega nem com aceite de saldo", async ({ page }) => {
  const state = intelligentFixture();
  const ready = state.orders.find((order) => order.id === "o1040")!;
  ready.approved = false;
  ready.received = 0;
  await startIntelligent(page, "/ordens/?os=o1040", state);
  const before = await savedIntelligent(page);
  const action = page.getByRole("button", { name: "Confirmar entrega a Rafael Almeida", exact: true });
  await expect(action).toBeVisible({ timeout: 2000 });
  await page.getByLabel("Confirmo a entrega com saldo pendente nesta demonstração", { exact: true }).check();
  await expect(action).toBeDisabled();
  expect(await savedIntelligent(page)).toEqual(before);
});
