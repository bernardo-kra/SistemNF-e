import type { DemoState } from "../src/lib/domain";
import { defaultFinance, prepareAgreement, recordPayment } from "../src/lib/finance/engine";
import { seed } from "../src/lib/seed";

// Fatos fictícios definidos pelos critérios REL: legado não possui conta/data.
export function reportsFixture(): DemoState {
  let state = structuredClone(seed);
  state.finance = defaultFinance();
  const order = state.orders.find((item) => item.id === "o1041")!;
  Object.assign(order, { parts: 60000, labor: 40000, received: 20000 });
  const sale = state.sales.find((item) => item.id === "s400")!;
  sale.total = 10001;
  sale.items = [{ productId: "p3", quantity: 1, unitPrice: 10001 }];
  state.finance.accounts.push({
    id: "bank-qa", name: "Banco alternativo fictício", type: "bank",
    active: true, openingBalance: 0, openingDate: "2026-10-16",
  });
  state = prepareAgreement(state, {
    source: { type: "order", id: "o1041" }, downPayment: 0,
    downPaymentDue: "2026-10-16", installmentCount: 2,
    firstDue: "2026-10-16", installmentDueDates: ["2026-10-16", "2026-10-17"],
  }, "report-order", "2026-10-16T12:00:00.000Z");
  const installmentId = state.finance.installments[0].id;
  for (const payment of [
    { id: "report-first", amount: 10000, at: "2026-10-16T12:30:00.000Z" },
    { id: "report-midnight", amount: 20000, at: "2026-10-17T01:30:00.000Z" },
  ]) {
    state = recordPayment(state, {
      installmentId, amount: payment.amount, method: "pix", accountId: "bank-demo",
      confirmedBy: "QA fictício", reference: "CRÉDITO FICTÍCIO",
      creditConfirmed: true, idempotencyKey: payment.id,
    }, payment.id, payment.at);
  }
  state = prepareAgreement(state, {
    source: { type: "sale", id: "s400" }, downPayment: 0,
    downPaymentDue: "2026-10-17", installmentCount: 1, firstDue: "2026-10-18",
  }, "report-sale", "2026-10-17T03:15:00.000Z");
  const saleInstallment = state.finance.installments.find((item) => item.agreementId === "report-sale")!;
  return recordPayment(state, {
    installmentId: saleInstallment.id, amount: 3334, method: "transfer", accountId: "bank-qa",
    confirmedBy: "QA fictício", reference: "OUTRO CRÉDITO FICTÍCIO",
    creditConfirmed: true, idempotencyKey: "report-other-customer",
  }, "report-other-customer", "2026-10-17T03:30:00.000Z");
}

export function parseReportsCsv(value: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === '"') {
      if (quoted && value[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ";" && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && value[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  if (quoted) throw new Error("CSV contém aspas sem fechamento.");
  return rows;
}
