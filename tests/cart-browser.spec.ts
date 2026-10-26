import { expect, test } from "@playwright/test";
import { contextualSaved, fillCustomer, fillProduct, openAuxiliary, startContextual } from "./contextual-helpers";
import { allowPricingStorage, denyPricingStorage } from "./catalog-pricing-helpers";
import { cartFixture, cartItem, fillCart, openCart } from "./cart-helpers";

test("CAR-B01 três linhas recalculam/mesclam produto repetido sem gravar e cancelar preserva tudo", async ({ page }) => {
  await startContextual(page, "/vendas/", cartFixture()); const before = await contextualSaved(page), dialog = await openCart(page);
  await fillCart(dialog, true); await expect(dialog).toContainText(/R\$\s*63,32/);
  await cartItem(dialog, 3).getByLabel(/^Produto/).selectOption("p3");
  await expect(dialog.getByRole("group")).toHaveCount(2);
  await expect(cartItem(dialog, 1).getByLabel(/^Quantidade/)).toHaveValue("5");
  await expect(cartItem(dialog, 2).getByLabel(/^Produto/)).toHaveValue("p4");
  await expect(dialog).toContainText(/R\$\s*75,32/);
  await dialog.getByRole("button", { name: "Remover item 1", exact: true }).click();
  await expect(cartItem(dialog, 1).getByLabel(/^Produto/)).toHaveValue("p4");
  await expect(dialog).toContainText(/R\$\s*20,37/);
  expect(await contextualSaved(page)).toEqual(before);
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click(); expect(await contextualSaved(page)).toEqual(before);
});

test("CAR-B02 uma confirmação reserva três produtos; entrega/reload baixa uma vez", async ({ page }) => {
  await startContextual(page, "/vendas/", cartFixture()); const before = await contextualSaved(page), dialog = await openCart(page);
  await fillCart(dialog, true); await dialog.getByRole("button", { name: "Confirmar e reservar", exact: true }).click(); await expect(dialog).toHaveCount(0);
  const confirmed = await contextualSaved(page), sale = confirmed.sales.find((s) => !before.sales.some((old) => old.id === s.id))!;
  expect(sale).toMatchObject({ customerId: "c3", total: 6332, status: "confirmed", items: [{ productId: "p3", quantity: 2, unitPrice: 1099 }, { productId: "p4", quantity: 1, unitPrice: 2037 }, { productId: "p6", quantity: 3, unitPrice: 699 }] });
  for (const [id, stock, reserved] of [["p3", 10, 4], ["p4", 5, 2], ["p6", 9, 3]]) expect(confirmed.products.find((p) => p.id === id)).toMatchObject({ stock, reserved });
  expect(confirmed.finance).toEqual(before.finance); expect(confirmed.documents).toEqual(before.documents);
  await page.reload(); const row = page.getByRole("row").filter({ hasText: String(sale.number) }); await expect(row).toContainText(/R\$\s*63,32/);
  await row.getByRole("button", { name: "Entregar", exact: true }).click(); const delivered = await contextualSaved(page);
  for (const [id, stock, reserved] of [["p3", 8, 2], ["p4", 4, 1], ["p6", 6, 0]]) expect(delivered.products.find((p) => p.id === id)).toMatchObject({ stock, reserved });
  await page.reload(); expect(await contextualSaved(page)).toEqual(delivered); await expect(row).toContainText("Entregue");
});

test("CAR-B03 uma linha sem saldo ou quantidade inteira positiva bloqueia todo o carrinho", async ({ page }) => {
  await startContextual(page, "/vendas/", cartFixture()); const before = await contextualSaved(page), dialog = await openCart(page);
  await fillCart(dialog); const second = cartItem(dialog, 2);
  for (const invalid of ["5", "0", "1.5"]) { await second.getByLabel(/^Quantidade/).fill(invalid); await expect(dialog.getByRole("button", { name: "Confirmar e reservar", exact: true })).toBeDisabled(); expect(await contextualSaved(page)).toEqual(before); }
  await second.getByLabel(/^Quantidade/).fill("1"); await expect(dialog.getByRole("button", { name: "Confirmar e reservar", exact: true })).toBeEnabled();
});

