import { expect, type Page } from "@playwright/test";
import { seed } from "../src/lib/seed";
import { restoreDemoState } from "../src/lib/demo-persistence";
import type { DemoState, Product } from "../src/lib/domain";
import type { PurchaseDocument, PurchaseLine, PurchasingState } from "../src/lib/purchases/types";

export const intelligentKey = "sistem:prototype:v1";
export const intelligentAt = "2026-10-23T12:00:00.000Z";
export type IntelligentState = DemoState & { purchasing?: PurchasingState };

export function cover(id = "cover-15pro", model = "iPhone 15 Pro", finish = "Transparente"): Product {
  return { id, sku: id.toUpperCase(), name: `Capa ${finish} · ${model}`, category: "Capas", unit: "UN", cost: 1000, price: 2500,
    stock: 2, reserved: 1, minimum: 0, serialized: false, ncm: "39269090",
    attributes: { compatibleModels: [model], material: "Acrílico", finish, magsafe: true } };
}

export function intelligentFixture(): IntelligentState {
  const state = structuredClone(seed) as IntelligentState;
  state.products.push(cover(), cover("cover-16", "iPhone 16", "Fosca"));
  return state;
}

export function purchaseLine(patch: Partial<PurchaseLine> = {}): PurchaseLine {
  return { id: "line-1", code: "000123", description: "CAPA ACRILICA TRANSPARENTE MAGSAFE APPLE - APPLE IPHONE 15 PRO PROTECAO DE LENTE", unit: "UN", quantity: 5, costCents: 1000, ncm: "39269090", ...patch };
}

export function purchaseDocument(patch: Partial<PurchaseDocument> = {}): PurchaseDocument {
  return { key: "QA-COMPRA-A-001", supplierId: "11111111000111", supplierName: "Fornecedor A fictício", number: "001", items: [purchaseLine()], ...patch };
}

export function knownPurchasing(document = purchaseDocument(), product = cover()): PurchasingState {
  return { links: document.items.map((line, index) => ({ id: `link-${index}`, supplierId: document.supplierId, supplierCode: line.code,
    unit: line.unit, productId: product.id, description: line.description, confirmedAt: intelligentAt, conversion: 1,
    attributes: structuredClone(product.attributes || {}) })), documents: [], receipts: [] };
}

export function purchaseXml(document: PurchaseDocument) {
  const escape = (value: unknown) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc><NFe><infNFe Id="${escape(document.key)}"><ide><nNF>${escape(document.number)}</nNF></ide><emit><CNPJ>${escape(document.supplierId)}</CNPJ><xNome>${escape(document.supplierName)}</xNome></emit>${document.items.map((line, index) => `<det nItem="${index + 1}"><prod><cProd>${escape(line.code)}</cProd><xProd>${escape(line.description)}</xProd><NCM>${escape(line.ncm)}</NCM><cEAN>${escape(line.gtin || "SEM GTIN")}</cEAN><uCom>${escape(line.unit)}</uCom><qCom>${line.quantity}</qCom><vUnCom>${(line.costCents / 100).toFixed(2)}</vUnCom><vProd>${((line.totalCents ?? line.quantity * line.costCents) / 100).toFixed(2)}</vProd></prod></det>`).join("")}<total><ICMSTot><vNF>${((document.totalCents ?? document.items.reduce((sum, line) => sum + (line.totalCents ?? line.quantity * line.costCents), 0)) / 100).toFixed(2)}</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`;
}

export async function startIntelligent(page: Page, route = "/importar/", state: unknown = intelligentFixture(), normalize = true) {
  const raw = JSON.stringify(normalize ? restoreDemoState(state) : state);
  await page.addInitScript(({ key, value }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, value); }, { key: intelligentKey, value: raw });
  await page.goto(route);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  return raw;
}

export async function savedIntelligent(page: Page): Promise<IntelligentState> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), intelligentKey);
}

export async function uploadPurchase(page: Page, document: PurchaseDocument) {
  await page.locator('input[type="file"]').setInputFiles({ name: "compra-ficticia.xml", mimeType: "application/xml", buffer: Buffer.from(purchaseXml(document), "utf8") });
}

export function expectNoMoneyOrFiscal(after: DemoState, before: DemoState) {
  expect(after.finance).toEqual(before.finance);
  expect(after.documents).toEqual(before.documents);
  expect(after.orders).toEqual(before.orders);
  expect(after.sales).toEqual(before.sales);
}
