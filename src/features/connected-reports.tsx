"use client";

import { useEffect, useRef, useState } from "react";
import { Field, PageHeader, Panel } from "@/components/ui";
import { AccessError, accessBase, accessDate, accessRequest } from "@/lib/access-api";
import { financialDate } from "@/lib/finance/engine";
import { connectedStages as stages } from "@/lib/domain";
import { csvRecords } from "@/lib/reports/csv";
import type { ReceiptFilters, ReceiptReport } from "../../shared/receipt-report";
import type { InstallmentFilters, InstallmentReport } from "../../shared/installment-report";
import type { SaleFilters, SaleReport } from "../../shared/sale-report";
import type { OrderFilters, OrderReport } from "../../shared/order-report";
import { useWorkspace } from "./workspace-session";
import styles from "./connected-reports.module.css";

const methods = { cash: "Dinheiro", pix: "Pix", transfer: "Transferência" };
const statuses = { open: "Em aberto", overdue: "Vencida", paid: "Quitada" };
const saleStatuses = { confirmed: "Confirmada", delivered: "Entregue" };
const approvals = { all: "Todas", approved: "Aprovados", pending: "Sem aprovação" };
const labels = {
  receipts: {
    plural: "recebimentos", title: "Recebimentos da loja", source: "recibo", rows: "Pagamentos registrados", empty: "Nenhum recebimento nesta seleção.",
    description: "Confira os pagamentos registrados pela empresa, sem repetir os lançamentos.",
    help: "Data do pagamento no horário de Brasília. A busca usa o nome preservado no recibo.",
    notice: "Dados do banco da empresa. Valores vendidos e parcelas prometidas não são recebimentos. Pix e transferências refletem a conferência manual registrada; este relatório não é conciliação bancária.",
  },
  installments: {
    plural: "parcelas", title: "Parcelas da loja", source: "acordo", rows: "Parcelas registradas", empty: "Nenhuma parcela nesta seleção.",
    description: "Confira as parcelas e o saldo na data-base escolhida, sem antecipar pagamentos posteriores.",
    help: "Período de vencimento das parcelas. A busca usa o nome preservado no acordo.",
    notice: "Saldos de acordos e pagamentos registrados até o fim da data-base em Brasília. Vencimento no próprio dia ainda não é atraso. Estes valores não representam dinheiro em caixa ou conciliação bancária.",
  },
  sales: {
    plural: "vendas", title: "Vendas da loja", source: "registro da venda", rows: "Vendas registradas", empty: "Nenhuma venda nesta seleção.",
    description: "Confira os valores vendidos e os descontos, sem confundir venda com recebimento.",
    help: "Data de criação da venda no horário de Brasília. A busca usa o nome preservado na venda; a situação é a atual.",
    notice: "Valores vendidos não representam recebimentos, dinheiro em caixa ou emissão fiscal. A situação da venda é a atual, mesmo ao consultar períodos anteriores.",
  },
  orders: {
    plural: "ordens de serviço", title: "Ordens de serviço da loja", source: "registro da OS", rows: "Ordens de serviço registradas", empty: "Nenhuma ordem de serviço nesta seleção.",
    description: "Confira as etapas e os valores atuais de mão de obra, com aprovação separada de recebimento.",
    help: "Data de entrada da OS no horário de Brasília. Etapa, aprovação, técnico e valores refletem o registro atual da ordem.",
    notice: "Valores de mão de obra não representam recebimentos, dívida, caixa ou emissão fiscal. Peças não estão incluídas. Mesmo para entradas antigas, os valores e a etapa exibidos são os atuais. OS devolvidas sem reparo mantêm o valor proposto, sem indicar serviço executado ou previsão de recebimento.",
  },
};
type ReportKind = keyof typeof labels;
type ReportFilters = ReceiptFilters | InstallmentFilters | SaleFilters | OrderFilters;
type ConnectedReport = ReceiptReport | InstallmentReport | SaleReport | OrderReport;
function isInstallments(report: ConnectedReport): report is InstallmentReport { return "asOf" in report.filters; }
function isSales(report: ConnectedReport): report is SaleReport { return "status" in report.filters && !isInstallments(report); }
function isOrders(report: ConnectedReport): report is OrderReport { return "stage" in report.filters; }
function reportKind(report: ConnectedReport): ReportKind { return isInstallments(report) ? "installments" : isSales(report) ? "sales" : isOrders(report) ? "orders" : "receipts"; }
function decimal(cents: number) {
  const digits = String(cents).padStart(3, "0");
  return `${digits.slice(0, -2)},${digits.slice(-2)}`;
}
function money(cents: number) {
  const [whole, fraction] = decimal(cents).split(",");
  return `R$ ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${fraction}`;
}
function query(filters: ReportFilters, offset?: number) {
  const params = new URLSearchParams(filters);
  if (offset !== undefined) params.set("offset", String(offset));
  params.sort();
  return params.toString();
}
function receiptCsv(report: ReceiptReport): string {
  return csvRecords([
    ["Relatório", "Recebimentos"], ["De", report.filters.from], ["Até", report.filters.to],
    ["Busca pelo cliente no recibo", report.filters.q], ["Meio", report.filters.method ? methods[report.filters.method] : "Todos"],
    ["Gerado em", accessDate(report.generatedAt)], ["Recebimentos", String(report.totals.count)], ["Valor recebido", decimal(report.totals.amountCents)],
    ["Observação", "Pagamentos registrados; não representa conciliação bancária."], [],
    ["Identificador", "Data", "Instante UTC", "Cliente no recibo", "Meio", "Conta no recibo", "Responsável no recibo", "Valor recebido"],
    ...report.items.map(row => [row.id, row.date, row.at, row.customerName, methods[row.method], row.accountName, row.receivedByName, decimal(row.amountCents)]),
  ]);
}