test("CAR-B04 cliente/produto/entrada contextuais atuam no item acionado e preservam demais linhas", async ({ page }) => {
  await startContextual(page, "/vendas/", cartFixture()); const before = await contextualSaved(page), dialog = await openCart(page); await fillCart(dialog, true);
  let child = await openAuxiliary(page, dialog, "Cadastrar cliente", "Novo cliente"); await fillCustomer(child, "Cliente QA carrinho"); await child.getByRole("button", { name: "Salvar cliente", exact: true }).click();
  const customerId = (await contextualSaved(page)).customers.find((c) => c.name === "Cliente QA carrinho")!.id;
  const second = cartItem(dialog, 2); child = await openAuxiliary(page, second, "Cadastrar produto", "Novo produto"); await fillProduct(child, "QA-CART-NEW");
  await child.getByRole("button", { name: "Salvar produto", exact: true }).click(); const productId = (await contextualSaved(page)).products.find((p) => p.sku === "QA-CART-NEW")!.id;
  await expect(second.getByLabel(/^Produto/)).toHaveValue(productId); await expect(dialog.getByLabel(/^Cliente/)).toHaveValue(customerId);
  await expect(cartItem(dialog, 1).getByLabel(/^Produto/)).toHaveValue("p3"); await expect(cartItem(dialog, 1).getByLabel(/^Quantidade/)).toHaveValue("2");
  await expect(cartItem(dialog, 3).getByLabel(/^Produto/)).toHaveValue("p6"); await expect(cartItem(dialog, 3).getByLabel(/^Quantidade/)).toHaveValue("3");
  child = await openAuxiliary(page, second, "Registrar entrada", "Registrar entrada manual"); await child.getByLabel(/^Quantidade recebida/).fill("2"); await child.getByLabel(/^Motivo/).fill("Conferencia ficticia QA carrinho");
  await child.getByRole("button", { name: "Confirmar entrada", exact: true }).click();
  await expect(second.getByLabel(/^Produto/)).toBeFocused();
  const saved = await contextualSaved(page); expect(saved.products.find((p) => p.id === productId)).toMatchObject({ stock: 2, reserved: 0 });
  expect(saved.sales).toEqual(before.sales); expect(saved.finance).toEqual(before.finance); await expect(dialog.getByLabel(/^Cliente/)).toHaveValue(customerId);
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
});

test("CAR-B05 definir preço na segunda linha preserva seleções/quantidades e não confirma venda", async ({ page }) => {
  const state = cartFixture(); state.products.find((p) => p.id === "p4")!.pricePending = true;
  await startContextual(page, "/vendas/", state); const before = await contextualSaved(page), dialog = await openCart(page); await fillCart(dialog, true);
  const second = cartItem(dialog, 2); let child = await openAuxiliary(page, second, "Definir preço", "Definir preço do produto");
  await expect(child.getByLabel(/^Preço de venda/)).toBeFocused(); await child.getByLabel(/^Preço de venda/).fill("25.70"); await child.getByRole("button", { name: "Cancelar", exact: true }).click(); expect(await contextualSaved(page)).toEqual(before);
  child = await openAuxiliary(page, second, "Definir preço", "Definir preço do produto"); await child.getByLabel(/^Preço de venda/).fill("25.70"); await child.getByRole("button", { name: "Salvar produto", exact: true }).click();
  await expect(second.getByLabel(/^Produto/)).toBeFocused();
  await expect(second.getByLabel(/^Produto/)).toHaveValue("p4"); await expect(cartItem(dialog, 1).getByLabel(/^Quantidade/)).toHaveValue("2"); await expect(cartItem(dialog, 3).getByLabel(/^Quantidade/)).toHaveValue("3"); await expect(dialog.getByLabel(/^Cliente/)).toHaveValue("c3");
  expect(await contextualSaved(page)).toEqual({ ...before, products: before.products.map((p) => p.id === "p4" ? { ...p, price: 2570, pricePending: false } : p) });
});

