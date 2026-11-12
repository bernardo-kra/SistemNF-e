export type OrderStage = "received" | "diagnosing" | "awaiting_approval" | "in_progress" | "quality_check" | "ready_for_pickup" | "delivered" | "closed_without_repair";
export type OrderFilters = { from: string; to: string; q: string; stage: "all" | OrderStage; approval: "all" | "approved" | "pending" };
export type OrderReport = {
  tenantId: string;
  filters: OrderFilters;
  generatedAt: string;
  limit: number;
  offset: number;
  totals: { count: number; laborCents: number; approvedCents: number; unapprovedCents: number; unpricedCount: number };
  items: {
    id: string; number: number; at: string; date: string; customerName: string; technicianName: string | null; equipment: string;
    stage: OrderStage; approved: boolean; laborCents: number | null;
  }[];
};
