export interface ProductAttributes {
  compatibleModels?: string[];
  material?: string;
  finish?: string;
  color?: string;
  magsafe?: boolean;
  connectors?: string[];
  lengthMeters?: number;
  lensProtection?: boolean;
  border?: string;
  powerWatts?: number;
}

export interface PurchaseLine {
  id: string;
  code: string;
  description: string;
  unit: string;
  quantity: number;
  costCents: number;
  ncm: string;
  gtin?: string;
  totalCents?: number;
  rawQuantity?: string;
  rawUnitCost?: string;
}

export interface PurchaseDocument {
  key: string;
  supplierId: string;
  supplierName: string;
  number: string;
  items: PurchaseLine[];
  totalCents?: number;
  originalXml?: string;
  /** Componentes explícitos do XML; nunca uma diferença calculada para fechar o total. */
  totalsAdjustmentCents?: number;
}

export interface PurchaseDecision {
  action: "new" | "link" | "ignore";
  productId?: string;
  conversion?: number;
  receivedQuantity?: number;
  priceCents?: number;
  name?: string;
  category?: string;
  attributes?: ProductAttributes;
}

export interface PurchaseInput {
  document: PurchaseDocument;
  decisions: Record<string, PurchaseDecision>;
  receive: boolean;
  operationId: string;
  now: string;
}

export interface SupplierProductLink {
  id: string;
  supplierId: string;
  supplierCode: string;
  unit: string;
  productId: string;
  description: string;
  confirmedAt: string;
  conversion: number;
  attributes: ProductAttributes;
  gtin?: string;
}

export interface PurchaseRecordLine {
  source: PurchaseLine;
  action: "new" | "link" | "ignore";
  productId?: string;
  conversion: number;
}

export interface PurchaseRecord {
  key: string;
  supplierId: string;
  supplierName: string;
  number: string;
  importedAt: string;
  lines: PurchaseRecordLine[];
  financeStatus: "pending";
  totalCents?: number;
  originalXml?: string;
  totalsAdjustmentCents?: number;
  operationId?: string;
  operationFingerprint?: string;
}

export interface PurchaseReceipt {
  id: string;
  documentKey: string;
  createdAt: string;
  operationFingerprint?: string;
  items: {
    lineId: string;
    productId: string;
    quantity: number;
    stockQuantity: number;
  }[];
}

export interface PurchasingState {
  links: SupplierProductLink[];
  documents: PurchaseRecord[];
  receipts: PurchaseReceipt[];
  operations?: { id: string; fingerprint: string }[];
}

export interface PurchasePlanLine {
  source: PurchaseLine;
  resolution: "known" | "new" | "review";
  productId?: string;
  reason: string;
  candidates: string[];
  name: string;
  category: string;
  attributes: ProductAttributes;
  conversion: number;
}

export interface PurchasePlan {
  lines: PurchasePlanLine[];
}
