import type { DemoState } from "../domain";
import type { FinanceState } from "./types";
import {
  accountBalance,
  financeSource,
  financialDate,
  installmentBalance,
  isCivilDate,
  methodLabels,
} from "./engine";

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown) => typeof value === "string" && !!value.trim();
const cents = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;
const instant = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
function requireValid(condition: unknown): asserts condition {
  if (!condition)
    throw new Error(
      "Os registros financeiros locais estão incompletos ou inconsistentes. O arquivo original deve ser preservado.",
    );
}
const sum = (values: number[]) => {
  const value = values.reduce((a, b) => a + b, 0);
  requireValid(cents(value));
  return value;
};

/** Strict v3 restoration: a broken ledger must never silently become an empty one. */
export function restoreFinanceState(
  value: unknown,
  operational: DemoState,
): FinanceState {
  requireValid(object(value));
  for (const key of [
    "accounts",
    "shifts",
    "agreements",
    "installments",
    "payments",
    "allocations",
    "movements",
  ]) {
    const rows = value[key];
    requireValid(Array.isArray(rows));
    requireValid(rows.every((row) => object(row) && text(row.id)));
    requireValid(new Set(rows.map((row) => row.id)).size === rows.length);
  }
  const finance = value as unknown as FinanceState;
  const state = { ...operational, finance };
  for (const account of finance.accounts) {
    requireValid(
      text(account.name) &&
        ["cash", "bank"].includes(account.type) &&
        typeof account.active === "boolean" &&
        cents(account.openingBalance) &&
        isCivilDate(account.openingDate),
    );
  }
  for (const shift of finance.shifts) {
    const account = finance.accounts.find(
      (a) => a.id === shift.accountId && a.type === "cash",
    );
    requireValid(
      account &&
        text(shift.operator) &&
        isCivilDate(shift.openedOn) &&
        instant(shift.openedAt) &&
        shift.openedOn === financialDate(shift.openedAt) &&
        cents(shift.openingBalance) &&
        ["open", "closed"].includes(shift.status),
    );
    requireValid(shift.openedOn >= account.openingDate);
    if (shift.status === "closed") {
      requireValid(
        cents(shift.counted) &&
          cents(shift.expected) &&
          Number.isSafeInteger(shift.difference) &&
          shift.difference === shift.counted - shift.expected &&
          isCivilDate(shift.closedOn) &&
          instant(shift.closedAt) &&
          text(shift.closedBy),
      );
      requireValid(
        shift.closedOn >= shift.openedOn &&
          shift.closedOn === financialDate(shift.closedAt) &&
          Date.parse(shift.closedAt) >= Date.parse(shift.openedAt),
      );
    } else
      requireValid(
        finance.shifts.filter(
          (s) => s.accountId === account.id && s.status === "open",
        ).length === 1,
      );
  }
  const sources = new Set<string>();
  for (const agreement of finance.agreements) {
    requireValid(
      object(agreement.source) &&
        text(agreement.source.id) &&
        ["order", "sale"].includes(agreement.source.type),
    );
    const key = `${agreement.source.type}:${agreement.source.id}`;
    requireValid(!sources.has(key));
    sources.add(key);
    const source = financeSource(state, agreement.source);
    requireValid(
      text(agreement.sourceLabel) &&
        text(agreement.customerName) &&
        instant(agreement.createdAt),
    );
    requireValid(
      cents(agreement.commercialTotal) &&
        cents(agreement.legacyReceived) &&
        cents(agreement.principal) &&
        agreement.principal > 0 &&
        agreement.commercialTotal ===
          sum([agreement.principal, agreement.legacyReceived]),
    );
    requireValid(
      source.customerId === agreement.customerId &&
        source.commercialTotal === agreement.commercialTotal &&
        source.legacyReceived === agreement.legacyReceived,
    );
    const items = finance.installments.filter(
      (i) => i.agreementId === agreement.id,
    );
    requireValid(
      items.length > 0 &&
        sum(items.map((i) => i.amount)) === agreement.principal,
    );
    requireValid(items.filter((i) => i.kind === "down_payment").length <= 1);
    const normal = items
      .filter((i) => i.kind === "installment")
      .sort((a, b) => a.number - b.number);
    requireValid(
      normal.length <= 36 &&
        normal.every(
          (i, index) => i.number === index + 1 && i.count === normal.length,
        ),
    );
    const entry = items.find((i) => i.kind === "down_payment");
    requireValid(!entry || (entry.number === 0 && entry.count === 1));
    requireValid(
      normal.every(
        (i, index) =>
          i.due >= (index ? normal[index - 1].due : entry?.due || ""),
      ),
    );
  }
  for (const item of finance.installments) {
    requireValid(
      finance.agreements.some((a) => a.id === item.agreementId) &&
        ["down_payment", "installment"].includes(item.kind) &&
        cents(item.amount) &&
        item.amount > 0 &&
        isCivilDate(item.due) &&
        Number.isSafeInteger(item.number) &&
        Number.isSafeInteger(item.count),
    );
    requireValid(installmentBalance(state, item.id) >= 0);
  }
  requireValid(
    new Set(finance.payments.map((p) => p.idempotencyKey)).size ===
      finance.payments.length,
  );
  for (const payment of finance.payments) {
    const account = finance.accounts.find((a) => a.id === payment.accountId);
    requireValid(
      account &&
        text(payment.idempotencyKey) &&
        text(payment.requestFingerprint) &&
        cents(payment.amount) &&
        payment.amount > 0 &&
        Object.hasOwn(methodLabels, payment.method) &&
        isCivilDate(payment.receivedOn) &&
        text(payment.confirmedBy) &&
        typeof payment.reference === "string" &&
        cents(payment.tendered) &&
        cents(payment.change) &&
        instant(payment.createdAt),
    );
    requireValid(
      payment.receivedOn === financialDate(payment.createdAt) &&
        payment.receivedOn >= account.openingDate,
    );
    if (payment.method === "cash") {
      const shift = finance.shifts.find(
        (s) => s.id === payment.shiftId && s.accountId === account.id,
      );
      requireValid(
        account.type === "cash" &&
          shift &&
          shift.openedOn === payment.receivedOn &&
          Date.parse(payment.createdAt) >= Date.parse(shift.openedAt) &&
          payment.tendered - payment.change === payment.amount,
      );
      if (shift.closedAt)
        requireValid(
          Date.parse(payment.createdAt) <= Date.parse(shift.closedAt),
        );
    } else
      requireValid(
        account.type === "bank" &&
          !payment.shiftId &&
          text(payment.reference) &&
          payment.change === 0 &&
          payment.tendered === payment.amount,
      );
    const allocations = finance.allocations.filter(
      (a) => a.paymentId === payment.id,
    );
    const movements = finance.movements.filter(
      (m) => m.paymentId === payment.id,
    );
    requireValid(
      allocations.length === 1 &&
        movements.length === 1 &&
        allocations[0].amount === payment.amount &&
        movements[0].amount === payment.amount,
    );
    const item = finance.installments.find(
      (i) => i.id === allocations[0].installmentId,
    );
    requireValid(item);
    const agreement = finance.agreements.find((a) => a.id === item.agreementId);
    requireValid(agreement);
    const receipt = payment.receipt;
    requireValid(
      object(receipt) &&
        text(receipt.code) &&
        text(receipt.companyName) &&
        text(receipt.customerName) &&
        text(receipt.sourceLabel) &&
        text(receipt.installmentLabel),
    );
    requireValid(
      receipt.customerName === agreement?.customerName &&
        receipt.sourceLabel === agreement.sourceLabel &&
        receipt.amount === payment.amount &&
        cents(receipt.remaining) &&
        receipt.remaining <= item.amount - payment.amount &&
        receipt.method === payment.method &&
        receipt.receivedOn === payment.receivedOn &&
        receipt.confirmedBy === payment.confirmedBy &&
        receipt.tendered === payment.tendered &&
        receipt.change === payment.change &&
        receipt.reference === payment.reference &&
        receipt.due === item.due &&
        text(receipt.accountName),
    );
  }
  for (const allocation of finance.allocations)
    requireValid(
      finance.payments.some((p) => p.id === allocation.paymentId) &&
        finance.installments.some((i) => i.id === allocation.installmentId) &&
        cents(allocation.amount) &&
        allocation.amount > 0,
    );
  for (const movement of finance.movements) {
    const payment = finance.payments.find((p) => p.id === movement.paymentId);
    requireValid(
      payment &&
        movement.kind === "receipt" &&
        movement.accountId === payment.accountId &&
        movement.shiftId === payment.shiftId &&
        movement.amount === payment.amount &&
        movement.date === payment.receivedOn &&
        movement.createdAt === payment.createdAt,
    );
  }
  for (const shift of finance.shifts) {
    const movements = finance.movements.filter((m) => m.shiftId === shift.id);
    const expected = sum([
      shift.openingBalance,
      ...movements.map((m) => m.amount),
    ]);
    if (shift.status === "closed") requireValid(shift.expected === expected);
  }
  for (const account of finance.accounts)
    accountBalance(state, account.id, "9999-12-31");
  return structuredClone(finance);
}
