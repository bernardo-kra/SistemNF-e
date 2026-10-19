import { expect, test } from "@playwright/test";
import { buildReport, reportToCsv } from "../src/lib/reports/engine";
import type { ReportFilters } from "../src/lib/reports/types";
import { recordPayment } from "../src/lib/finance/engine";
import { parseReportsCsv, reportsFixture } from "./reports-fixtures";

const filters = (changes: Partial<ReportFilters> = {}): ReportFilters => ({
  kind: "receipts", from: "2026-10-16", to: "2026-10-17", asOf: "2026-10-17", ...changes,
});

test("REL-01/02: recebimento é pagamento uma vez, por dia civil, sem legado/alocação/movimento duplicados", () => {
  const state = reportsFixture(), before = structuredClone(state);
  const report = buildReport(state, filters({ from: "2026-10-16", to: "2026-10-16" }));
  expect(report.rows.map((row) => row.id).sort()).toEqual(["report-first", "report-midnight"]);
  expect(report.rows.map((row) => row.date)).toEqual(["2026-10-16", "2026-10-16"]);
  expect(report.totals).toMatchObject({ count: 2, received: 30000 });
  expect(buildReport(state, filters()).totals.received).toBe(33334);
  expect(state).toEqual(before);
});

test("REL-03: saldo na data-base exclui acordo futuro e pagamento futuro, sem atrasar vencimento do próprio dia", () => {
  let state = reportsFixture();
  const first = state.finance.installments.find((item) => item.agreementId === "report-order" && item.due === "2026-10-16")!;
  state = recordPayment(state, {
    installmentId: first.id, amount: 10000, method: "pix", accountId: "bank-demo",
    confirmedBy: "QA", reference: "CRÉDITO FICTÍCIO FUTURO", creditConfirmed: true,
    idempotencyKey: "future-report",
  }, "future-report", "2026-10-18T12:00:00.000Z");
  const day16 = buildReport(state, filters({ kind: "installments", from: "2026-10-16", to: "2026-10-18", asOf: "2026-10-16" }));
  expect(day16.rows).toHaveLength(2);
  expect(day16.totals).toMatchObject({ principal: 80000, paid: 30000, balance: 50000, overdue: 0 });
  expect(day16.rows.find((row) => row.id === first.id)).toMatchObject({ amount: 40000, paid: 30000, balance: 10000, status: "open" });
  const day17 = buildReport(state, filters({ kind: "installments", from: "2026-10-16", to: "2026-10-18" }));
  expect(day17.totals).toMatchObject({ count: 3, principal: 90001, paid: 33334, balance: 56667, overdue: 10000 });
  expect(day17.rows.find((row) => row.date === "2026-10-17")).toMatchObject({ balance: 40000, status: "open" });
  expect(day17.rows.find((row) => row.id === first.id)).toMatchObject({ balance: 10000, status: "overdue" });
});

test("REL-04: consumidor, meio e conta restringem linhas e totais sem serem identidade da instalação", () => {
  const state = reportsFixture();
  const report = buildReport(state, filters({ customerId: "c3", method: "transfer", accountId: "bank-qa" }));
  expect(report.rows).toHaveLength(1);
  expect(report.rows[0]).toMatchObject({ id: "report-other-customer", customerId: "c3", amount: 3334, method: "transfer", accountId: "bank-qa" });
  expect(report.totals.received).toBe(3334);
  expect(buildReport(state, filters({ customerId: "c2", method: "transfer" })).totals.received).toBe(0);
  expect(buildReport(state, filters({ kind: "installments", from: "2026-10-16", to: "2026-10-18", customerId: "c2" })).totals.balance).toBe(50000);
});

test("REL-01/05: OS mantém fotografia atual, aprovação e legado separado; orçamento sem aprovação não é dívida", () => {
  const state = reportsFixture();
  const report = buildReport(state, filters({ kind: "orders", from: "2026-10-13", to: "2026-10-17" }));
  expect(report.rows.find((row) => row.id === "o1041")).toMatchObject({
    commercial: 100000, legacy: 20000, received: 30000, eligibleBalance: 50000, approved: true, status: "in_progress", review: false,
  });
  expect(report.rows.find((row) => row.id === "o1042")).toMatchObject({ approved: false, eligibleBalance: null, commercial: 46990, status: "awaiting_approval" });
  expect(report.warnings.join(" ")).toMatch(/atual/i);
  expect(report.warnings.join(" ")).toMatch(/legado|histórico informado/i);
  const beforeFinance = buildReport(state, filters({ kind: "orders", from: "2026-10-13", to: "2026-10-17", asOf: "2026-10-15" }));
  expect(beforeFinance.rows.find((row) => row.id === "o1041")).toMatchObject({ received: 30000, legacy: 20000, eligibleBalance: 50000 });
});

