import type { DemoState, Sale } from "./domain";
import { isCivilDate } from "./finance/engine";
import { assertSaleEligible } from "./sales-eligibility";

const nonnegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function inspectItems(sale: Sale): Map<string, number> {
  if (!Array.isArray(sale.items) || !sale.items.length)
    throw new Error("Adicione ao menos um produto ao pedido.");
  const quantities = new Map<string, number>();
  let total = 0;
  for (const item of sale.items) {
    if (!item || typeof item.productId !== "string" || !item.productId ||
        !nonnegativeInteger(item.quantity) || !item.quantity || !nonnegativeInteger(item.unitPrice))
      throw new Error("Confira os produtos, as quantidades inteiras positivas e os preços do pedido.");
    const quantity = (quantities.get(item.productId) || 0) + item.quantity;
    const amount = item.quantity * item.unitPrice;
    total += amount;
    if (!Number.isSafeInteger(quantity) || !Number.isSafeInteger(amount) || !Number.isSafeInteger(total))
      throw new Error("A quantidade ou o valor do pedido ultrapassa o limite suportado.");
    quantities.set(item.productId, quantity);
  }
  if (!nonnegativeInteger(sale.total) || sale.total !== total)
    throw new Error("O total do pedido não corresponde aos itens informados.");
  return quantities;
}

function requestSignature(sale: Sale): string {
  return JSON.stringify({ customerId: sale.customerId, date: sale.date, total: sale.total,
    items: sale.items.map(({ productId, quantity, unitPrice }) => ({ productId, quantity, unitPrice })) });
}

function catalog(state: DemoState) {
  const products = new Map<string, DemoState["products"][number]>();
  const ambiguous = new Set<string>();
  for (const product of state.products) {
    if (products.has(product.id)) ambiguous.add(product.id);
    products.set(product.id, product);
  }
  return { products, ambiguous };
}

export function applySaleConfirmation(state: DemoState, sale: Sale): DemoState {
  if (!sale || typeof sale.id !== "string" || !sale.id.trim() || sale.status !== "confirmed" ||
      typeof sale.customerId !== "string" || !sale.customerId || !isCivilDate(sale.date))
    throw new Error("Confira a identificação, o cliente e a data do pedido.");
  const quantities = inspectItems(sale);
  const existing = state.sales.filter((entry) => entry.id === sale.id);
  if (existing.length) {
    if (existing.length !== 1 || requestSignature(existing[0]) !== requestSignature(sale))
      throw new Error("Esta tentativa já foi usada com outro conteúdo. O pedido anterior foi preservado.");
    // Replay must precede availability checks: its units may already be reserved/delivered.
    return state;
  }
  assertSaleEligible(state, sale);
  const { products, ambiguous } = catalog(state);
  for (const productId of quantities.keys()) {
    const product = products.get(productId);
    if (ambiguous.has(productId) || !product)
      throw new Error("Não foi possível identificar um dos produtos. Confira o catálogo.");
    if (!nonnegativeInteger(product.stock) || !nonnegativeInteger(product.reserved) || product.reserved > product.stock)
      throw new Error("Confira o estoque físico e as reservas antes de confirmar o pedido.");
  }
  const maximum = state.sales.reduce((largest, entry) => {
    if (!nonnegativeInteger(entry.number)) throw new Error("Confira a numeração dos pedidos anteriores.");
    return Math.max(largest, entry.number);
  }, 401);
  if (!Number.isSafeInteger(maximum + 1)) throw new Error("A numeração dos pedidos atingiu o limite suportado.");
  const confirmed: Sale = { id: sale.id, number: maximum + 1, customerId: sale.customerId,
    date: sale.date, status: "confirmed", total: sale.total,
    items: sale.items.map(({ productId, quantity, unitPrice }) => ({ productId, quantity, unitPrice })) };
  return { ...state, sales: [confirmed, ...state.sales], products: state.products.map((product) => {
    const quantity = quantities.get(product.id);
    return quantity ? { ...product, reserved: product.reserved + quantity } : product;
  }) };
}

export function applySaleDelivery(state: DemoState, saleId: string): DemoState {
  const matches = state.sales.filter((entry) => entry.id === saleId);
  if (matches.length !== 1) throw new Error("Este pedido não está disponível para entrega.");
  const sale = matches[0];
  if (sale.status === "delivered") return state;
  if (sale.status !== "confirmed") throw new Error("Confirme o pedido antes de registrar a entrega.");
  const quantities = inspectItems(sale);
  const { products, ambiguous } = catalog(state);
  for (const [productId, quantity] of quantities) {
    const product = products.get(productId);
    if (!product || ambiguous.has(productId)) throw new Error("Um produto do pedido não está disponível. Nenhuma baixa foi confirmada.");
    if (product.serialized) throw new Error("A conferência individual de séries ainda não está disponível para esta entrega.");
    if (!nonnegativeInteger(product.stock) || !nonnegativeInteger(product.reserved) ||
        product.stock < quantity || product.reserved < quantity || product.reserved > product.stock)
      throw new Error("Estoque físico ou reserva insuficiente. Confira todos os itens antes da entrega.");
  }
  return { ...state, sales: state.sales.map((entry) => entry.id === saleId ? { ...entry, status: "delivered" } : entry),
    products: state.products.map((product) => {
      const quantity = quantities.get(product.id);
      return quantity ? { ...product, stock: product.stock - quantity, reserved: product.reserved - quantity } : product;
    }) };
}
