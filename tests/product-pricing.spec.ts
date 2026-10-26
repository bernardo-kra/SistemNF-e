import { expect, test, type Locator, type Page } from "@playwright/test";
import { contextualFixture, contextualSaved, fillProduct, openAuxiliary, openSale, startContextual } from "./contextual-helpers";

const profit = (dialog: Locator) => dialog.getByLabel("Lucro estimado por unidade", { exact: true });
const purchase = (dialog: Locator) => dialog.getByLabel(/^Preço de compra \(R\$\)/);
const selling = (dialog: Locator) => dialog.getByLabel(/^Preço de venda \(R\$\)/);
const amount = (value: string, negative = false) => new RegExp(`${negative ? "-\\s*" : ""}R\\$\\s*${value.replace(".", "\\.")}`);

async function editMouse(page: Page) {
  await page.getByRole("button", { name: "Editar Mouse Logitech M170 sem fio", exact: true }).click();
  return page.getByRole("dialog", { name: "Editar produto", exact: true });
}

test("PRECO-01 lista expõe compra, venda e lucro por unidade sem abrir cadastro", async ({ page }) => {
  const state = contextualFixture();
  Object.assign(state.products.find((product) => product.id === "p3")!, { cost: 2000, price: 3500 });
  Object.assign(state.products.find((product) => product.id === "p4")!, { cost: 4000, price: 2500 });
  Object.assign(state.products.find((product) => product.id === "p6")!, { pricePending: true, price: 0 });
  await startContextual(page, "/produtos/", state);
  const before = await contextualSaved(page);
  for (const name of ["PREÇO DE COMPRA", "PREÇO DE VENDA", "LUCRO ESTIMADO"]) {
    await expect(page.getByRole("columnheader", { name, exact: true })).toBeVisible({ timeout: 2000 });
  }
  const mouse = page.getByRole("row").filter({ hasText: "MOU-LOG" });
  for (const value of ["20,00", "35,00", "15,00"]) await expect(mouse).toContainText(amount(value));
  await expect(page.getByRole("row").filter({ hasText: "FON-65" })).toContainText(amount("15,00", true));
  const pending = page.getByRole("row").filter({ hasText: "CAB-HDMI" });
  await expect(pending).toContainText("Preço pendente");
  await expect(pending).toContainText("A calcular");
  await expect(pending).not.toContainText(amount("0,00"));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await contextualSaved(page)).toEqual(before);
});

test("PRECO-02 cálculo imediato preserva centavos, zero, prejuízo e margem sem salvar ou navegar", async ({ page }, info) => {
  await startContextual(page, "/produtos/");
  const dialog = await editMouse(page);
  const before = await contextualSaved(page);
  const route = page.url();
  await expect(purchase(dialog)).toBeVisible({ timeout: 2000 });
  await expect(profit(dialog)).toBeVisible({ timeout: 2000 });
  const navigation: string[] = [];
  const requests: string[] = [];
  page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigation.push(frame.url()); });
  page.on("request", (request) => { if (["xhr", "fetch"].includes(request.resourceType()) && !request.url().includes("__next")) requests.push(request.url()); });
  const started = Date.now();
  for (const scenario of [
    { buy: "20", sell: "35", value: "15,00", margin: /Margem de 42,86\s*%/i, negative: false },
    { buy: "0", sell: "35", value: "35,00", margin: /Margem de 100(?:,00)?\s*%/i, negative: false },
    { buy: "40", sell: "25", value: "15,00", margin: /Margem de -60(?:,00)?\s*%/i, negative: true },
    { buy: "22.13", sell: "35.50", value: "13,37", margin: /Margem de 37,66\s*%/i, negative: false },
    { buy: "20", sell: "0", value: "20,00", margin: /Margem indisponível/i, negative: true },
  ]) {
    await purchase(dialog).fill(scenario.buy);
    await selling(dialog).fill(scenario.sell);
    await expect(profit(dialog)).toContainText(amount(scenario.value, scenario.negative));
    await expect(dialog).toContainText(scenario.margin);
    await expect(dialog).not.toContainText(/NaN|Infinity/);
  }
  expect(await profit(dialog).evaluate((element) => !(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) || element.readOnly)).toBe(true);
  await expect(dialog).toContainText(/impostos.*taxas.*despesas/i);
  expect(page.url()).toBe(route);
  expect(navigation).toEqual([]);
  expect(requests).toEqual([]);
  expect(await contextualSaved(page)).toEqual(before);
  await info.attach("preco-calculo-local", { body: JSON.stringify({ environment: "Chrome local, Playwright, dados fictícios", editAndCheckFiveCasesMs: Date.now() - started, documentNavigations: navigation.length, applicationFetches: requests.length, typedPriceFields: 10, typedProfitFields: 0, explicitCalculateActions: 0 }), contentType: "application/json" });
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  expect(await contextualSaved(page)).toEqual(before);
});

