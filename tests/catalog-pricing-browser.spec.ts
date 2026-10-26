import { expect, test } from "@playwright/test";
import { contextualSaved, openAuxiliary, openSale, startContextual } from "./contextual-helpers";
import { allowPricingStorage, denyPricingStorage, openPricing, pricingFixture } from "./catalog-pricing-helpers";

const mouse = "Mouse Logitech M170 sem fio";
const source = "Fonte universal para notebook · 65 W";

test("LPR-B01 abre todos os pendentes sem percentual presumido e ignora filtro da lista", async ({ page }) => {
  await startContextual(page, "/produtos/?q=MOU-LOG", pricingFixture());
  const before = await contextualSaved(page);
  const dialog = await openPricing(page);
  const markup = dialog.getByLabel("Acréscimo sobre a compra (%)", { exact: true });
  await expect(markup).toHaveValue("");
  await expect(dialog.getByLabel(`Selecionar ${mouse}`, { exact: true })).toBeChecked();
  await expect(dialog.getByLabel(`Selecionar ${source}`, { exact: true })).toBeChecked();
  await expect(dialog.getByLabel("Selecionar SSD Kingston A400 · 480 GB", { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Salvar preços", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  expect(await contextualSaved(page)).toEqual(before);
});

test("LPR-B02 percentual preenche lote, distingue lucro/margem e salva sem efeitos operacionais", async ({ page }) => {
  await startContextual(page, "/produtos/", pricingFixture());
  const before = await contextualSaved(page);
  const dialog = await openPricing(page);
  await dialog.getByLabel("Acréscimo sobre a compra (%)", { exact: true }).fill("50");
  await expect(dialog.getByLabel(`Novo preço de ${mouse}`, { exact: true })).toHaveValue("30");
  await expect(dialog.getByLabel(`Novo preço de ${source}`, { exact: true })).toHaveValue("29.99");
  await expect(dialog.getByRole("row").filter({ hasText: mouse })).toContainText(/Margem de 33,33\s*%/);
  await expect(dialog.getByRole("row").filter({ hasText: mouse })).toContainText(/R\$\s*10,00/);
  await dialog.getByRole("button", { name: "Salvar preços", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const expected = { ...before, products: before.products.map((product) => product.id === "p3" ? { ...product, price: 3000, pricePending: false } : product.id === "p4" ? { ...product, price: 2999, pricePending: false } : product) };
  expect(await contextualSaved(page)).toEqual(expected);
  await page.reload();
  expect(await contextualSaved(page)).toEqual(expected);
});

test("LPR-B03 exceção manual sobrevive novo percentual e zero compra não gera gratuidade", async ({ page }) => {
  await startContextual(page, "/produtos/", pricingFixture(true));
  const before = await contextualSaved(page);
  const dialog = await openPricing(page);
  const markup = dialog.getByLabel("Acréscimo sobre a compra (%)", { exact: true });
  await markup.fill("50");
  const zero = dialog.getByLabel("Novo preço de Cabo HDMI 2.0 · 2 metros", { exact: true });
  await expect(zero).toHaveValue("");
  await expect(dialog.getByRole("button", { name: "Salvar preços", exact: true })).toBeDisabled();
  await dialog.getByLabel(`Novo preço de ${mouse}`, { exact: true }).fill("35.45");
  await markup.fill("100");
  await expect(dialog.getByLabel(`Novo preço de ${mouse}`, { exact: true })).toHaveValue("35.45");
  await expect(dialog.getByLabel(`Novo preço de ${source}`, { exact: true })).toHaveValue("39.98");
  await zero.fill("0");
  await dialog.getByRole("button", { name: "Salvar preços", exact: true }).click();
  const saved = await contextualSaved(page);
  expect(saved.products.find((product) => product.id === "p6")).toMatchObject({ price: 0, pricePending: false });
  expect(saved.products.find((product) => product.id === "p3")).toMatchObject({ price: 3545, pricePending: false });
  expect(saved.sales).toEqual(before.sales);
  expect(saved.finance).toEqual(before.finance);
});

test("LPR-B04 incluir precificados exige escolha e desmarcar produto preserva seu preço", async ({ page }) => {
  await startContextual(page, "/produtos/", pricingFixture());
  const before = await contextualSaved(page);
  const dialog = await openPricing(page);
  await dialog.getByLabel("Incluir produtos já precificados", { exact: true }).check();
  await expect(dialog.getByLabel("Novo preço de SSD Kingston A400 · 480 GB", { exact: true })).toBeVisible();
  await dialog.getByLabel(`Selecionar ${mouse}`, { exact: true }).uncheck();
  await dialog.getByLabel("Acréscimo sobre a compra (%)", { exact: true }).fill("0");
  await dialog.getByRole("button", { name: "Salvar preços", exact: true }).click();
  const saved = await contextualSaved(page);
  expect(saved.products.find((product) => product.id === "p3")).toEqual(before.products.find((product) => product.id === "p3"));
  expect(saved.products.find((product) => product.id === "p1")).toMatchObject({ price: 18990, pricePending: false });
});

test("LPR-B05 falha de gravação preserva lote e memória; tentar novamente grava uma vez", async ({ page }) => {
  await startContextual(page, "/produtos/", pricingFixture());
  const before = await contextualSaved(page);
  const dialog = await openPricing(page);
  await dialog.getByLabel("Acréscimo sobre a compra (%)", { exact: true }).fill("50");
  await denyPricingStorage(page);
  await dialog.getByRole("button", { name: "Salvar preços", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText(/gravar|gravação/i);
  await expect(dialog.getByLabel(`Novo preço de ${mouse}`, { exact: true })).toHaveValue("30");
  expect(await contextualSaved(page)).toEqual(before);
  await allowPricingStorage(page);
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: "MOU-LOG" })).toContainText("Preço pendente");
  const retry = await openPricing(page);
  await retry.getByLabel("Acréscimo sobre a compra (%)", { exact: true }).fill("50");
  await retry.getByRole("button", { name: "Salvar preços", exact: true }).click();
  await expect(retry).toHaveCount(0);
  expect((await contextualSaved(page)).products.find((product) => product.id === "p3")).toMatchObject({ price: 3000, pricePending: false });
});

test("LPR-B06 preço pendente é resolvido na venda preservando rascunho e sem criar operação", async ({ page }) => {
  await startContextual(page, "/vendas/", pricingFixture());
  const parent = await openSale(page);
  const before = await contextualSaved(page);
  await expect(parent.getByRole("button", { name: "Confirmar e reservar", exact: true })).toBeDisabled();
  let child = await openAuxiliary(page, parent, "Definir preço", "Definir preço do produto");
  await expect(child.getByLabel(/^Preço de venda/)).toBeFocused();
  await expect(child.getByLabel(/^Nome do produto/)).toHaveValue(mouse);
  await expect(child.getByLabel(/^Preço de compra/)).toHaveValue("20");
  await child.getByLabel(/^Preço de venda/).fill("35");
  await child.getByRole("button", { name: "Cancelar", exact: true }).click();
  expect(await contextualSaved(page)).toEqual(before);
  await expect(parent.getByLabel(/^Cliente/)).toHaveValue("c3");
  await expect(parent.getByLabel(/^Quantidade/)).toHaveValue("3");
  child = await openAuxiliary(page, parent, "Definir preço", "Definir preço do produto");
  await child.getByLabel(/^Preço de venda/).fill("35");
  await child.getByRole("button", { name: "Salvar produto", exact: true }).click();
  await expect(child).toHaveCount(0);
  await expect(parent.getByLabel(/^Cliente/)).toHaveValue("c3");
  await expect(parent.getByLabel(/^Produto/)).toHaveValue("p3");
  await expect(parent.getByLabel(/^Quantidade/)).toHaveValue("3");
  await expect(parent.getByRole("button", { name: "Confirmar e reservar", exact: true })).toBeEnabled();
  const saved = await contextualSaved(page);
  expect(saved).toEqual({ ...before, products: before.products.map((product) => product.id === "p3" ? { ...product, price: 3500, pricePending: false } : product) });
  await parent.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.reload();
  expect(await contextualSaved(page)).toEqual(saved);
});

test("LPR-B07 erro de gravação individual mantém preço pendente e ambos os rascunhos", async ({ page }) => {
  await startContextual(page, "/vendas/", pricingFixture());
  const parent = await openSale(page);
  const before = await contextualSaved(page);
  const child = await openAuxiliary(page, parent, "Definir preço", "Definir preço do produto");
  await child.getByLabel(/^Preço de venda/).fill("35");
  await denyPricingStorage(page);
  await child.getByRole("button", { name: "Salvar produto", exact: true }).click();
  await expect(child).toBeVisible();
  await expect(child.getByRole("alert")).toContainText(/gravar|gravação/i);
  await expect(child.getByLabel(/^Preço de venda/)).toHaveValue("35");
  expect(await contextualSaved(page)).toEqual(before);
  await allowPricingStorage(page);
  await child.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(parent.getByRole("button", { name: "Confirmar e reservar", exact: true })).toBeDisabled();
  await expect(parent.getByLabel(/^Quantidade/)).toHaveValue("3");
  expect(await contextualSaved(page)).toEqual(before);
});

test("LPR-B08 seleção vazia ou preço inválido não salva e não perde restante da prévia", async ({ page }) => {
  await startContextual(page, "/produtos/", pricingFixture());
  const before = await contextualSaved(page);
  const dialog = await openPricing(page);
  await dialog.getByLabel("Acréscimo sobre a compra (%)", { exact: true }).fill("50");
  const first = dialog.getByLabel(`Novo preço de ${mouse}`, { exact: true });
  await first.fill("-1");
  await expect(dialog.getByRole("button", { name: "Salvar preços", exact: true })).toBeDisabled();
  await first.fill("35.123");
  await expect(dialog.getByRole("button", { name: "Salvar preços", exact: true })).toBeDisabled();
  await first.fill("35");
  await dialog.getByLabel(`Selecionar ${mouse}`, { exact: true }).uncheck();
  await dialog.getByLabel(`Selecionar ${source}`, { exact: true }).uncheck();
  await expect(dialog.getByRole("button", { name: "Salvar preços", exact: true })).toBeDisabled();
  expect(await contextualSaved(page)).toEqual(before);
});
