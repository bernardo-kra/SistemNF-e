export type ReceiptFilters = { from: string; to: string; q: string; method: "" | "cash" | "pix" | "transfer" };
export type ReceiptReport = {
  tenantId: string;
  filters: ReceiptFilters;
  generatedAt: string;
  limit: number;
  offset: number;
  totals: { count: number; amountCents: number };
  items: { id: string; at: string; date: string; customerName: string; accountName: string; receivedByName: string; method: "cash" | "pix" | "transfer"; amountCents: number }[];
};
