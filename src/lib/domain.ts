import type {
  CompanyFiscalProfile,
  FiscalAddress,
  FiscalDocument,
  ProductFiscalProfile,
  ServiceFiscalProfile,
} from "./fiscal/types";
import type { FinanceState } from "./finance/types";
import type { ProductAttributes, PurchasingState } from "./purchases/types";
export type { FiscalDocument } from "./fiscal/types";
export type Tone = "neutral" | "info" | "success" | "warning" | "danger";
export type Stage =
  | "received"
  | "diagnosing"
  | "awaiting_approval"
  | "in_progress"
  | "quality_check"
  | "ready_for_pickup"
  | "delivered";
export const stages: Record<Stage, { label: string; tone: Tone }> = {
  received: { label: "Recebida", tone: "neutral" },
  diagnosing: { label: "Em diagnóstico", tone: "info" },
  awaiting_approval: { label: "Aguardando aprovação", tone: "warning" },
  in_progress: { label: "Em execução", tone: "info" },
  quality_check: { label: "Em testes", tone: "info" },
  ready_for_pickup: { label: "Pronta para retirada", tone: "success" },
  delivered: { label: "Entregue", tone: "neutral" },
};
export interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  type: "Pessoa física" | "Empresa";
  document?: string;
  fiscalAddress?: FiscalAddress;
}
export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  cost: number;
  price: number;
  /** Valor ainda não definido para venda; zero interno não representa gratuidade. */
  pricePending?: boolean;
  attributes?: ProductAttributes;
  gtin?: string;
  stock: number;
  reserved: number;
  minimum: number;
  serialized: boolean;
  ncm: string;
  supplierCode?: string;
  supplierId?: string;
  lastReceipt?: string;
  fiscal?: ProductFiscalProfile;
}
export interface Activity {
  label: string;
  date: string;
  at?: string;
}
export interface ServiceOrder {
  id: string;
  number: number;
  customerId: string;
  equipment: string;
  serial: string;
  accessories: string;
  issue: string;
  diagnosis: string;
  stage: Stage;
  technician: string;
  due: string;
  created: string;
  parts: number;
  labor: number;
  /** Acumulado legado, sem origem de caixa. Novos pagamentos são derivados por orderReceived. */
  received: number;
  approved: boolean;
  tested: boolean;
  history: Activity[];
}
export interface Sale {
  id: string;
  number: number;
  customerId: string;
  items: { productId: string; quantity: number; unitPrice: number }[];
  status: "confirmed" | "delivered";
  date: string;
  total: number;
}
/** Cadastro operacional de responsável; não representa identidade de acesso. */
export interface Technician {
  id: string;
  name: string;
}
export interface DemoState {
  version: 3;
  technicians?: Technician[];
  purchasing?: PurchasingState;
  finance: FinanceState;
  customers: Customer[];
  products: Product[];
  orders: ServiceOrder[];
  sales: Sale[];
  documents: FiscalDocument[];
  imports: string[];
  fiscalProfile: CompanyFiscalProfile;
  serviceFiscal: ServiceFiscalProfile;
}
export const money = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    cents / 100,
  );
export const dateLabel = (date: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
export const TODAY = "2026-10-16";
export const sumOrder = (order: ServiceOrder) => order.parts + order.labor;
export const matches = (text: string, query: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .includes(
      query
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase(),
    );
