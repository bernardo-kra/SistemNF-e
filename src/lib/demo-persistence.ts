import type { DemoState } from "./domain";
import { defaultFinance } from "./finance/engine";
import { restoreFinanceState } from "./finance/persistence";
import { restoreTechnicians } from "./technicians";
import { restorePurchasing } from "./purchases/engine";
import {
  defaultCompanyFiscal,
  defaultServiceFiscal,
  emptyAddress,
} from "./fiscal/defaults";
import type {
  CompanyFiscalProfile,
  FiscalAddress,
  ServiceFiscalProfile,
} from "./fiscal/types";

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown, fields: string[]) =>
  record(value) && fields.every((key) => typeof value[key] === "string");
const address = (value: unknown): value is FiscalAddress =>
  strings(value, Object.keys(emptyAddress));
const productAttributes = (value: unknown): boolean => {
  if (value === undefined) return true;
  if (!record(value)) return false;
  for (const key of ["compatibleModels", "connectors"]) {
    if (value[key] !== undefined && (!Array.isArray(value[key]) ||
        !(value[key] as unknown[]).every((entry) => typeof entry === "string" && entry.trim()))) return false;
  }
  for (const key of ["material", "finish", "color", "border"]) {
    if (value[key] !== undefined && (typeof value[key] !== "string" || !value[key].trim())) return false;
  }
  for (const key of ["magsafe", "lensProtection"]) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") return false;
  }
  for (const key of ["lengthMeters", "powerWatts"]) {
    if (value[key] !== undefined && (typeof value[key] !== "number" || !Number.isFinite(value[key]) || value[key] <= 0)) return false;
  }
  return true;
};

export function restoreDemoState(value: unknown): DemoState {
  if (!record(value) || ![1, 2, 3].includes(Number(value.version)))
    throw new Error("Versão de armazenamento incompatível.");
  const arrays = [
    "customers",
    "products",
    "orders",
    "sales",
    "documents",
    "imports",
  ];
  if (arrays.some((key) => !Array.isArray(value[key])))
    throw new Error("Dados locais incompletos.");
  const s = value as unknown as DemoState;
  if (
    !s.customers.every(
      (c) =>
        strings(c, ["id", "name", "phone", "email"]) &&
        ["Pessoa física", "Empresa"].includes(c.type),
    ) ||
    !s.products.every(
      (p) =>
        strings(p, ["id", "name", "sku", "category", "unit", "ncm"]) &&
        (p.pricePending === undefined || typeof p.pricePending === "boolean") &&
        (p.gtin === undefined || typeof p.gtin === "string") &&
        productAttributes(p.attributes) &&
        [p.stock, p.reserved, p.minimum, p.price, p.cost].every(
          (n) => Number.isSafeInteger(n) && n >= 0,
        ),
    ) ||
    !s.orders.every(
      (o) =>
        strings(o, [
          "id",
          "equipment",
          "serial",
          "customerId",
          "due",
          "created",
          "technician",
        ]) &&
        Array.isArray(o.history) &&
        [
          "received",
          "diagnosing",
          "awaiting_approval",
          "in_progress",
          "quality_check",
          "ready_for_pickup",
          "delivered",
        ].includes(o.stage) &&
        [o.parts, o.labor, o.received].every(
          (n) => Number.isSafeInteger(n) && n >= 0,
        ),
    ) ||
    !s.sales.every(
      (sale) => Array.isArray(sale.items) && Number.isSafeInteger(sale.total),
    ) ||
    !s.documents.every(
      (d) =>
        strings(d, ["id", "number", "customer", "date"]) &&
        Number.isSafeInteger(d.total) &&
        [
          "draft",
          "queued",
          "processing",
          "authorized",
          "rejected",
          "unknown",
          "cancellation_pending",
          "cancelled",
        ].includes(d.status) &&
        ["NF-e", "NFC-e", "NFS-e"].includes(d.model),
    )
  )
    throw new Error("Dados locais inválidos.");
  let profile = structuredClone(defaultCompanyFiscal);
  if (
    strings(s.fiscalProfile, [
      "legalName",
      "cnpj",
      "stateRegistration",
      "municipalRegistration",
      "regime",
    ]) &&
    address(s.fiscalProfile.address)
  )
    profile = {
      ...s.fiscalProfile,
      environment: "simulation",
    } as CompanyFiscalProfile;
  let service = { ...defaultServiceFiscal };
  if (
    strings(s.serviceFiscal, [
      "description",
      "serviceCode",
      "municipalCode",
      "ibsCbsClass",
    ])
  )
    service = s.serviceFiscal as ServiceFiscalProfile;
  return structuredClone({
    ...s,
    version: 3,
    technicians: restoreTechnicians(s.technicians, s.orders),
    ...(s.purchasing !== undefined ? { purchasing: restorePurchasing(s.purchasing, s.products) } : {}),
    finance:
      Number(value.version) === 3
        ? restoreFinanceState(value.finance, s)
        : defaultFinance(),
    fiscalProfile: profile,
    serviceFiscal: service,
    documents: s.documents.map((d) => ({
      ...d,
      mode:
        d.mode === "simulation" &&
        d.snapshot &&
        d.source &&
        Array.isArray(d.history)
          ? "simulation"
          : "example",
    })),
  });
}
