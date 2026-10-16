export type FiscalModel = "NF-e" | "NFC-e" | "NFS-e";
export type FiscalStatus =
  | "draft"
  | "queued"
  | "processing"
  | "authorized"
  | "rejected"
  | "unknown"
  | "cancellation_pending"
  | "cancelled";
export type TaxRegime = "unknown" | "mei" | "simples" | "presumido" | "real";
export interface FiscalAddress {
  street: string;
  number: string;
  district: string;
  city: string;
  state: string;
  zipCode: string;
  municipalityCode: string;
}
export interface CompanyFiscalProfile {
  environment: "simulation";
  legalName: string;
  cnpj: string;
  stateRegistration: string;
  municipalRegistration: string;
  regime: TaxRegime;
  address: FiscalAddress;
}
export interface ProductFiscalProfile {
  origin: string;
  cfop: string;
  taxSituation: string;
  cest: string;
  ibsCbsClass: string;
}
export interface ServiceFiscalProfile {
  description: string;
  serviceCode: string;
  municipalCode: string;
  ibsCbsClass: string;
}
export interface FiscalIssue {
  code: string;
  label: string;
  href: string;
}
export interface FiscalSource {
  type: "sale" | "order";
  id: string;
}
export interface FiscalSnapshot {
  company: CompanyFiscalProfile;
  customer: {
    id: string;
    name: string;
    document: string;
    address?: FiscalAddress;
  };
  model: FiscalModel;
  sourceLabel: string;
  lines: {
    description: string;
    quantity: number;
    unitPrice: number;
    ncm?: string;
    productFiscal?: ProductFiscalProfile;
    serviceFiscal?: ServiceFiscalProfile;
  }[];
  total: number;
  excludedParts: number;
  taxCalculation: "not_calculated";
  warnings: string[];
}
export interface FiscalEvent {
  at: string;
  label: string;
  status: FiscalStatus;
  snapshot?: FiscalSnapshot;
}
export interface FiscalDocument {
  id: string;
  number: string;
  customer: string;
  model: FiscalModel;
  total: number;
  status: FiscalStatus;
  date: string;
  mode?: "example" | "simulation";
  source?: FiscalSource;
  snapshot?: FiscalSnapshot;
  history?: FiscalEvent[];
  attempts?: number;
  resultMessage?: string;
  simulationReference?: string;
  cancellationReason?: string;
}
export type SimulationOutcome = "authorized" | "rejected" | "unknown";
export type FiscalAction =
  | "queue"
  | "begin"
  | "authorize"
  | "reject"
  | "unknown"
  | "reconcile_authorized"
  | "reconcile_rejected"
  | "retry"
  | "request_cancel"
  | "confirm_cancel";
