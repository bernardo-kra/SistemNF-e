export type SaleStatus = "confirmed" | "delivered";
export type SaleFilters = { from: string; to: string; q: string; status: "all" | SaleStatus };
export type SaleReport = {
  tenantId: string;
  filters: SaleFilters;
  generatedAt: string;
  limit: number;
  offset: number;
  totals: { count: number; grossCents: number; discountCents: number; totalCents: number };
  items: {
    id: string; number: number; at: string; date: string; customerName: string; status: SaleStatus;
    grossCents: number; discountCents: number; totalCents: number;
  }[];
};
