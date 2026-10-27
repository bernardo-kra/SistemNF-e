import { expect, test, type Locator, type Page } from "@playwright/test";
import type { DemoState } from "../src/lib/domain";
import {
  installmentBalance,
  openCashShift,
  prepareAgreement,
  recordPayment,
} from "../src/lib/finance/engine";
import type { PaymentInput } from "../src/lib/finance/types";
import { financeFixture } from "./finance-fixtures";

// ABR-01..07: expectativas da especificação, escritas antes do comportamento.
// Estado e banco são exclusivamente fictícios; não há garantia entre abas.
const at = "2026-10-18T12:00:00.000Z";
const day = "2026-10-18";
const storageKey = "sistem:prototype:v1";

function fixture() {
  return prepareAgreement(
    financeFixture(),
    {
      source: { type: "sale", id: "s400" },
      downPayment: 30000,
      downPaymentDue: day,
      installmentCount: 3,
      firstDue: "2026-11-18",
    },
    "abr-agreement",
    at,
  );
}

async function saved(page: Page): Promise<DemoState> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), storageKey);
}

function expectNoPayment(state: DemoState) {
  expect(state.finance.payments).toEqual([]);
  expect(state.finance.allocations).toEqual([]);
  expect(state.finance.movements).toEqual([]);
  expect(installmentBalance(state, "abr-agreement:item:0")).toBe(30000);
}

