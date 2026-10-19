import { stages, type DemoState } from "../domain";
import { financialDate, installmentBalance, isCivilDate, methodLabels } from "../finance/engine";
import type { FinanceSource, PaymentAgreement } from "../finance/types";
import type { ReportColumn, ReportFilters, ReportKind, ReportResult, ReportRow, ReportTotals } from "./types";

const reportLabels: Record<ReportKind, string> = {
  receipts: "Recebimentos", installments: "Parcelas", sales: "Vendas", orders: "Ordens de serviço",
};
function cents(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("O relatório exige valores inteiros de centavos não negativos.");
  return value;
}
function exactSum(values: number[]): number {
  return values.reduce((sum, value) => {
    const result = sum + cents(value);
    if (!Number.isSafeInteger(result)) throw new Error("A soma do relatório ultrapassa o limite seguro de centavos.");
    return result;
  }, 0);
}
function civil(value: string): string {
  if (isCivilDate(value)) return value;
  // Timestamp fields, when available, belong to the store's civil day, never the host time zone.
  return financialDate(value);
}
function normalizeFilters(filters: ReportFilters): ReportFilters {
  if (!Object.hasOwn(reportLabels, filters.kind)) throw new Error("Selecione um relatório válido.");
  for (const value of [filters.from, filters.to, filters.asOf]) {
    if (!isCivilDate(value)) throw new Error("Informe datas válidas no formato ano-mês-dia.");
  }
  if (filters.from > filters.to) throw new Error("A data inicial deve ser anterior ou igual à final.");
  const result: ReportFilters = { kind: filters.kind, from: filters.from, to: filters.to, asOf: filters.asOf };
  if (filters.customerId) result.customerId = filters.customerId;
  if (filters.kind === "receipts") {
    if (filters.method) {
      if (!Object.hasOwn(methodLabels, filters.method)) throw new Error("Meio de recebimento inválido.");
      result.method = filters.method;
    }
    if (filters.accountId) result.accountId = filters.accountId;
  }
  return result;
}
const text = (key: string, label: string): ReportColumn => ({ key, label, format: "text" });
const monetary = (key: string, label: string): ReportColumn => ({ key, label, format: "money" });
const dateColumn = (label: string): ReportColumn => ({ key: "date", label, format: "date" });
function columnsFor(kind: ReportKind): ReportColumn[] {
  const customer = text("customerName", "Consumidor");
  const origin = text("sourceLabel", "Origem");
  if (kind === "receipts") return [
    dateColumn("Recebido em"), text("id", "Identificador"), customer, origin,
    monetary("amount", "Recebido (R$)"), text("method", "Meio"), text("accountName", "Conta"),
  ];
  if (kind === "installments") return [
    dateColumn("Vencimento"), customer, origin, text("status", "Situação"),
    monetary("amount", "Valor (R$)"), monetary("paid", "Pago na base (R$)"), monetary("balance", "Saldo na base (R$)"),
  ];
  if (kind === "sales") return [dateColumn("Data da venda"), customer, origin, text("status", "Situação atual"), monetary("commercial", "Comercial (R$)")];
  return [
    dateColumn("Criação"), customer, origin, text("status", "Situação atual"), text("approved", "Aprovada"),
    monetary("commercial", "Comercial/orçado (R$)"), monetary("legacy", "Legado informado (R$)"),
    monetary("received", "Novos recebimentos (R$)"), monetary("eligibleBalance", "Saldo elegível (R$)"), text("review", "Revisão necessária"),
  ];
}
function zeroTotals(): ReportTotals {
  return { count: 0, received: 0, commercial: 0, legacy: 0, principal: 0, paid: 0,
    balance: 0, overdue: 0, eligibleBalance: 0, unapproved: 0, reviewCount: 0 };
}

