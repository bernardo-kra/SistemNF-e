export type InstallmentStatus = "open" | "overdue" | "paid";
export type InstallmentFilters = { from: string; to: string; q: string; asOf: string; status: "all" | InstallmentStatus };
export type InstallmentReport = {
  tenantId: string;
  filters: InstallmentFilters;
  generatedAt: string;
  limit: number;
  offset: number;
  totals: { count: number; principalCents: number; paidCents: number; balanceCents: number; overdueCents: number };
  items: {
    id: string; agreementId: string; customerId: string; customerName: string;
    sourceType: "sale" | "order"; sourceId: string; sourceLabel: string;
    kind: "down_payment" | "installment"; number: number; count: number; due: string;
    amountCents: number; paidCents: number; balanceCents: number; overdueCents: number; status: InstallmentStatus;
  }[];
};