function installmentCsv(report: InstallmentReport): string {
  return csvRecords([
    ["Relatório", "Parcelas"], ["Vencimentos de", report.filters.from], ["Vencimentos até", report.filters.to],
    ["Data-base", report.filters.asOf], ["Busca pelo cliente no acordo", report.filters.q],
    ["Situação na data-base", report.filters.status === "all" ? "Todas" : statuses[report.filters.status]],
    ["Gerado em", accessDate(report.generatedAt)], ["Parcelas", String(report.totals.count)],
    ["Valor das parcelas", decimal(report.totals.principalCents)], ["Pago até a data-base", decimal(report.totals.paidCents)],
    ["Saldo na data-base", decimal(report.totals.balanceCents)], ["Vencido na data-base", decimal(report.totals.overdueCents)],
    ["Observação", "Saldos de acordos e pagamentos registrados até o fim da data-base em Brasília; não representam caixa ou conciliação bancária."], [],
    ["Identificador", "Vencimento", "Cliente no acordo", "Origem", "Parcela", "Situação", "Valor", "Pago até a data-base", "Saldo", "Vencido"],
    ...report.items.map(row => [row.id, row.due, row.customerName, row.sourceLabel, row.kind === "down_payment" ? "Entrada" : `${row.number}/${row.count}`, statuses[row.status], decimal(row.amountCents), decimal(row.paidCents), decimal(row.balanceCents), decimal(row.overdueCents)]),
  ]);
}

function saleCsv(report: SaleReport): string {
  return csvRecords([
    ["Relatório", "Vendas"], ["Criação de", report.filters.from], ["Criação até", report.filters.to],
    ["Busca pelo cliente na venda", report.filters.q], ["Situação atual", report.filters.status === "all" ? "Todas" : saleStatuses[report.filters.status]],
    ["Gerado em", accessDate(report.generatedAt)], ["Vendas", String(report.totals.count)], ["Valor bruto", decimal(report.totals.grossCents)],
    ["Descontos", decimal(report.totals.discountCents)], ["Valor vendido", decimal(report.totals.totalCents)],
    ["Observação", "Valores comerciais não representam recebimentos, caixa ou emissão fiscal. Situação atual, não histórica."], [],
    ["Identificador", "Venda", "Data de criação", "Instante UTC", "Cliente na venda", "Situação atual", "Valor bruto", "Desconto", "Valor vendido"],
    ...report.items.map(row => [row.id, String(row.number), row.date, row.at, row.customerName, saleStatuses[row.status], decimal(row.grossCents), decimal(row.discountCents), decimal(row.totalCents)]),
  ]);
}

