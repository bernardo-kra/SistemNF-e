export type OrderApprovalChannel = "in_person" | "whatsapp" | "phone" | "email";
export const orderApprovalChannels: Readonly<Record<OrderApprovalChannel, string>>;
export type OrderBudgetRevision = {
  revision: number; scope: string; laborCents: number | null;
  source: "created" | "revision" | "legacy_snapshot";
  at: string; actorId: string; actorName: string;
};
export type OrderBudgetApproval = {
  revision: number; scope: string; laborCents: number;
  customerId: string; customerName: string; channel: OrderApprovalChannel; reference: string;
  at: string; actorId: string; actorName: string;
};
