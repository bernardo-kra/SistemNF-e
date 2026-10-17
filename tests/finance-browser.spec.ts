import { expect, test, type Download, type Page } from "@playwright/test";
import type { DemoState } from "../src/lib/domain";
import { financeFixture } from "./finance-fixtures";

async function seedBrowser(page: Page, state: unknown = financeFixture()) {
  await page.clock.install({ time: new Date("2026-10-17T12:00:00.000Z") });
  await page.addInitScript((initial) => {
    if (!localStorage.getItem("sistem:prototype:v1"))
      localStorage.setItem("sistem:prototype:v1", JSON.stringify(initial));
  }, state);
}
async function savedState(page: Page): Promise<DemoState> {
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem("sistem:prototype:v1")!),
  );
}
async function createSaleAgreement(page: Page) {
  await page.goto("/financeiro/?source=sale:s400");
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", {
      name: "Criar acordo de pagamento",
      exact: true,
    }),
  ).toBeVisible();
  await dialog.getByLabel("Entrada (R$)", { exact: true }).fill("300");
  await dialog
    .getByLabel("Vencimento da entrada", { exact: true })
    .fill("2026-10-17");
  await dialog.getByLabel("Quantidade de parcelas", { exact: true }).fill("3");
  await dialog
    .getByLabel("Primeiro vencimento", { exact: true })
    .fill("2026-11-17");
  await dialog
    .getByRole("button", { name: "Confirmar acordo", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Receber Entrada de Venda #400",
      exact: true,
    }),
  ).toBeVisible();
}
async function openDownPayment(page: Page) {
  await page
    .getByRole("button", { name: "Receber Entrada de Venda #400", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Receber parcela", exact: true }),
  ).toBeVisible();
}
async function fillBankPayment(page: Page, method: "pix" | "transfer" = "pix") {
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Valor a aplicar (R$)", { exact: true }).fill("200");
  await dialog
    .getByLabel("Forma de pagamento", { exact: true })
    .selectOption(method);
  await dialog
    .getByLabel("Conta de destino", { exact: true })
    .selectOption("bank-demo");
  await dialog
    .getByLabel("Responsável pela conferência", { exact: true })
    .fill("Operadora QA");
  await dialog
    .getByLabel("Referência do crédito", { exact: true })
    .fill("CREDITO-QA-FICTICIO");
}
async function closeReceipt(page: Page) {
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Recibo demonstrativo", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
}
async function downloadedText(download: Download) {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("O arquivo de demonstração não pôde ser lido.");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

test("entrada + parcelas, baixa parcial conferida, recibo e reload preservam dinheiro e saldo", async ({
  page,
}) => {
  await seedBrowser(page);
  await createSaleAgreement(page);
  let state = await savedState(page);
  expect(state.finance.installments.map((item) => item.amount)).toEqual([
    30000, 30000, 30000, 30000,
  ]);
  expect(state.finance.movements).toEqual([]);
  await openDownPayment(page);
  await fillBankPayment(page);
  await page
    .getByLabel("Conferi o crédito na conta de destino", { exact: true })
    .check();
  await page
    .getByRole("button", { name: "Confirmar recebimento", exact: true })
    .click();
  const receipt = page.getByRole("dialog");
  await expect(receipt).toContainText("REC-DEMO-00001");
  await expect(receipt).toContainText("R$ 200,00");
  await expect(receipt).toContainText("R$ 100,00");
  await expect(
    receipt.getByRole("button", { name: "Baixar recibo (.txt)", exact: true }),
  ).toBeVisible();
  const pendingDownload = page.waitForEvent("download");
  await receipt
    .getByRole("button", { name: "Baixar recibo (.txt)", exact: true })
    .click();
  const download = await pendingDownload;
  expect(download.suggestedFilename()).toBe("REC-DEMO-00001.txt");
  const copy = (await downloadedText(download)).replace(/\s/g, " ");
  expect(copy).toContain("Rafael Almeida");
  expect(copy).toContain("Venda #400");
  expect(copy).toContain("R$ 200,00");
  expect(copy).toContain("R$ 100,00");
  state = await savedState(page);
  const payment = structuredClone(state.finance.payments[0]);
  expect(payment).toMatchObject({
    amount: 20000,
    method: "pix",
    receivedOn: "2026-10-17",
    receipt: { amount: 20000, remaining: 10000 },
  });
  expect(state.finance.payments).toHaveLength(1);
  expect(state.finance.movements).toHaveLength(1);
  expect(state.finance.allocations).toHaveLength(1);
  await closeReceipt(page);
  await page.reload();
  await page.getByRole("tab", { name: "Parcelas", exact: true }).click();
  const entry = page
    .getByRole("row")
    .filter({ hasText: "Venda #400" })
    .filter({ hasText: "Entrada" });
  await expect(entry).toContainText("R$ 100,00");
  expect((await savedState(page)).finance.payments[0]).toEqual(payment);
  await page.getByRole("tab", { name: "Recebimentos", exact: true }).click();
  await expect(page.getByText("REC-DEMO-00001", { exact: true })).toBeVisible();
});

test("Pix sem confirmação não baixa e mantém valores para correção; transferência pode quitar parcialmente", async ({
  page,
}) => {
  await seedBrowser(page);
  await createSaleAgreement(page);
  await openDownPayment(page);
  await fillBankPayment(page, "transfer");
  const button = page.getByRole("button", {
    name: "Confirmar recebimento",
    exact: true,
  });
  // A camada de domínio também cobre o envio inválido: a interface pode desabilitar ou apresentar erro.
  if (await button.isEnabled()) {
    await button.click();
    await expect(
      page.getByRole("heading", { name: "Receber parcela", exact: true }),
    ).toBeVisible();
  }
  expect((await savedState(page)).finance.movements).toEqual([]);
  await expect(
    page.getByLabel("Valor a aplicar (R$)", { exact: true }),
  ).toHaveValue("200");
  await expect(
    page.getByLabel("Referência do crédito", { exact: true }),
  ).toHaveValue("CREDITO-QA-FICTICIO");
  await page
    .getByLabel("Conferi o crédito na conta de destino", { exact: true })
    .check();
  await button.click();
  await closeReceipt(page);
  expect((await savedState(page)).finance.payments[0]).toMatchObject({
    method: "transfer",
    amount: 20000,
  });
});

test("dinheiro exige caixa; troco, fechamento divergente e reabertura não inventam receita", async ({
  page,
}) => {
  await seedBrowser(page);
  await createSaleAgreement(page);
  await openDownPayment(page);
  await page
    .getByLabel("Forma de pagamento", { exact: true })
    .selectOption("cash");
  await page.getByLabel("Valor a aplicar (R$)", { exact: true }).fill("150");
  await page.getByLabel("Valor entregue (R$)", { exact: true }).fill("200");
  await page
    .getByLabel("Responsável pela conferência", { exact: true })
    .fill("Operadora QA");
  const confirm = page.getByRole("button", {
    name: "Confirmar recebimento",
    exact: true,
  });
  if (await confirm.isEnabled()) await confirm.click();
  expect((await savedState(page)).finance.movements).toEqual([]);
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Caixa e contas", exact: true }).click();
  await page.getByRole("button", { name: "Abrir caixa", exact: true }).click();
  await page
    .getByLabel("Operador do caixa", { exact: true })
    .fill("Operadora QA");
  await page
    .getByRole("button", { name: "Confirmar abertura", exact: true })
    .click();
  expect((await savedState(page)).finance.movements).toEqual([]);
  await page.getByRole("tab", { name: "Parcelas", exact: true }).click();
  await openDownPayment(page);
  await page
    .getByLabel("Forma de pagamento", { exact: true })
    .selectOption("cash");
  await page.getByLabel("Valor a aplicar (R$)", { exact: true }).fill("150");
  await page.getByLabel("Valor entregue (R$)", { exact: true }).fill("200");
  await page
    .getByLabel("Responsável pela conferência", { exact: true })
    .fill("Operadora QA");
  await page
    .getByRole("button", { name: "Confirmar recebimento", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("R$ 50,00");
  await closeReceipt(page);
  await page.getByRole("tab", { name: "Caixa e contas", exact: true }).click();
  await page.getByRole("button", { name: "Fechar caixa", exact: true }).click();
  await page.getByLabel("Valor contado (R$)", { exact: true }).fill("149");
  await page.getByLabel("Conferido por", { exact: true }).fill("Gestora QA");
  await page
    .getByRole("button", { name: "Confirmar fechamento", exact: true })
    .click();
  let state = await savedState(page);
  expect(state.finance.shifts[0]).toMatchObject({
    expected: 15000,
    counted: 14900,
    difference: -100,
    status: "closed",
  });
  expect(state.finance.movements).toHaveLength(1);
  expect(state.finance.movements[0].amount).toBe(15000);
  await page.getByRole("button", { name: "Abrir caixa", exact: true }).click();
  await page
    .getByLabel("Operador do caixa", { exact: true })
    .fill("Operador 2 QA");
  await page
    .getByRole("button", { name: "Confirmar abertura", exact: true })
    .click();
  state = await savedState(page);
  expect(state.finance.shifts[0]).toMatchObject({
    status: "open",
    openingBalance: 15000,
  });
  expect(
    state.finance.shifts.find((item) => item.status === "closed")!.difference,
  ).toBe(-100);
  expect(state.finance.movements).toHaveLength(1);
});

test("migração do navegador conserva legado sem gerar caixa nem esconder aviso de simulação", async ({
  page,
}) => {
  const { finance: _finance, ...legacy } = financeFixture();
  await seedBrowser(page, { ...legacy, version: 2 });
  await page.goto("/financeiro/");
  await expect(
    page.getByRole("heading", { name: "Financeiro", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Criar acordo", exact: true }),
  ).toBeEnabled();
  const restored = await savedState(page);
  expect(restored.version).toBe(3);
  expect(restored.orders).toEqual(legacy.orders);
  expect(restored.finance.payments).toEqual([]);
  expect(restored.finance.movements).toEqual([]);
  expect(
    restored.finance.accounts.every((item) => item.openingBalance === 0),
  ).toBe(true);
  await expect(page.getByText(/Histórico informado nas OS/i)).toBeVisible();
  await page.reload();
  expect((await savedState(page)).finance.movements).toEqual([]);
});

test("falha de restauração financeira preserva arquivo original e bloqueia gravação", async ({
  page,
}) => {
  const broken = financeFixture();
  broken.finance.accounts[0].openingBalance = -1;
  await seedBrowser(page, broken);
  await page.goto("/financeiro/");
  await expect(
    page.getByText(
      /dados locais não puderam ser recuperados e foram preservados/i,
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("sistem:prototype:v1")),
  ).toBe(JSON.stringify(broken));
  await page.reload();
  await expect(
    page
      .getByRole("alert")
      .getByText("Gravação está bloqueada ou indisponível", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("sistem:prototype:v1")),
  ).toBe(JSON.stringify(broken));
  await expect(
    page.getByRole("button", { name: "Criar acordo", exact: true }),
  ).toBeDisabled();
  await page.goto("/configuracoes/");
  const pendingDownload = page.waitForEvent("download");
  await page
    .getByRole("button", {
      name: "Exportar arquivo local original",
      exact: true,
    })
    .click();
  const download = await pendingDownload;
  expect(download.suggestedFilename()).toBe("sistem-original-local.json");
  expect(await downloadedText(download)).toBe(JSON.stringify(broken));
});

test("aba aberta na virada de São Paulo mostra o recebimento na nova data-base", async ({
  page,
}) => {
  await seedBrowser(page);
  await createSaleAgreement(page);
  await expect(page.getByText(/Data-base financeira:/)).toContainText(
    "17 de out.",
  );
  await page.clock.setFixedTime(new Date("2026-10-18T03:30:00.000Z"));
  await openDownPayment(page);
  await fillBankPayment(page);
  await page
    .getByLabel("Conferi o crédito na conta de destino", { exact: true })
    .check();
  await page
    .getByRole("button", { name: "Confirmar recebimento", exact: true })
    .click();
  await closeReceipt(page);
  expect((await savedState(page)).finance.payments[0].receivedOn).toBe(
    "2026-10-18",
  );
  await expect(page.getByText(/Data-base financeira:/)).toContainText(
    "18 de out.",
  );
  await expect(
    page
      .getByRole("region", { name: "Resumo financeiro", exact: true })
      .locator(".finance-stat")
      .filter({ hasText: "Novos recebimentos" }),
  ).toContainText("R$ 200,00");
});

test("parcelamento e recebimento funcionam no celular com foco, Escape e sem vazamento de largura", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedBrowser(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await createSaleAgreement(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("tab", { name: "Parcelas", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Caixa e contas", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("tab", { name: "Caixa e contas", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(
    page.getByRole("tab", { name: "Recebimentos", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Home");
  await expect(
    page.getByRole("tab", { name: "Operações", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Parcelas", exact: true }),
  ).toBeFocused();
  await openDownPayment(page);
  await fillBankPayment(page);
  await page
    .getByLabel("Conferi o crédito na conta de destino", { exact: true })
    .check();
  expect(
    await page
      .getByRole("dialog")
      .evaluate((dialog) => dialog.contains(document.activeElement)),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Confirmar recebimento", exact: true })
    .click();
  await closeReceipt(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