function orderCsv(report: OrderReport): string {
  return csvRecords([
    ["Relatório", "Ordens de serviço"], ["Entradas de", report.filters.from], ["Entradas até", report.filters.to],
    ["Busca pelo cliente na OS", report.filters.q], ["Etapa atual", report.filters.stage === "all" ? "Todas" : stages[report.filters.stage].label], ["Aprovação", approvals[report.filters.approval]],
    ["Gerado em", accessDate(report.generatedAt)], ["Ordens de serviço", String(report.totals.count)],
    ["Serviços registrados", decimal(report.totals.laborCents)], ["Serviços aprovados", decimal(report.totals.approvedCents)], ["Serviços sem aprovação", decimal(report.totals.unapprovedCents)],
    ["OS com orçamento pendente", String(report.totals.unpricedCount)],
    ["Observação", "Totais somam somente valores definidos; mão de obra vazia significa orçamento pendente. Valores atuais de mão de obra não representam recebimentos, dívida, caixa ou emissão fiscal. Peças não incluídas; etapa e aprovação atuais."], [],
    ["Identificador", "OS", "Data de entrada", "Instante UTC", "Cliente na OS", "Técnico na OS", "Equipamento", "Etapa atual", "Serviço aprovado", "Mão de obra"],
    ...report.items.map(row => [row.id, String(row.number), row.date, row.at, row.customerName, row.technicianName ?? "", row.equipment, stages[row.stage].label, row.approved ? "Sim" : "Não", row.laborCents === null ? "" : decimal(row.laborCents)]),
  ]);
}

function ReportRows({ report }: { report: ConnectedReport }) {
  if (isOrders(report)) return <table>
    <caption className="sr-only">OS com entrada de {report.filters.from} até {report.filters.to}, com etapa e valores atuais</caption>
    <thead><tr><th>Entrada</th><th>OS</th><th>Cliente</th><th>Equipamento</th><th>Técnico</th><th>Etapa atual</th><th>Serviço aprovado</th><th className="report-money">Mão de obra</th></tr></thead>
    <tbody>{report.items.map(row => <tr key={row.id}><td>{accessDate(row.at)}</td><td>{row.number}</td><td>{row.customerName}</td><td>{row.equipment}</td><td>{row.technicianName ?? "Técnico a definir"}</td><td>{stages[row.stage].label}</td><td>{row.approved ? "Sim" : "Não"}</td><td className="report-money">{row.laborCents === null ? "Orçamento pendente" : money(row.laborCents)}</td></tr>)}</tbody>
  </table>;
  if (isSales(report)) return <table>
    <caption className="sr-only">Vendas criadas de {report.filters.from} até {report.filters.to}, com situação atual</caption>
    <thead><tr><th>Criação</th><th>Venda</th><th>Cliente</th><th>Situação atual</th><th className="report-money">Bruto</th><th className="report-money">Desconto</th><th className="report-money">Valor vendido</th></tr></thead>
    <tbody>{report.items.map(row => <tr key={row.id}><td>{accessDate(row.at)}</td><td>{row.number}</td><td>{row.customerName}</td><td>{saleStatuses[row.status]}</td><td className="report-money">{money(row.grossCents)}</td><td className="report-money">{money(row.discountCents)}</td><td className="report-money">{money(row.totalCents)}</td></tr>)}</tbody>
  </table>;
  if (isInstallments(report)) return <table>
    <caption className="sr-only">Parcelas por vencimento de {report.filters.from} até {report.filters.to}, na data-base {report.filters.asOf}</caption>
    <thead><tr><th>Vencimento</th><th>Cliente</th><th>Origem</th><th>Parcela</th><th>Situação</th><th className="report-money">Valor</th><th className="report-money">Pago</th><th className="report-money">Saldo</th></tr></thead>
    <tbody>{report.items.map(row => <tr key={row.id}><td>{row.due.split("-").reverse().join("/")}</td><td>{row.customerName}</td><td>{row.sourceLabel}</td><td>{row.kind === "down_payment" ? "Entrada" : `${row.number}/${row.count}`}</td><td>{statuses[row.status]}</td><td className="report-money">{money(row.amountCents)}</td><td className="report-money">{money(row.paidCents)}</td><td className="report-money">{money(row.balanceCents)}</td></tr>)}</tbody>
  </table>;
  return <table>
    <caption className="sr-only">Recebimentos de {report.filters.from} até {report.filters.to}</caption>
    <thead><tr><th>Data e hora</th><th>Cliente</th><th>Meio</th><th>Conta</th><th>Responsável</th><th className="report-money">Valor recebido</th></tr></thead>
    <tbody>{report.items.map(row => <tr key={row.id}><td>{accessDate(row.at)}</td><td>{row.customerName}</td><td>{methods[row.method]}</td><td>{row.accountName}</td><td>{row.receivedByName}</td><td className="report-money">{money(row.amountCents)}</td></tr>)}</tbody>
  </table>;
}

