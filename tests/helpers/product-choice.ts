import type { Locator } from "@playwright/test";

// The field displays a name; domain assertions still check the product ID in commands.
export async function selectSaleProduct(dialog: Locator, name: string, index = 1) {
  await dialog.getByRole("combobox", { name: `Produto ${index}`, exact: true }).fill(name);
  await dialog.getByRole("listbox", { name: `Resultados de produtos ${index}`, exact: true }).getByRole("option").filter({ has: dialog.page().getByText(name, { exact: true }) }).click();
}