export function buildReport(state: DemoState, filters: ReportFilters): ReportResult {
  const applied = normalizeFilters(filters);
  const totals = zeroTotals();
  const warnings: string[] = [];
  let rows: ReportRow[] = [];
  const inPeriod = (date: string) => date >= applied.from && date <= applied.to;
  const customerMatches = (customerId: string) => !applied.customerId || customerId === applied.customerId;
  const customerName = (customerId: string, fallback = "Consumidor não localizado") =>
    state.customers.find((customer) => customer.id === customerId)?.name ?? fallback;
  const sourceLabel = (source: FinanceSource): string => source.type === "order"
    ? `OS #${state.orders.find((order) => order.id === source.id)?.number ?? source.id}`
    : `Venda #${state.sales.find((sale) => sale.id === source.id)?.number ?? source.id}`;
  const agreements = new Map(state.finance.agreements.map((agreement) => [agreement.id, agreement]));
  const installments = new Map(state.finance.installments.map((item) => [item.id, item]));

  if (applied.kind === "receipts") {
    const seen = new Set<string>();
    for (const payment of state.finance.payments) {
      if (seen.has(payment.id)) continue;
      seen.add(payment.id);
      const date = civil(payment.receivedOn);
      if (!inPeriod(date) || (applied.method && payment.method !== applied.method) ||
        (applied.accountId && payment.accountId !== applied.accountId)) continue;
      const linked = new Map<string, PaymentAgreement>();
      for (const allocation of state.finance.allocations) {
        if (allocation.paymentId !== payment.id) continue;
        const item = installments.get(allocation.installmentId);
        const agreement = item && agreements.get(item.agreementId);
        if (agreement) linked.set(agreement.id, agreement);
      }
      const sources = [...linked.values()];
      if (applied.customerId && !sources.some((agreement) => customerMatches(agreement.customerId))) continue;
      if (!sources.length) throw new Error("Há um recebimento sem origem identificável; revise os dados antes de exportar.");
      const consumers = [...new Set(sources.map((agreement) => agreement.customerId))];
      if (consumers.length > 1) throw new Error("Recebimento com consumidores diferentes exige revisão antes do relatório.");
      const accountName = state.finance.accounts.find((account) => account.id === payment.accountId)?.name ?? payment.receipt.accountName;
      rows.push({ id: payment.id, date, customerId: consumers[0], customerName: customerName(consumers[0], sources[0].customerName),
        sourceLabel: [...new Set(sources.map((agreement) => agreement.sourceLabel || sourceLabel(agreement.source)))].join(" / "),
        amount: cents(payment.amount), method: payment.method, accountId: payment.accountId, accountName });
    }
    totals.received = exactSum(rows.map((row) => row.amount as number));
    warnings.push("Recebimentos registrados manualmente. Alocações e movimentos vinculados não são outras receitas; legado de OS não entra neste período.");
  } else if (applied.kind === "installments") {
    for (const item of state.finance.installments) {
      const date = civil(item.due);
      const agreement = agreements.get(item.agreementId);
      if (!agreement || financialDate(agreement.createdAt) > applied.asOf || !inPeriod(date) || !customerMatches(agreement.customerId)) continue;
      const amount = cents(item.amount);
      const balance = cents(installmentBalance(state, item.id, applied.asOf));
      const paid = cents(amount - balance);
      const status = balance === 0 ? "paid" : date < applied.asOf ? "overdue" : "open";
      rows.push({ id: item.id, date, customerId: agreement.customerId, customerName: customerName(agreement.customerId, agreement.customerName),
        sourceLabel: `${agreement.sourceLabel} · ${item.kind === "down_payment" ? "Entrada" : `Parcela ${item.number}/${item.count}`}`,
        amount, paid, balance, status });
    }
    totals.principal = exactSum(rows.map((row) => row.amount as number));
    totals.paid = exactSum(rows.map((row) => row.paid as number));
    totals.balance = exactSum(rows.map((row) => row.balance as number));
    totals.overdue = exactSum(rows.filter((row) => row.status === "overdue").map((row) => row.balance as number));
    warnings.push("Saldo calculado na data-base, incluindo somente acordos existentes e pagamentos registrados até essa data. Vencimento na própria base não é atraso.");
  } else if (applied.kind === "sales") {
    rows = state.sales.flatMap((sale) => {
      const date = civil(sale.date);
      if (!inPeriod(date) || !customerMatches(sale.customerId)) return [];
      return [{ id: sale.id, date, customerId: sale.customerId, customerName: customerName(sale.customerId),
        sourceLabel: `Venda #${sale.number}`, status: sale.status, commercial: cents(sale.total) }];
    });
    totals.commercial = exactSum(rows.map((row) => row.commercial as number));
    warnings.push("Valor comercial das vendas e situação atual. Total vendido não representa dinheiro recebido.");
  } else {
    const payments = new Set(state.finance.payments.map((payment) => payment.id));
    const amountsByOrder = new Map<string, number[]>();
    for (const allocation of state.finance.allocations) {
      const item = installments.get(allocation.installmentId);
      const agreement = item && agreements.get(item.agreementId);
      if (!agreement || agreement.source.type !== "order" || !payments.has(allocation.paymentId)) continue;
      const amounts = amountsByOrder.get(agreement.source.id) ?? [];
      amounts.push(cents(allocation.amount));
      amountsByOrder.set(agreement.source.id, amounts);
    }
    rows = state.orders.flatMap((order) => {
      const date = civil(order.created);
      if (!inPeriod(date) || !customerMatches(order.customerId)) return [];
      const commercial = exactSum([order.parts, order.labor]);
      const legacy = cents(order.received);
      const received = exactSum(amountsByOrder.get(order.id) ?? []);
      const totalReceived = exactSum([legacy, received]);
      const review = totalReceived > commercial || (!order.approved && received > 0);
      return [{ id: order.id, date, customerId: order.customerId, customerName: customerName(order.customerId),
        sourceLabel: `OS #${order.number}`, status: order.stage, approved: order.approved, commercial, legacy, received,
        eligibleBalance: order.approved ? Math.max(0, commercial - totalReceived) : null, review }];
    });
    totals.commercial = exactSum(rows.map((row) => row.commercial as number));
    totals.legacy = exactSum(rows.map((row) => row.legacy as number));
    totals.received = exactSum(rows.map((row) => row.received as number));
    totals.eligibleBalance = exactSum(rows.map((row) => (row.eligibleBalance as number | null) ?? 0));
    totals.unapproved = exactSum(rows.filter((row) => !row.approved).map((row) => row.commercial as number));
    totals.reviewCount = rows.filter((row) => row.review).length;
    warnings.push("Retrato atual das OS selecionadas por criação: aprovação, situação e novos recebimentos são atuais; a data-base não reconstrói etapas históricas.",
      "Legado é histórico informado sem data ou conta identificáveis. Permanece separado dos novos recebimentos; orçamento sem aprovação não é dívida confirmada.");
    if (totals.reviewCount) warnings.push("Há saldo inconsistente indicado para revisão. Não foi criado crédito negativo nem movimento financeiro.");
  }
  rows.sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.id.localeCompare(b.id));
  totals.count = rows.length;
  return { kind: applied.kind, filters: applied, columns: columnsFor(applied.kind), rows, totals, warnings };
}

