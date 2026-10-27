export type AgreementTerms = { downPaymentCents: number; downPaymentDue?: string; installmentCount: number; firstDue?: string; installmentDueDates?: string[] };
export type PlannedInstallment = { kind: "down_payment" | "installment"; number: number; count: number; amountCents: number; due: string };
export function civilDate(value: unknown): string;
export function planInstallments(principal: number, terms: AgreementTerms, today: string): PlannedInstallment[];