test("CAR-B06 gravação recusada mantém carrinho; tentar novamente confirma e reserva uma vez", async ({ page }) => {
  await startContextual(page, "/vendas/", cartFixture()); const before = await contextualSaved(page), dialog = await openCart(page); await fillCart(dialog, true); await denyPricingStorage(page);
  await page.evaluate((existingIds) => {
    const rejectWrite = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "sistem:prototype:v1") {
        const candidate = (JSON.parse(value).sales as { id: string }[]).find((sale) => !existingIds.includes(sale.id));
        (window as unknown as { cartAttemptId?: string }).cartAttemptId = candidate?.id;
      }
      return rejectWrite.call(this, key, value);
    };
  }, before.sales.map((sale) => sale.id));
  await dialog.getByRole("button", { name: "Confirmar e reservar", exact: true }).click(); await expect(dialog).toBeVisible(); await expect(dialog.getByRole("alert")).toContainText(/gravar|gravação/i); expect(await contextualSaved(page)).toEqual(before);
  const attemptedId = await page.evaluate(() => (window as unknown as { cartAttemptId?: string }).cartAttemptId);
  expect(attemptedId).toBeTruthy();
  await expect(cartItem(dialog, 3).getByLabel(/^Quantidade/)).toHaveValue("3"); await expect(dialog.getByLabel(/^Cliente/)).toHaveValue("c3");
  await allowPricingStorage(page); await dialog.getByRole("button", { name: "Confirmar e reservar", exact: true }).click(); await expect(dialog).toHaveCount(0);
  const saved = await contextualSaved(page); expect(saved.sales).toHaveLength(before.sales.length + 1); expect(saved.sales.find((sale) => !before.sales.some((old) => old.id === sale.id))!.id).toBe(attemptedId); expect(saved.products.find((p) => p.id === "p3")).toMatchObject({ stock: 10, reserved: 4 }); expect(saved.products.find((p) => p.id === "p6")).toMatchObject({ stock: 9, reserved: 3 });
});

test("CAR-B07 falha ao gravar entrega mantém pedido/reservas/físico para nova tentativa", async ({ page }) => {
  await startContextual(page, "/vendas/", cartFixture()); const before = await contextualSaved(page), dialog = await openCart(page); await fillCart(dialog); await dialog.getByRole("button", { name: "Confirmar e reservar", exact: true }).click(); await expect(dialog).toHaveCount(0);
  const confirmed = await contextualSaved(page), sale = confirmed.sales.find((s) => !before.sales.some((old) => old.id === s.id))!, row = page.getByRole("row").filter({ hasText: String(sale.number) });
  // O anúncio de rota do Next também tem role=alert; o erro operacional pertence ao conteúdo principal.
  await denyPricingStorage(page); await row.getByRole("button", { name: "Entregar", exact: true }).click(); await expect(page.getByRole("main").getByRole("alert")).toContainText(/gravar|gravação/i); expect(await contextualSaved(page)).toEqual(confirmed); await expect(row.getByRole("button", { name: "Entregar", exact: true })).toBeVisible();
  await allowPricingStorage(page); await row.getByRole("button", { name: "Entregar", exact: true }).click();
  expect((await contextualSaved(page)).products.find((p) => p.id === "p4")).toMatchObject({ stock: 4, reserved: 1 });
});

test("CAR-B08 remover todas as linhas impede confirmar e permite recuperar sem efeitos", async ({ page }) => {
  await startContextual(page, "/vendas/", cartFixture()); const before = await contextualSaved(page), dialog = await openCart(page); await fillCart(dialog);
  await dialog.getByRole("button", { name: "Remover item 2", exact: true }).click(); await dialog.getByRole("button", { name: "Remover item 1", exact: true }).click();
  await expect(dialog.getByRole("group")).toHaveCount(0); await expect(dialog.getByRole("button", { name: "Confirmar e reservar", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Adicionar produto", exact: true }).click(); await expect(cartItem(dialog, 1).getByLabel(/^Produto/)).toHaveValue(""); await expect(cartItem(dialog, 1).getByLabel(/^Quantidade/)).toHaveValue("1");
  expect(await contextualSaved(page)).toEqual(before);
});
