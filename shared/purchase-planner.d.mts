export interface ProductAttributes {
  compatibleModels?: string[]; material?: string; finish?: string; color?: string; magsafe?: boolean;
  connectors?: string[]; lengthMeters?: number; lensProtection?: boolean; border?: string; powerWatts?: number;
}
export interface PurchaseLine { id: string; code: string; description: string; unit: string; quantity: number; costCents: number; ncm: string; gtin?: string; totalCents?: number; rawQuantity?: string; rawUnitCost?: string }
export interface PurchaseDocument { key: string; supplierId: string; supplierName: string; number: string; items: PurchaseLine[]; totalCents?: number; originalXml?: string; totalsAdjustmentCents?: number }
export interface PlannerProduct { id: string; name: string; category: string; gtin?: string; attributes?: ProductAttributes }
export interface SupplierProductLink { id: string; supplierId: string; supplierCode: string; unit: string; productId: string; description: string; confirmedAt: string; conversion: number; attributes: ProductAttributes; gtin?: string }
export interface PurchasePlanLine { source: PurchaseLine; resolution: "known" | "new" | "review"; productId?: string; reason: string; candidates: string[]; name: string; category: string; attributes: ProductAttributes; conversion: number }
export interface PurchasePlan { lines: PurchasePlanLine[] }
export function extractProductIdentity(description: string): { name: string; category: string; attributes: ProductAttributes };
export function buildPurchasePlan(state: { products: PlannerProduct[]; purchasing?: { links: SupplierProductLink[] } }, document: PurchaseDocument): PurchasePlan;
export function conflicts(current: ProductAttributes, baseline: ProductAttributes, requireKnown?: boolean): boolean;
export function validGtin(value?: string): string | undefined;
export function mixedColors(value: string): boolean;