async function start(page: Page, state = fixture()) {
  await page.clock.install({ time: new Date(at) });
  await page.addInitScript(({ initial, key }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(initial));
  }, { initial: state, key: storageKey });
  await page.goto("/demo/financeiro/");
  await page.getByRole("tab", { name: "Parcelas", exact: true }).click();
  await page.getByRole("button", { name: "Receber Entrada de Venda #400", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Receber parcela", exact: true })).toBeVisible();
  return dialog;
}

async function fillCash(dialog: Locator) {
  await dialog.getByLabel("Forma de pagamento", { exact: true }).selectOption("cash");
  await dialog.getByLabel("Valor a aplicar (R$)", { exact: true }).fill("150");
  await dialog.getByLabel("Valor entregue (R$)", { exact: true }).fill("200");
  await dialog.getByLabel("Responsável pela conferência", { exact: true }).fill("Ana");
}

function openingAction(dialog: Locator) {
  return dialog.getByRole("button", { name: "Abrir caixa nesta conta", exact: true });
}

async function beginOpening(dialog: Locator) {
  // Falha rápida e explícita na ação ausente na fase anterior ao código.
  await expect(openingAction(dialog)).toBeVisible({ timeout: 2000 });
  await openingAction(dialog).click();
  await expect(dialog).toBeVisible();
  const operator = dialog.getByLabel("Operador do caixa", { exact: true });
  await expect(operator).toHaveValue("Ana");
  await expect(operator).toBeFocused();
  return operator;
}

async function expectDraft(dialog: Locator, account = "cash-demo") {
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveJSProperty("open", true);
  await expect(dialog).toContainText("Venda #400");
  await expect(dialog).toContainText("Entrada");
  await expect(dialog.getByLabel("Valor a aplicar (R$)", { exact: true })).toHaveValue("150");
  await expect(dialog.getByLabel("Valor entregue (R$)", { exact: true })).toHaveValue("200");
  await expect(dialog.getByLabel("Responsável pela conferência", { exact: true })).toHaveValue("Ana");
  await expect(dialog.getByLabel("Forma de pagamento", { exact: true })).toHaveValue("cash");
  await expect(dialog.getByLabel("Conta de destino", { exact: true })).toHaveValue(account);
}

async function confirmOpening(page: Page, dialog: Locator, operator = "Ana") {
  await dialog.getByLabel("Operador do caixa", { exact: true }).fill(operator);
  await dialog.getByRole("button", { name: "Confirmar abertura", exact: true }).click();
  await expect(dialog.getByLabel("Operador do caixa", { exact: true })).toHaveCount(0);
  await expect.poll(async () => (await saved(page)).finance.shifts.length).toBe(1);
}

test("ABR-01 abertura preserva rascunho e só cria turno, inclusive após recarga", async ({ page }) => {
  const initial = fixture();
  const dialog = await start(page, initial);
  // A hidratação normaliza documentos de exemplo antes desta jornada.
  // Medir a abertura contra o estado já hidratado mantém a comparação integral.
  const before = await saved(page);
  await fillCash(dialog);
  await beginOpening(dialog);
  await confirmOpening(page, dialog, "Beatriz");
  await expectDraft(dialog);
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  const state = await saved(page);
  expectNoPayment(state);
  expect(state.finance.shifts).toHaveLength(1);
  expect(state.finance.shifts[0]).toMatchObject({ accountId: "cash-demo", operator: "Beatriz", openedOn: day, status: "open" });
  expect(state.finance.accounts).toEqual(before.finance.accounts);
  expect(state.finance.agreements).toEqual(before.finance.agreements);
  expect(state.finance.installments).toEqual(before.finance.installments);
  for (const key of ["orders", "sales", "products", "documents"] as const) expect(state[key]).toEqual(before[key]);
  await expect(page.getByRole("heading", { name: "Recibo demonstrativo", exact: true })).toHaveCount(0);
  await page.reload();
  expect((await saved(page)).finance.shifts).toEqual(state.finance.shifts);
  expectNoPayment(await saved(page));
});

test("ABR-02 recebimento separado gera uma baixa de 150, troco 50, saldo 150 e recibo durável", async ({ page }) => {
  const dialog = await start(page);
  await fillCash(dialog);
  await beginOpening(dialog);
  await confirmOpening(page, dialog);
  expectNoPayment(await saved(page));
  await dialog.getByRole("button", { name: "Confirmar recebimento", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Recibo demonstrativo", exact: true })).toBeVisible();
  await expect(dialog).toContainText("R$ 50,00");
  await expect.poll(async () => (await saved(page)).finance.payments.length).toBe(1);
  const state = await saved(page);
  const payment = state.finance.payments[0];
  expect(payment).toMatchObject({ amount: 15000, tendered: 20000, change: 5000, method: "cash", confirmedBy: "Ana", receipt: { amount: 15000, change: 5000, remaining: 15000 } });
  expect(state.finance.allocations).toHaveLength(1);
  expect(state.finance.movements).toHaveLength(1);
  expect(state.finance.allocations[0]).toMatchObject({ amount: 15000, paymentId: payment.id, installmentId: "abr-agreement:item:0" });
  expect(state.finance.movements[0]).toMatchObject({ amount: 15000, paymentId: payment.id, shiftId: payment.shiftId });
  expect(installmentBalance(state, "abr-agreement:item:0")).toBe(15000);
  // A mesma tentativa tem chave estável: replay no contrato público, sem criar
  // um segundo envio por outra janela nem afirmar idempotência de servidor.
  const input: PaymentInput = { installmentId: "abr-agreement:item:0", amount: 15000, tendered: 20000, method: "cash", accountId: "cash-demo", shiftId: payment.shiftId, confirmedBy: "Ana", creditConfirmed: false, idempotencyKey: payment.idempotencyKey };
  expect(recordPayment(state, input, "abr-replay", at)).toEqual(state);
  await page.keyboard.press("Escape");
  await page.reload();
  expect((await saved(page)).finance).toEqual(state.finance);
  await page.getByRole("tab", { name: "Recebimentos", exact: true }).click();
  await expect(page.getByText(payment.receipt.code, { exact: true })).toBeVisible();
});

for (const mode of ["botão", "Escape"] as const) {
  test(`ABR-03 cancelar abertura por ${mode} mantém diálogo aberto, dados e foco`, async ({ page }) => {
    const dialog = await start(page);
    await fillCash(dialog);
    await beginOpening(dialog);
    if (mode === "botão") await dialog.getByRole("button", { name: "Cancelar abertura", exact: true }).click();
    else await page.keyboard.press("Escape");
    await expectDraft(dialog);
    await expect(openingAction(dialog)).toBeFocused();
    const state = await saved(page);
    expect(state.finance.shifts).toEqual([]);
    expectNoPayment(state);
  });
}

test("ABR-03 cancelar recebimento após abrir não desfaz turno nem recebe parcela", async ({ page }) => {
  const dialog = await start(page);
  await fillCash(dialog);
  await beginOpening(dialog);
  await confirmOpening(page, dialog);
  const shifts = (await saved(page)).finance.shifts;
  await dialog.getByRole("button", { name: "Voltar", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expectNoPayment(await saved(page));
  await page.reload();
  expect((await saved(page)).finance.shifts).toEqual(shifts);
  expectNoPayment(await saved(page));
});

for (const operator of ["", "   "]) {
  test(`ABR-04 operador ${operator ? "espaços" : "vazio"} bloqueia e permite corrigir sem perda`, async ({ page }) => {
    const dialog = await start(page);
    await fillCash(dialog);
    const field = await beginOpening(dialog);
    await field.fill(operator);
    const confirm = dialog.getByRole("button", { name: "Confirmar abertura", exact: true });
    if (await confirm.isEnabled()) await confirm.click();
    await expect(field).toBeVisible();
    expect((await saved(page)).finance.shifts).toEqual([]);
    expectNoPayment(await saved(page));
    await confirmOpening(page, dialog, "Carla");
    await expectDraft(dialog);
    expect((await saved(page)).finance.shifts[0].operator).toBe("Carla");
    expectNoPayment(await saved(page));
  });
}

test("ABR-04 conta vazia/inativa é bloqueada e correção conserva o rascunho", async ({ page }) => {
  const initial = fixture();
  initial.finance.accounts.find((account) => account.id === "cash-demo")!.active = false;
  initial.finance.accounts.push({ ...initial.finance.accounts[0], id: "cash-active", name: "Caixa alternativo QA", active: true });
  const dialog = await start(page, initial);
  await fillCash(dialog);
  const account = dialog.getByLabel("Conta de destino", { exact: true });
  await expect(account.locator('option[value="cash-demo"]')).toHaveCount(0);
  await account.selectOption("");
  const action = openingAction(dialog);
  if (await action.isVisible()) await expect(action).toBeDisabled();
  const pay = dialog.getByRole("button", { name: "Confirmar recebimento", exact: true });
  if (await pay.isEnabled()) await pay.click();
  expect((await saved(page)).finance.shifts).toEqual([]);
  expectNoPayment(await saved(page));
  await account.selectOption("cash-active");
  await beginOpening(dialog);
  await confirmOpening(page, dialog);
  await expectDraft(dialog, "cash-active");
  expect((await saved(page)).finance.shifts[0].accountId).toBe("cash-active");
});

test("ABR-04 domínio rejeita conta inválida/inativa/bancária sem gravação parcial", () => {
  const state = fixture();
  state.finance.accounts.push({ ...state.finance.accounts[0], id: "cash-inactive", active: false });
  const before = structuredClone(state);
  for (const accountId of ["", "inexistente", "cash-inactive", "bank-demo"]) {
    expect(() => openCashShift(state, { accountId, operator: "Ana" }, "abr-invalid", at)).toThrow(/conta ativa de caixa físico/i);
    expect(state).toEqual(before);
  }
});

test("ABR-05 turno válido existente permite receber sem oferecer outra abertura", async ({ page }) => {
  const initial = openCashShift(fixture(), { accountId: "cash-demo", operator: "Operador existente" }, "abr-existing", at);
  const dialog = await start(page, initial);
  await fillCash(dialog);
  await expect(openingAction(dialog)).toHaveCount(0);
  await expect(dialog).toContainText("Operador existente");
  await dialog.getByRole("button", { name: "Confirmar recebimento", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Recibo demonstrativo", exact: true })).toBeVisible();
  const state = await saved(page);
  expect(state.finance.shifts).toEqual(initial.finance.shifts);
  expect(state.finance.payments).toHaveLength(1);
  expect(state.finance.payments[0].shiftId).toBe("abr-existing");
});

test("ABR-05 confirmação concorrente no estado local atualizado não duplica turno", () => {
  const initial = fixture();
  const updated = openCashShift(initial, { accountId: "cash-demo", operator: "Outro operador" }, "abr-first", at);
  const before = structuredClone(updated);
  expect(() => openCashShift(updated, { accountId: "cash-demo", operator: "Ana" }, "abr-second", at)).toThrow(/já possui um turno aberto/i);
  expect(updated).toEqual(before);
  expect(updated.finance.shifts).toHaveLength(1);
  expectNoPayment(updated);
});

test("ABR-06 teclado em 390x844: Enter abre somente caixa, foco e ações continuam no diálogo", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = await start(page);
  await fillCash(dialog);
  await expect(openingAction(dialog)).toBeVisible({ timeout: 2000 });
  // Encontrar a ação com Tab, sem clique ou foco programático.
  for (let index = 0; index < 15; index++) {
    if (await openingAction(dialog).evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await expect(openingAction(dialog)).toBeFocused();
  await page.keyboard.press("Enter");
  const operator = dialog.getByLabel("Operador do caixa", { exact: true });
  await expect(operator).toBeFocused();
  await expect(operator).toHaveValue("Ana");
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const label of ["Confirmar abertura", "Cancelar abertura"]) {
    const action = dialog.getByRole("button", { name: label, exact: true });
    await action.scrollIntoViewIfNeeded();
    const rect = await action.boundingBox();
    expect(rect).not.toBeNull();
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(390);
  }
  await operator.press("Enter");
  await expect.poll(async () => (await saved(page)).finance.shifts.length).toBe(1);
  await expectDraft(dialog);
  expectNoPayment(await saved(page));
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Tab");
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  expect(errors).toEqual([]);
});

for (const method of ["pix", "transfer"] as const) {
  test(`ABR-06 ${method} mantém referência/conferência e não oferece abertura`, async ({ page }) => {
    const dialog = await start(page);
    await dialog.getByLabel("Forma de pagamento", { exact: true }).selectOption(method);
    await dialog.getByLabel("Valor a aplicar (R$)", { exact: true }).fill("150");
    await dialog.getByLabel("Responsável pela conferência", { exact: true }).fill("Ana");
    await dialog.getByLabel("Referência do crédito", { exact: true }).fill("CREDITO-FICTICIO-ABR");
    await expect(openingAction(dialog)).toHaveCount(0);
    await expect(dialog.getByLabel("Operador do caixa", { exact: true })).toHaveCount(0);
    const confirm = dialog.getByRole("button", { name: "Confirmar recebimento", exact: true });
    if (await confirm.isEnabled()) await confirm.click();
    expectNoPayment(await saved(page));
    await expect(dialog.getByLabel("Referência do crédito", { exact: true })).toHaveValue("CREDITO-FICTICIO-ABR");
    await dialog.getByLabel("Conferi o crédito na conta de destino", { exact: true }).check();
    await confirm.click();
    await expect(dialog.getByRole("heading", { name: "Recibo demonstrativo", exact: true })).toBeVisible();
    const state = await saved(page);
    expect(state.finance.payments).toHaveLength(1);
    expect(state.finance.payments[0]).toMatchObject({ method, amount: 15000, confirmedBy: "Ana", reference: "CREDITO-FICTICIO-ABR" });
    expect(state.finance.shifts).toEqual([]);
  });
}

test("ABR-07 turno anterior orienta Caixa e contas sem abrir, fechar ou receber automaticamente", async ({ page }) => {
  const previous = openCashShift(fixture(), { accountId: "cash-demo", operator: "Turno anterior" }, "abr-yesterday", "2026-10-17T12:00:00.000Z");
  const dialog = await start(page, previous);
  await fillCash(dialog);
  await expect(dialog).toContainText(/Caixa e contas/);
  await expect(dialog).toContainText(/anterior|outro dia|outro.*dia/i);
  await expect(openingAction(dialog)).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Confirmar recebimento", exact: true })).toBeDisabled();
  await expectDraft(dialog);
  expect((await saved(page)).finance.shifts).toEqual(previous.finance.shifts);
  expectNoPayment(await saved(page));
});
