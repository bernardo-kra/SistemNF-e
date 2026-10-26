import { expect, type Locator, type Page } from "@playwright/test";
import type { DemoState } from "../src/lib/domain";
import { restoreDemoState } from "../src/lib/demo-persistence";
import { seed } from "../src/lib/seed";

export const contextualKey = "sistem:prototype:v1";
export type ContextualState = DemoState & { technicians?: { id: string; name: string }[] };

export function contextualFixture(): ContextualState {
  const state = structuredClone(seed) as ContextualState;
  delete state.technicians;
  return state;
}

export async function startContextual(page: Page, route = "/ordens/", input: unknown = contextualFixture(), normalize = true) {
  // A baseline dos comandos começa após a restauração normal preexistente.
  // O ensaio de recuperação inválida usa explicitamente os bytes originais.
  const initial = normalize ? JSON.stringify(restoreDemoState(input)) : JSON.stringify(input);
  await page.addInitScript(({ key, raw }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, raw);
  }, { key: contextualKey, raw: initial });
  await page.goto(route);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  return initial;
}

export async function contextualSaved(page: Page): Promise<ContextualState> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), contextualKey);
}

export async function openOrder(page: Page) {
  await page.getByRole("button", { name: "Nova ordem de serviço", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Nova ordem de serviço", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function fillOrderDraft(dialog: Locator) {
  await dialog.getByLabel(/^Cliente/).selectOption("c2");
  await dialog.getByRole("combobox", { name: /^Técnico responsável/ }).selectOption({ label: "Pedro Lima" });
  await dialog.getByLabel(/^Equipamento \/ marca e modelo/).fill("Notebook do atendimento contextual");
  await dialog.getByLabel("Número de série / etiqueta", { exact: true }).fill("CAD-SERIE-789");
  await dialog.getByLabel(/^Previsão de conclusão/).fill("2026-11-20");
  await dialog.getByLabel("Acessórios recebidos", { exact: true }).fill("Bolsa, fonte e adaptador");
  await dialog.getByRole("textbox", { name: /^Problema relatado pelo cliente/ }).fill("Desliga quando inicia o sistema.");
  await dialog.getByRole("textbox", { name: "Diagnóstico técnico", exact: true }).fill("Conferir fonte e alimentação.");
  await dialog.getByLabel("Peças / materiais (R$)", { exact: true }).fill("120.45");
  await dialog.getByLabel("Serviços (R$)", { exact: true }).fill("80.10");
}

export async function expectOrderDraft(dialog: Locator, customerId = "c2", technician = "Pedro Lima") {
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel(/^Cliente/)).toHaveValue(customerId);
  await expect(dialog.getByRole("combobox", { name: /^Técnico responsável/ })).toHaveValue(technician);
  await expect(dialog.getByLabel(/^Equipamento \/ marca e modelo/)).toHaveValue("Notebook do atendimento contextual");
  await expect(dialog.getByLabel("Número de série / etiqueta", { exact: true })).toHaveValue("CAD-SERIE-789");
  await expect(dialog.getByLabel(/^Previsão de conclusão/)).toHaveValue("2026-11-20");
  await expect(dialog.getByLabel("Acessórios recebidos", { exact: true })).toHaveValue("Bolsa, fonte e adaptador");
  await expect(dialog.getByRole("textbox", { name: /^Problema relatado pelo cliente/ })).toHaveValue("Desliga quando inicia o sistema.");
  await expect(dialog.getByRole("textbox", { name: "Diagnóstico técnico", exact: true })).toHaveValue("Conferir fonte e alimentação.");
  await expect(dialog.getByLabel("Peças / materiais (R$)", { exact: true })).toHaveValue("120.45");
  await expect(dialog.getByLabel("Serviços (R$)", { exact: true })).toHaveValue("80.10");
}

export async function openAuxiliary(page: Page, parent: Locator, action: string, title: string) {
  const trigger = parent.getByRole("button", { name: action, exact: true });
  // Falha rápida no RED por funcionalidade ausente, sem esperar o timeout global.
  await expect(trigger).toBeVisible({ timeout: 2000 });
  await trigger.click();
  const child = page.getByRole("dialog", { name: title, exact: true });
  await expect(child).toBeVisible();
  return child;
}

export async function fillCustomer(dialog: Locator, name = "Cliente contextual de teste") {
  await dialog.getByLabel(/^Nome \/ razão social/).fill(name);
  await dialog.getByLabel("Telefone", { exact: true }).fill("(11) 99900-0111");
  await dialog.getByLabel("E-mail", { exact: true }).fill("contextual@example.com");
}

export async function openSale(page: Page) {
  await page.getByRole("button", { name: "Nova venda", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Nova venda", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/^Cliente/).selectOption("c3");
  await dialog.getByLabel(/^Produto/).selectOption("p3");
  await dialog.getByLabel(/^Quantidade/).fill("3");
  return dialog;
}

export async function fillProduct(dialog: Locator, sku = "CAD-NOVO", category = "Redes especiais") {
  await dialog.getByLabel(/^Nome do produto/).fill("Adaptador contextual");
  await dialog.getByLabel(/^SKU \/ código interno/).fill(sku);
  await dialog.getByLabel(/^Categoria/).fill(category);
  await dialog.getByLabel(/^Preço de venda/).fill("79.90");
  // PRECO: rótulo alterado por requisito explícito; valores e efeitos continuam os mesmos.
  await dialog.getByLabel(/^Preço de compra/).fill("44.90");
}

export function expectNoOperationalEffects(after: ContextualState, before: ContextualState) {
  expect(after.orders).toEqual(before.orders);
  expect(after.sales).toEqual(before.sales);
  expect(after.finance).toEqual(before.finance);
  expect(after.documents).toEqual(before.documents);
  expect(after.imports).toEqual(before.imports);
}
