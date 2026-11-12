export type OrderReturnReason = "estimate_declined" | "repair_unavailable" | "customer_withdrew" | "other";
export const orderReturnReasons: Readonly<Record<OrderReturnReason, string>>;
export type OrderReturnInfo = {
  reason: OrderReturnReason; details: string;
  recipientType: "customer" | "other"; recipientName: string; authorization: string;
  at: string; actorId: string; actorName: string;
};