test("REL-05: saldo legado inconsistente indica revisão e não inventa crédito negativo", () => {
  const state = reportsFixture();
  const order = state.orders.find((item) => item.id === "o1040")!;
  order.received = 34001;
  const report = buildReport(state, filters({ kind: "orders", from: "2026-10-13", to: "2026-10-17" }));
  expect(report.rows.find((row) => row.id === "o1040")).toMatchObject({ commercial: 34000, legacy: 34001, eligibleBalance: 0, review: true });
  expect(report.totals.reviewCount).toBe(1);
});

test("REL-05: vendas mostram valor comercial e situação atual sem fabricar recebimentos", () => {
  const state = reportsFixture();
  const report = buildReport(state, filters({ kind: "sales", from: "2026-10-15", to: "2026-10-16" }));
  expect(report.rows.find((row) => row.id === "s400")).toMatchObject({ commercial: 10001, status: "delivered" });
  expect(report.totals).toMatchObject({ commercial: 329901, received: 0 });
});

test("REL-02: datas estritas/intervalo invertido e centavos inválidos são rejeitados sem mutação", () => {
  const state = reportsFixture(), before = structuredClone(state);
  for (const invalid of [
    { from: "2026-02-30" }, { to: "2026-2-01" }, { asOf: "2026-04-31" },
    { from: "2026-10-18", to: "2026-10-17" },
  ]) expect(() => buildReport(state, filters(invalid))).toThrow();
  for (const value of [0.5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    const bad = structuredClone(state);
    bad.sales[0].total = value;
    expect(() => buildReport(bad, filters({ kind: "sales", from: "2026-10-15", to: "2026-10-17" }))).toThrow();
  }
  const overflow = structuredClone(state);
  overflow.sales.forEach((sale) => { sale.total = Number.MAX_SAFE_INTEGER; });
  expect(() => buildReport(overflow, filters({ kind: "sales", from: "2026-10-15", to: "2026-10-17" }))).toThrow();
  expect(state).toEqual(before);
});

test("REL-06: filtros vazios retornam zero e CSV contém só linhas mostradas, metadados e escape seguro", () => {
  const state = reportsFixture();
  const empty = buildReport(state, filters({ from: "2026-11-01", to: "2026-11-02" }));
  expect(empty.rows).toEqual([]);
  expect(Object.values(empty.totals).every((value) => value === 0)).toBe(true);
  const customer = state.customers.find((item) => item.id === "c3")!;
  customer.name = '=HYPERLINK("https://exemplo.invalid";"x")\nlinha';
  const report = buildReport(state, filters({ kind: "sales", from: "2026-10-15", to: "2026-10-16", customerId: "c3" }));
  const csv = reportToCsv(report);
  const records = parseReportsCsv(csv);
  const headerIndex = records.findIndex((row) => JSON.stringify(row) === JSON.stringify(report.columns.map((column) => column.label)));
  expect(headerIndex).toBeGreaterThan(0);
  const data = records.slice(headerIndex + 1).filter((row) => row.some(Boolean));
  expect(data).toHaveLength(1);
  expect(data[0]).toContain(`'${customer.name}`);
  expect(csv).toContain('""https://exemplo.invalid""');
  expect(csv).toContain("2026-10-15");
  expect(csv).toContain("c3");
  expect(csv).not.toContain("Venda #401");
  for (const name of ["+SUM(1;2)", "-2+3", "@SUM(1)", " \t=1+1", "\t=1+1"]) {
    customer.name = name;
    const copy = buildReport(state, report.filters);
    const parsed = parseReportsCsv(reportToCsv(copy));
    expect(parsed.flat()).toContain(`'${name}`);
  }
});

test("REL-06: CSV conserva todos os centavos de um valor inteiro ainda dentro do limite seguro", () => {
  const state = reportsFixture();
  const sale = state.sales.find((item) => item.id === "s400")!;
  sale.total = 9007199254740990;
  const report = buildReport(state, filters({ kind: "sales", from: "2026-10-15", to: "2026-10-16", customerId: "c3" }));
  expect(report.totals.commercial).toBe(9007199254740990);
  const cells = parseReportsCsv(reportToCsv(report)).flat();
  expect(cells).toContain("90071992547409,90");
  expect(cells).not.toContain("90071992547409,91");
});
