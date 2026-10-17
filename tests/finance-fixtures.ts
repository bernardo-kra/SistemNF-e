import { seed } from "../src/lib/seed";
import type { DemoState } from "../src/lib/domain";
import { defaultFinance } from "../src/lib/finance/engine";

// Valores fictícios para conferir recebimentos. Nenhum crédito bancário é real.
export const financeAt = "2026-10-16T12:00:00.000Z";
export const financeDay = "2026-10-16";

export function financeFixture(saleTotal = 120000): DemoState {
  const state = structuredClone(seed);
  state.finance = defaultFinance();
  const sale = state.sales.find((item) => item.id === "s400")!;
  sale.total = saleTotal;
  sale.items = [{ productId: "p3", quantity: 1, unitPrice: saleTotal }];
  return state;
}
