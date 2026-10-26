import type { DemoState } from "./domain";

export type ProductPriceChange = {
  productId: string;
  expectedCost: number;
  expectedPrice: number;
  expectedPricePending: boolean;
  price: number;
};

export const MAX_PRODUCT_PRICE = 999999900;
export const MAX_MARKUP_BASIS_POINTS = 999999;
const cents = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Percentual em centésimos de ponto percentual: 50% = 5000. */
export function priceWithMarkup(cost: number, markupBasisPoints: number): number {
  if (!cents(cost) || !cents(markupBasisPoints) || markupBasisPoints > MAX_MARKUP_BASIS_POINTS)
    throw new Error("Confira a compra e o acréscimo: use de 0 a 9999,99%, com até duas casas.");
  // Round once, at the cent, without floating point or losing half a cent.
  const price = (BigInt(cost) * (10000n + BigInt(markupBasisPoints)) + 5000n) / 10000n;
  if (price > BigInt(MAX_PRODUCT_PRICE))
    throw new Error("O preço sugerido ultrapassa R$ 9.999.999,00. Informe um preço válido.");
  return Number(price);
}

export function applyProductPrices(state: DemoState, changes: ProductPriceChange[]): DemoState {
  if (!Array.isArray(changes) || !changes.length)
    throw new Error("Selecione ao menos um produto para definir os preços.");
  const products = new Map<string, DemoState["products"][number]>();
  const ambiguous = new Set<string>();
  for (const product of state.products) {
    if (products.has(product.id)) ambiguous.add(product.id);
    products.set(product.id, product);
  }
  const updates = new Map<string, number>();
  for (const change of changes) {
    if (!change || typeof change.productId !== "string" || !change.productId ||
        updates.has(change.productId) || !cents(change.price) || change.price > MAX_PRODUCT_PRICE ||
        !cents(change.expectedCost) || !cents(change.expectedPrice) || typeof change.expectedPricePending !== "boolean")
      throw new Error("Confira a seleção e os preços. Cada produto deve aparecer uma única vez, com valores válidos.");
    const product = products.get(change.productId);
    if (!product || ambiguous.has(change.productId))
      throw new Error("Um produto não está mais disponível. Reabra a prévia para conferir o conjunto.");
    if (product.cost !== change.expectedCost)
      throw new Error("A compra de referência foi alterada. Reabra a prévia antes de confirmar os preços.");
    const alreadyAssigned = product.price === change.price && !product.pricePending;
    if (!alreadyAssigned && (product.price !== change.expectedPrice || Boolean(product.pricePending) !== change.expectedPricePending))
      throw new Error("Um preço ou sua pendência foi alterado. Reabra a prévia para preservar a atualização anterior.");
    updates.set(change.productId, change.price);
  }
  // All validation precedes the update. Absolute assignment makes retries harmless.
  return { ...state, products: state.products.map((product) => updates.has(product.id)
    ? { ...product, price: updates.get(product.id)!, pricePending: false } : product) };
}