export function reportCellText(row: ReportRow, column: ReportColumn): string {
  const value = row[column.key];
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (column.format === "money") {
    const digits = String(cents(value as number)).padStart(3, "0");
    return `${digits.slice(0, -2)},${digits.slice(-2)}`;
  }
  if (column.key === "method" && typeof value === "string" && Object.hasOwn(methodLabels, value)) return methodLabels[value as keyof typeof methodLabels];
  if (column.key === "status" && typeof value === "string") {
    if (Object.hasOwn(stages, value)) return stages[value as keyof typeof stages].label;
    const labels: Record<string, string> = { confirmed: "Confirmada", paid: "Quitada", overdue: "Vencida", open: "Em aberto" };
    if (Object.hasOwn(labels, value)) return labels[value];
  }
  return String(value);
}

function csvCell(value: string): string {
  const neutralized = /^[\s\u0000-\u001f]*[=+\-@]/.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${neutralized.replaceAll('"', '""')}"`;
}

export function reportToCsv(report: ReportResult): string {
  const filters = report.filters;
  const records: string[][] = [
    ["Relatório", reportLabels[report.kind]], ["De", filters.from], ["Até", filters.to], ["Data-base financeira", filters.asOf],
  ];
  if (filters.customerId) records.push(["Consumidor (identificador)", filters.customerId]);
  if (filters.method) records.push(["Meio", methodLabels[filters.method]]);
  if (filters.accountId) records.push(["Conta (identificador)", filters.accountId]);
  for (const warning of report.warnings) records.push(["Observação", warning]);
  records.push([], report.columns.map((column) => column.label));
  for (const row of report.rows) records.push(report.columns.map((column) => reportCellText(row, column)));
  return records.map((record) => record.map(csvCell).join(";")).join("\r\n");
}
