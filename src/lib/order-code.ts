import type { ServiceOrder } from "./domain";

const referencePattern = /^[A-Za-z0-9-]{1,64}$/;
const prefix = "SISTEM-OS:";

/** A local lookup reference, never an authorization or a customer's credential. */
export function orderCode(order: { id: string }): string {
  if (!referencePattern.test(order.id)) {
    throw new Error("Esta ordem não tem uma referência compatível com o código de leitura.");
  }
  return `${prefix}${order.id}`;
}

export function findOrderByCode(
  orders: ServiceOrder[],
  code: string,
): ServiceOrder | undefined {
  if (!code.startsWith(prefix)) return undefined;
  const id = code.slice(prefix.length);
  if (!referencePattern.test(id)) return undefined;
  return orders.find((order) => order.id === id);
}
