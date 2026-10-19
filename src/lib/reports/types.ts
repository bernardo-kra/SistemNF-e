import type { PaymentMethod } from "../finance/types";
export type ReportKind = "receipts" | "installments" | "sales" | "orders";
export interface ReportFilters {
  kind: ReportKind;
  from: string;
  to: string;
  asOf: string;
  customerId?: string;
  method?: PaymentMethod;
  accountId?: string;
}
export interface ReportRow { id: string; [key: string]: string | number | boolean | null }
export interface ReportColumn { key: string; label: string; format: "text" | "money" | "date" }
export interface ReportTotals {
  count: number;
  received: number;
  commercial: number;
  legacy: number;
  principal: number;
  paid: number;
  balance: number;
  overdue: number;
  eligibleBalance: number;
  unapproved: number;
  reviewCount: number;
}
export interface ReportResult {
  kind: ReportKind;
  filters: ReportFilters;
  columns: ReportColumn[];
  rows: ReportRow[];
  totals: ReportTotals;
  warnings: string[];
}
