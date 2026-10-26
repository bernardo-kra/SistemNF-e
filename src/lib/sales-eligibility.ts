import type { DemoState, Sale } from "./domain";

/** Valida o conjunto antes de criar a venda ou reservar qualquer quantidade. */
export function assertSaleEligible(
  state: Pick<DemoState, "products" | "customers">,
  sale: Sale,
): void {
  if (!state.customers.some((customer) => customer.id === sale.customerId))
    throw new Error("Selecione um cliente cadastrado para esta venda.");
  if (sale.status !== "confirmed" || !Array.isArray(sale.items) || !sale.items.length)
    throw new Error("Confira os itens e a situação da venda.");
  const products = new Map(state.products.map((product) => [product.id, product]));
  const quantities = new Map<string, number>();
  let total = 0;
  for (const item of sale.items) {
    const product = products.get(item.productId);
    if (!product) throw new Error("O produto selecionado não está disponível.");
    if (product.pricePending)
      throw new Error("Defina o preço de venda pendente antes de vender este produto.");
    if (product.serialized)
      throw new Error("A conferência individual de séries ainda não está disponível para esta venda.");
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0 ||
        !Number.isSafeInteger(item.unitPrice) || item.unitPrice < 0)
      throw new Error("Confira a quantidade e o preço dos itens da venda.");
    const quantity = (quantities.get(item.productId) || 0) + item.quantity;
    if (!Number.isSafeInteger(quantity) || quantity > product.stock - product.reserved)
      throw new Error("Estoque disponível insuficiente. Revise os itens.");
    quantities.set(item.productId, quantity);
    const amount = item.quantity * item.unitPrice;
    total += amount;
    if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(total))
      throw new Error("O valor dos itens excede o limite suportado.");
  }
  if (!Number.isSafeInteger(sale.total) || sale.total !== total)
    throw new Error("O total da venda não corresponde aos itens informados.");
}
