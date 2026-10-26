import { expect, type Page } from "@playwright/test";
import { contextualFixture, contextualKey, type ContextualState } from "./contextual-helpers";

export function pricingFixture(zeroCost = false): ContextualState {
  const state = contextualFixture();
  Object.assign(state.products.find((product) => product.id === "p3")!, { cost: 2000, price: 0, pricePending: true });
  Object.assign(state.products.find((product) => product.id === "p4")!, { cost: 1999, price: 0, pricePending: true });
  if (zeroCost) Object.assign(state.products.find((product) => product.id === "p6")!, { cost: 0, price: 0, pricePending: true });
  return state;
}

export async function openPricing(page: Page) {
  const button = page.getByRole("button", { name: "Definir preços em lote", exact: true });
  await expect(button).toBeVisible({ timeout: 2000 });
  await button.click();
  const dialog = page.getByRole("dialog", { name: "Definir preços em lote", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function denyPricingStorage(page: Page) {
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    (window as unknown as { restorePricingStorage: () => void }).restorePricingStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function (item, value) {
      if (item === key) throw new DOMException("QA fictício: gravação recusada", "QuotaExceededError");
      return original.call(this, item, value);
    };
  }, contextualKey);
}

export async function allowPricingStorage(page: Page) {
  await page.evaluate(() => (window as unknown as { restorePricingStorage: () => void }).restorePricingStorage());
}