test("PRECO-03 compra vazia é desconhecida e impede salvar; zero explícito continua válido", async ({ page }) => {
  await startContextual(page, "/produtos/");
  const dialog = await editMouse(page);
  const before = await contextualSaved(page);
  await expect(purchase(dialog)).toBeVisible({ timeout: 2000 });
  await purchase(dialog).fill("");
  await selling(dialog).fill("35");
  await expect(profit(dialog)).toContainText("A calcular");
  await dialog.getByRole("button", { name: "Salvar produto", exact: true }).click();
  await expect(dialog).toBeVisible();
  expect(await contextualSaved(page)).toEqual(before);
  await purchase(dialog).fill("0");
  await expect(profit(dialog)).toContainText(amount("35,00"));
  await expect(dialog).toContainText(/Margem de 100(?:,00)?\s*%/i);
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  expect(await contextualSaved(page)).toEqual(before);
});

test("PRECO-04 preço de venda pendente fica em branco e não fabrica lucro ou margem", async ({ page }) => {
  const state = contextualFixture();
  Object.assign(state.products.find((product) => product.id === "p3")!, { cost: 2000, price: 0, pricePending: true });
  await startContextual(page, "/produtos/", state);
  const dialog = await editMouse(page);
  const before = await contextualSaved(page);
  await expect(profit(dialog)).toBeVisible({ timeout: 2000 });
  await expect(selling(dialog)).toHaveValue("");
  await expect(profit(dialog)).toContainText("A calcular");
  await expect(profit(dialog)).not.toContainText(amount("20,00", true));
  await dialog.getByRole("button", { name: "Salvar produto", exact: true }).click();
  expect(await contextualSaved(page)).toEqual(before);
  await selling(dialog).fill("35");
  await expect(profit(dialog)).toContainText(amount("15,00"));
  await expect(dialog).toContainText(/Margem de 42,86\s*%/i);
  await selling(dialog).fill("");
  await expect(profit(dialog)).toContainText("A calcular");
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  expect(await contextualSaved(page)).toEqual(before);
});

test("PRECO-05 salvar altera somente preços do produto e preserva estoque e histórico após recarga", async ({ page }) => {
  await startContextual(page, "/produtos/");
  const dialog = await editMouse(page);
  const before = await contextualSaved(page);
  await expect(purchase(dialog)).toBeVisible({ timeout: 2000 });
  await purchase(dialog).fill("20.10");
  await selling(dialog).fill("35.67");
  await expect(profit(dialog)).toContainText(amount("15,57"));
  await dialog.getByRole("button", { name: "Salvar produto", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const expected = { ...before, products: before.products.map((product) => product.id === "p3" ? { ...product, cost: 2010, price: 3567, pricePending: false } : product) };
  expect(await contextualSaved(page)).toEqual(expected);
  await page.reload();
  const row = page.getByRole("row").filter({ hasText: "MOU-LOG" });
  for (const value of ["20,10", "35,67", "15,57"]) await expect(row).toContainText(amount(value));
  expect(await contextualSaved(page)).toEqual(expected);
});

test("PRECO-06 editor contextual calcula sem perder a venda principal ao cancelar", async ({ page }) => {
  await startContextual(page, "/vendas/");
  const parent = await openSale(page);
  const before = await contextualSaved(page);
  const child = await openAuxiliary(page, parent, "Cadastrar produto", "Novo produto");
  await expect(purchase(child)).toBeVisible({ timeout: 2000 });
  await fillProduct(child, "QA-PRECO-CONTEXTO");
  await expect(profit(child)).toContainText(amount("35,00"));
  await child.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(parent.getByLabel(/^Cliente/)).toHaveValue("c3");
  await expect(parent.getByLabel(/^Produto/)).toHaveValue("p3");
  await expect(parent.getByLabel(/^Quantidade/)).toHaveValue("3");
  expect(await contextualSaved(page)).toEqual(before);
});
