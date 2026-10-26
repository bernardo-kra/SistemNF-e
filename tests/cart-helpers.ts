import { expect, type Locator, type Page } from "@playwright/test";
import type { Sale } from "../src/lib/domain";
import { fiscalFixture } from "./fiscal-fixtures";

export function cartFixture() {
  const state = fiscalFixture();
  Object.assign(state.products.find((p) => p.id === "p3")!, { price: 1099, stock: 10, reserved: 2 });
  Object.assign(state.products.find((p) => p.id === "p4")!, { price: 2037, stock: 5, reserved: 1 });
  Object.assign(state.products.find((p) => p.id === "p6")!, { price: 699, stock: 9, reserved: 0 });
  return state;
}

export function cartSale(): Sale {
  return { id: "qa-cart-sale", number: 0, customerId: "c3", date: "2026-10-24", status: "confirmed",
    items: [{ productId: "p3", quantity: 2, unitPrice: 1099 }, { productId: "p4", quantity: 1, unitPrice: 2037 }], total: 4235 };
}

export async function openCart(page: Page) {
  await page.getByRole("button", { name: "Nova venda", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Nova venda", exact: true });
  await expect(dialog.getByRole("group", { name: "Item 1", exact: true })).toBeVisible({ timeout: 2000 });
  await expect(dialog.getByLabel(/^Cliente/)).toBeFocused();
  return dialog;
}

export const cartItem = (dialog: Locator, index: number) => dialog.getByRole("group", { name: `Item ${index}`, exact: true });

export async function fillCart(dialog: Locator, third = false) {
  await dialog.getByLabel(/^Cliente/).selectOption("c3");
  const first = cartItem(dialog, 1);
  await first.getByLabel(/^Produto/).selectOption("p3");
  await first.getByLabel(/^Quantidade/).fill("2");
  await dialog.getByRole("button", { name: "Adicionar produto", exact: true }).click();
  const second = cartItem(dialog, 2);
  await expect(second.getByLabel(/^Produto/)).toBeFocused();
  await expect(second.getByLabel(/^Produto/)).toHaveValue("");
  await expect(second.getByLabel(/^Quantidade/)).toHaveValue("1");
  await second.getByLabel(/^Produto/).selectOption("p4");
  if (third) {
    await dialog.getByRole("button", { name: "Adicionar produto", exact: true }).click();
    const last = cartItem(dialog, 3);
    await expect(last.getByLabel(/^Produto/)).toBeFocused();
    await last.getByLabel(/^Produto/).selectOption("p6");
    await last.getByLabel(/^Quantidade/).fill("3");
  }
}