export function ConnectedReports() {
  const [kind, setKind] = useState<ReportKind>("receipts");
  return <ReportContent key={kind} kind={kind} selectKind={setKind} />;
}

function ReportContent({ kind, selectKind }: { kind: ReportKind; selectKind: (kind: ReportKind) => void }) {
  const session = useWorkspace();
  const company = session.identity?.tenants.find(row => row.id === session.tenant);
  const canRead = !!company?.permissions.includes("finance.read") && (kind !== "sales" || company.permissions.includes("sales.read")) && (kind !== "orders" || company.permissions.includes("orders.read"));
  const [filters, setFilters] = useState<ReportFilters | null>(null);
  const [report, setReport] = useState<ConnectedReport | null>(null);
  const [loading, setLoading] = useState(false), [exporting, setExporting] = useState(false), [error, setError] = useState("");
  const alive = useRef(false), generation = useRef(0), reading = useRef<AbortController | null>(null), exportingRequest = useRef<AbortController | null>(null);
  const base = `${accessBase(session.tenant)}/reports/${kind}`;
  const dirty = !!report && !!filters && query(report.filters) !== query(filters);
  const installments = kind === "installments";
  const text = labels[kind];
  const selector = <Field label="Tipo de relatório"><select aria-label="Tipo de relatório" value={kind} onChange={event => selectKind(event.target.value as ReportKind)}><option value="receipts">Recebimentos</option><option value="installments">Parcelas</option><option value="sales">Vendas</option><option value="orders">Ordens de serviço</option></select></Field>;

  function fail(reason: unknown) {
    setError(reason instanceof Error ? reason.message : "Não foi possível consultar o relatório.");
    if (reason instanceof AccessError && [401, 403].includes(reason.status)) session.handleError(reason);
  }
  async function load(selected: ReportFilters, offset = 0) {
    reading.current?.abort(); exportingRequest.current?.abort(); setExporting(false);
    const request = new AbortController(), tag = ++generation.current; reading.current = request;
    setLoading(true); setError(""); setReport(null);
    try {
      const response = await accessRequest<ConnectedReport>(`${base}?${query(selected, offset)}`, { signal: request.signal });
      if (!alive.current || request.signal.aborted || tag !== generation.current) return;
      if (response.tenantId !== session.tenant || !Array.isArray(response.items) || reportKind(response) !== kind) throw new AccessError(503);
      setFilters(response.filters); setReport(response);
    } catch (reason) { if (alive.current && !request.signal.aborted && tag === generation.current) fail(reason); }
    finally { if (alive.current && tag === generation.current) setLoading(false); }
  }
  useEffect(() => {
    alive.current = true;
    const timer = setTimeout(() => {
      if (!canRead) return;
      const today = financialDate(), dates = { from: `${today.slice(0, 7)}-01`, to: today, q: "" };
      const initial: ReportFilters = installments ? { ...dates, asOf: today, status: "all" } : kind === "sales" ? { ...dates, status: "all" } : kind === "orders" ? { ...dates, stage: "all", approval: "all" } : { ...dates, method: "" };
      setFilters(initial); void load(initial);
    }, 0);
    return () => { clearTimeout(timer); alive.current = false; generation.current++; reading.current?.abort(); exportingRequest.current?.abort(); };
    // WorkspaceShell remounts the entire module whenever the identity/company/permissions change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead, session.tenant, kind]);

  function edit(patch: Partial<ReceiptFilters & Omit<InstallmentFilters, "status"> & OrderFilters> & { status?: InstallmentFilters["status"] | SaleFilters["status"] }) {
    exportingRequest.current?.abort(); setExporting(false);
    setFilters(current => {
      if (!current) return current;
      if ("asOf" in current) return { ...current, ...patch, status: patch.status === "all" || patch.status === "open" || patch.status === "overdue" || patch.status === "paid" ? patch.status : current.status };
      if ("status" in current) return { ...current, ...patch, status: patch.status === "all" || patch.status === "confirmed" || patch.status === "delivered" ? patch.status : current.status };
      return { ...current, ...patch };
    });
  }
  async function download() {
    if (!report || dirty || loading || exporting) return;
    const request = new AbortController(), tag = generation.current; exportingRequest.current = request; setExporting(true); setError("");
    try {
      const data = await accessRequest<ConnectedReport>(`${base}/export?${query(report.filters)}`, { signal: request.signal });
      if (!alive.current || request.signal.aborted || tag !== generation.current) return;
      if (data.tenantId !== session.tenant || !Array.isArray(data.items) || data.items.length !== data.totals.count || reportKind(data) !== kind) throw new AccessError(503);
      const url = URL.createObjectURL(new Blob(["\uFEFF", isInstallments(data) ? installmentCsv(data) : isSales(data) ? saleCsv(data) : isOrders(data) ? orderCsv(data) : receiptCsv(data)], { type: "text/csv;charset=utf-8" }));
      try {
        const anchor = document.createElement("a"); anchor.href = url;
        anchor.download = `sistem-${text.plural}-${data.filters.from}-${data.filters.to}.csv`; anchor.click();
      } finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
    } catch (reason) {
      if (alive.current && !request.signal.aborted && tag === generation.current) {
        if (reason instanceof AccessError && reason.status === 413) setError(`A seleção excede 10 mil ${text.plural}. Reduza o período ou refine a busca antes de exportar.`);
        else fail(reason);
      }
    } finally { if (alive.current && exportingRequest.current === request) setExporting(false); }
  }

  if (!canRead) return <div>{company?.permissions.includes("finance.read") && selector}<p role="alert">Seu perfil não tem permissão para consultar {kind === "sales" ? "relatórios de vendas" : kind === "orders" ? "relatórios de ordens de serviço" : "relatórios financeiros"}.</p></div>;
  return <div className={`report-page ${styles.page}`}>
    <PageHeader eyebrow="RELATÓRIOS" title={text.title} description={text.description}
      action={<button className="button button-primary" disabled={!report || dirty || loading || exporting} onClick={() => void download()}>{exporting ? "Exportando…" : "Exportar CSV"}</button>} />
    <p className="notice notice-info">{text.notice}</p>
    <Panel title={`Filtros de ${text.plural}`} subtitle={text.help}>
      <form onSubmit={event => { event.preventDefault(); if (filters) void load(filters); }}>
        <div className="report-filters">
          {selector}
          <Field label="Data inicial"><input aria-label="Data inicial" type="date" required disabled={!filters || loading} value={filters?.from ?? ""} onChange={event => edit({ from: event.target.value })} /></Field>
          <Field label="Data final"><input aria-label="Data final" type="date" required disabled={!filters || loading} value={filters?.to ?? ""} onChange={event => edit({ to: event.target.value })} /></Field>
          <Field label="Buscar cliente"><input aria-label="Buscar cliente" maxLength={120} disabled={!filters || loading} value={filters?.q ?? ""} onChange={event => edit({ q: event.target.value })} /></Field>
          {filters && "asOf" in filters ? <>
            <Field label="Data-base"><input aria-label="Data-base" type="date" required disabled={loading} value={filters.asOf} onChange={event => edit({ asOf: event.target.value })} /></Field>
            <Field label="Situação na data-base"><select aria-label="Situação na data-base" disabled={loading} value={filters.status} onChange={event => edit({ status: event.target.value as InstallmentFilters["status"] })}><option value="all">Todas</option>{Object.entries(statuses).map(([id, label]) => <option key={id} value={id}>{id === "open" ? "Em aberto (inclui vencidas)" : label}</option>)}</select></Field>
          </> : kind === "sales" ? <Field label="Situação atual"><select aria-label="Situação atual" disabled={!filters || loading} value={filters && "status" in filters ? filters.status : "all"} onChange={event => edit({ status: event.target.value as SaleFilters["status"] })}><option value="all">Todas</option>{Object.entries(saleStatuses).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field> : kind === "orders" ? <>
            <Field label="Etapa atual"><select aria-label="Etapa atual" disabled={!filters || loading} value={filters && "stage" in filters ? filters.stage : "all"} onChange={event => edit({ stage: event.target.value as OrderFilters["stage"] })}><option value="all">Todas</option>{Object.entries(stages).map(([id, stage]) => <option key={id} value={id}>{stage.label}</option>)}</select></Field>
            <Field label="Aprovação"><select aria-label="Aprovação" disabled={!filters || loading} value={filters && "approval" in filters ? filters.approval : "all"} onChange={event => edit({ approval: event.target.value as OrderFilters["approval"] })}>{Object.entries(approvals).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>
          </> : !installments && <Field label="Meio de pagamento"><select aria-label="Meio de pagamento" disabled={!filters || loading} value={filters && "method" in filters ? filters.method : ""} onChange={event => edit({ method: event.target.value as ReceiptFilters["method"] })}><option value="">Todos os meios</option>{Object.entries(methods).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>}
        </div>
        <button className="button button-secondary" disabled={!filters || loading} type="submit">Consultar</button>
        {dirty && <p role="status">Filtros alterados. Consulte para atualizar as linhas, os totais e a exportação.</p>}
      </form>
    </Panel>
    {error && <p role="alert" className="notice notice-warning">{error}</p>}
    {loading && <p role="status">Consultando {text.plural}…</p>}
    {report && <>
      <section className="report-totals" aria-label="Totais da seleção">
        {isInstallments(report) ? <>
          <div className="report-total"><span>Valor das parcelas</span><strong>{money(report.totals.principalCents)}</strong><small>Somente acordos existentes na data-base.</small></div>
          <div className="report-total"><span>Pago até a data-base</span><strong>{money(report.totals.paidCents)}</strong><small>Sem antecipar pagamentos posteriores.</small></div>
          <div className="report-total"><span>Saldo na data-base</span><strong>{money(report.totals.balanceCents)}</strong><small>Saldo de toda a seleção filtrada.</small></div>
          <div className="report-total"><span>Vencido na data-base</span><strong>{money(report.totals.overdueCents)}</strong><small>Vencimento anterior à data-base e saldo positivo.</small></div>
        </> : isSales(report) ? <>
          <div className="report-total"><span>Valor bruto</span><strong>{money(report.totals.grossCents)}</strong><small>Preços preservados na venda.</small></div>
          <div className="report-total"><span>Descontos</span><strong>{money(report.totals.discountCents)}</strong><small>Descontos concedidos nos produtos.</small></div>
          <div className="report-total"><span>Valor vendido</span><strong>{money(report.totals.totalCents)}</strong><small>Valor comercial após descontos; não é recebido.</small></div>
          <div className="report-total"><span>Vendas na seleção</span><strong>{report.totals.count.toLocaleString("pt-BR")}</strong><small>Cada venda é contada uma vez.</small></div>
        </> : isOrders(report) ? <>
          <div className="report-total"><span>Serviços registrados</span><strong>{money(report.totals.laborCents)}</strong><small>Mão de obra definida de toda a seleção.</small></div>
          <div className="report-total"><span>Serviços aprovados</span><strong>{money(report.totals.approvedCents)}</strong><small>Valor aprovado; não significa recebido ou dívida.</small></div>
          <div className="report-total"><span>Serviços sem aprovação</span><strong>{money(report.totals.unapprovedCents)}</strong><small>Valores ainda sem aprovação registrada.</small></div>
          <div className="report-total"><span>OS na seleção</span><strong>{report.totals.count.toLocaleString("pt-BR")}</strong><small>Cada ordem é contada uma vez.</small><small>{report.totals.unpricedCount} OS com orçamento pendente. Totais somam somente valores definidos.</small></div>
        </> : <>
          <div className="report-total"><span>Recebido no período</span><strong>{money(report.totals.amountCents)}</strong><small>Total de toda a seleção, sem duplicar parcelas.</small></div>
          <div className="report-total"><span>Recebimentos na seleção</span><strong>{report.totals.count.toLocaleString("pt-BR")}</strong><small>Cada pagamento é contado uma vez.</small></div>
        </>}
      </section>
      <Panel title={text.rows} subtitle={`Consulta gerada em ${accessDate(report.generatedAt)}. Nomes preservados no ${text.source}.`}>
        {!report.items.length ? <p>{text.empty}</p> : <div className="report-table-scroll" role="region" aria-label={`Linhas de ${text.plural}`} tabIndex={0}><ReportRows report={report} /></div>}
        <div className={styles.pagination}>
          <span>{report.totals.count ? `${report.offset + 1}–${Math.min(report.offset + report.limit, report.totals.count)} de ${report.totals.count}` : "0 registros"}</span>
          <button className="button button-secondary" disabled={dirty || loading || !report.offset} onClick={() => void load(report.filters, Math.max(0, report.offset - report.limit))}>Página anterior</button>
          <button className="button button-secondary" disabled={dirty || loading || report.offset + report.limit >= report.totals.count} onClick={() => void load(report.filters, report.offset + report.limit)}>Próxima página</button>
        </div>
        <p className="report-period-note">O CSV inclui toda a seleção, até 10 mil {text.plural}, com os dados disponíveis no momento da exportação.</p>
      </Panel>
    </>}
  </div>;
}
