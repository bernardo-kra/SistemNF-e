export type FinanceSource = { type: "sale" | "order"; id: string };
export type PaymentMethod = "cash" | "pix" | "transfer";
export interface FinanceAccount {
  id: string;
  name: string;
  type: "cash" | "bank";
  active: boolean;
  openingBalance: number;
  openingDate: string;
}
export interface CashShift {
  id: string;
  accountId: string;
  operator: string;
  openedOn: string;
  openedAt: string;
  openingBalance: number;
  status: "open" | "closed";
  counted?: number;
  expected?: number;
  difference?: number;
  closedOn?: string;
  closedAt?: string;
  closedBy?: string;
}
export interface PaymentAgreement {
  id: string;
  source: FinanceSource;
  sourceLabel: string;
  customerId: string;
  customerName: string;
  commercialTotal: number;
  legacyReceived: number;
  principal: number;
  createdAt: string;
}
export interface Installment {
  id: string;
  agreementId: string;
  kind: "down_payment" | "installment";
  number: number;
  count: number;
  amount: number;
  due: string;
}
export interface PaymentReceipt {
  code: string;
  companyName: string;
  customerName: string;
  sourceLabel: string;
  installmentLabel: string;
  due: string;
  amount: number;
  remaining: number;
  method: PaymentMethod;
  accountName: string;
  receivedOn: string;
  confirmedBy: string;
  reference: string;
  tendered: number;
  change: number;
}
export interface FinancePayment {
  id: string;
  idempotencyKey: string;
  requestFingerprint: string;
  amount: number;
  method: PaymentMethod;
  accountId: string;
  shiftId?: string;
  receivedOn: string;
  confirmedBy: string;
  reference: string;
  tendered: number;
  change: number;
  createdAt: string;
  receipt: PaymentReceipt;
}
export interface PaymentAllocation {
  id: string;
  paymentId: string;
  installmentId: string;
  amount: number;
}
export interface AccountMovement {
  id: string;
  accountId: string;
  paymentId: string;
  shiftId?: string;
  date: string;
  amount: number;
  kind: "receipt";
  createdAt: string;
}
export interface FinanceState {
  accounts: FinanceAccount[];
  shifts: CashShift[];
  agreements: PaymentAgreement[];
  installments: Installment[];
  payments: FinancePayment[];
  allocations: PaymentAllocation[];
  movements: AccountMovement[];
}
export interface AgreementInput {
  source: FinanceSource;
  downPayment: number;
  downPaymentDue: string;
  installmentCount: number;
  firstDue: string;
  installmentDueDates?: string[];
}
export interface PaymentInput {
  installmentId: string;
  amount: number;
  method: PaymentMethod;
  accountId: string;
  shiftId?: string;
  confirmedBy: string;
  reference?: string;
  tendered?: number;
  creditConfirmed: boolean;
  idempotencyKey: string;
}
export interface OpenShiftInput {
  accountId: string;
  operator: string;
}
export interface CloseShiftInput {
  shiftId: string;
  counted: number;
  closedBy: string;
}
