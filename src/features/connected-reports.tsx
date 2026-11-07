"use client";

import { useEffect, useRef, useState } from "react";
import { Field, PageHeader, Panel } from "@/components/ui";
import { AccessError, accessBase, accessDate, accessRequest } from "@/lib/access-api";
import { financialDate } from "@/lib/finance/engine";
import { csvRecords } from "@/lib/reports/csv";
import type { ReceiptFilters, ReceiptReport } from "../../shared/receipt-report";
import type { InstallmentFilters, InstallmentReport } from "../../shared/installment-report";
import { useWorkspace } from "./workspace-session";
import styles from "./connected-reports.module.css";

const methods = { cash: "Dinheiro", pix: "Pix", transfer: "Transferência" };
const statuses = { open: "Em aberto", overdue: "Vencida", paid: "Quitada" };
type ReportKind = "receipts" | "installments";
type ReportFilters = ReceiptFilters | InstallmentFilters;
type FinancialReport = ReceiptReport | InstallmentReport;
function isInstallments(report: FinancialReport): report is InstallmentReport { return "asOf" in report.filters; }
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

function ReportRows({ report }: { report: FinancialReport }) {
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
  const canRead = !!company?.permissions.includes("finance.read");
  const [filters, setFilters] = useState<ReportFilters | null>(null);
  const [report, setReport] = useState<FinancialReport | null>(null);
  const [loading, setLoading] = useState(false), [exporting, setExporting] = useState(false), [error, setError] = useState("");
  const alive = useRef(false), generation = useRef(0), reading = useRef<AbortController | null>(null), exportingRequest = useRef<AbortController | null>(null);
  const base = `${accessBase(session.tenant)}/reports/${kind}`;
  const dirty = !!report && !!filters && query(report.filters) !== query(filters);
  const installments = kind === "installments";

  function fail(reason: unknown) {
    setError(reason instanceof Error ? reason.message : "Não foi possível consultar o relatório.");
    if (reason instanceof AccessError && [401, 403].includes(reason.status)) session.handleError(reason);
  }
  async function load(selected: ReportFilters, offset = 0) {
    reading.current?.abort(); exportingRequest.current?.abort(); setExporting(false);
    const request = new AbortController(), tag = ++generation.current; reading.current = request;
    setLoading(true); setError(""); setReport(null);
    try {
      const response = await accessRequest<FinancialReport>(`${base}?${query(selected, offset)}`, { signal: request.signal });
      if (!alive.current || request.signal.aborted || tag !== generation.current) return;
      if (response.tenantId !== session.tenant || !Array.isArray(response.items) || isInstallments(response) !== installments) throw new AccessError(503);
      setFilters(response.filters); setReport(response);
    } catch (reason) { if (alive.current && !request.signal.aborted && tag === generation.current) fail(reason); }
    finally { if (alive.current && tag === generation.current) setLoading(false); }
  }
  useEffect(() => {
    alive.current = true;
    const timer = setTimeout(() => {
      if (!canRead) return;
      const today = financialDate(), dates = { from: `${today.slice(0, 7)}-01`, to: today, q: "" };
      const initial: ReportFilters = installments ? { ...dates, asOf: today, status: "all" } : { ...dates, method: "" };
      setFilters(initial); void load(initial);
    }, 0);
    return () => { clearTimeout(timer); alive.current = false; generation.current++; reading.current?.abort(); exportingRequest.current?.abort(); };
    // WorkspaceShell remounts the entire module whenever the identity/company/permissions change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead, session.tenant, kind]);

  function edit(patch: Partial<ReceiptFilters & InstallmentFilters>) {
    exportingRequest.current?.abort(); setExporting(false);
    setFilters(current => current ? { ...current, ...patch } : current);
  }
  async function download() {
    if (!report || dirty || loading || exporting) return;
    const request = new AbortController(), tag = generation.current; exportingRequest.current = request; setExporting(true); setError("");
    try {
      const data = await accessRequest<FinancialReport>(`${base}/export?${query(report.filters)}`, { signal: request.signal });
      if (!alive.current || request.signal.aborted || tag !== generation.current) return;
      if (data.tenantId !== session.tenant || !Array.isArray(data.items) || data.items.length !== data.totals.count || isInstallments(data) !== installments) throw new AccessError(503);
      const url = URL.createObjectURL(new Blob(["\uFEFF", isInstallments(data) ? installmentCsv(data) : receiptCsv(data)], { type: "text/csv;charset=utf-8" }));
      try {
        const anchor = document.createElement("a"); anchor.href = url;
        anchor.download = `sistem-${installments ? "parcelas" : "recebimentos"}-${data.filters.from}-${data.filters.to}.csv`; anchor.click();
      } finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
    } catch (reason) {
      if (alive.current && !request.signal.aborted && tag === generation.current) {
        if (reason instanceof AccessError && reason.status === 413) setError(`A seleção excede 10 mil ${installments ? "parcelas" : "recebimentos"}. Reduza o período ou refine a busca antes de exportar.`);
        else fail(reason);
      }
    } finally { if (alive.current && exportingRequest.current === request) setExporting(false); }
  }

  if (!canRead) return <p role="alert">Seu perfil não tem permissão para consultar relatórios financeiros.</p>;
  return <div className={`report-page ${styles.page}`}>
    <PageHeader eyebrow="RELATÓRIOS" title={installments ? "Parcelas da loja" : "Recebimentos da loja"} description={installments ? "Confira as parcelas e o saldo na data-base escolhida, sem antecipar pagamentos posteriores." : "Confira os pagamentos registrados pela empresa, sem repetir os lançamentos."}
      action={<button className="button button-primary" disabled={!report || dirty || loading || exporting} onClick={() => void download()}>{exporting ? "Exportando…" : "Exportar CSV"}</button>} />
    <p className="notice notice-info">{installments ? "Saldos de acordos e pagamentos registrados até o fim da data-base em Brasília. Vencimento no próprio dia ainda não é atraso. Estes valores não representam dinheiro em caixa ou conciliação bancária." : "Dados do banco da empresa. Valores vendidos e parcelas prometidas não são recebimentos. Pix e transferências refletem a conferência manual registrada; este relatório não é conciliação bancária."}</p>
    <Panel title={installments ? "Filtros de parcelas" : "Filtros de recebimentos"} subtitle={installments ? "Período de vencimento das parcelas. A busca usa o nome preservado no acordo." : "Data do pagamento no horário de Brasília. A busca usa o nome preservado no recibo."}>
      <form onSubmit={event => { event.preventDefault(); if (filters) void load(filters); }}>
        <div className="report-filters">
          <Field label="Tipo de relatório"><select aria-label="Tipo de relatório" value={kind} onChange={event => selectKind(event.target.value as ReportKind)}><option value="receipts">Recebimentos</option><option value="installments">Parcelas</option></select></Field>
          <Field label="Data inicial"><input aria-label="Data inicial" type="date" required disabled={!filters || loading} value={filters?.from ?? ""} onChange={event => edit({ from: event.target.value })} /></Field>
          <Field label="Data final"><input aria-label="Data final" type="date" required disabled={!filters || loading} value={filters?.to ?? ""} onChange={event => edit({ to: event.target.value })} /></Field>
          <Field label="Buscar cliente"><input aria-label="Buscar cliente" maxLength={120} disabled={!filters || loading} value={filters?.q ?? ""} onChange={event => edit({ q: event.target.value })} /></Field>
          {filters && "asOf" in filters ? <>
            <Field label="Data-base"><input aria-label="Data-base" type="date" required disabled={loading} value={filters.asOf} onChange={event => edit({ asOf: event.target.value })} /></Field>
            <Field label="Situação na data-base"><select aria-label="Situação na data-base" disabled={loading} value={filters.status} onChange={event => edit({ status: event.target.value as InstallmentFilters["status"] })}><option value="all">Todas</option>{Object.entries(statuses).map(([id, label]) => <option key={id} value={id}>{id === "open" ? "Em aberto (inclui vencidas)" : label}</option>)}</select></Field>
          </> : !installments && <Field label="Meio de pagamento"><select aria-label="Meio de pagamento" disabled={!filters || loading} value={filters && "method" in filters ? filters.method : ""} onChange={event => edit({ method: event.target.value as ReceiptFilters["method"] })}><option value="">Todos os meios</option>{Object.entries(methods).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>}
        </div>
        <button className="button button-secondary" disabled={!filters || loading} type="submit">Consultar</button>
        {dirty && <p role="status">Filtros alterados. Consulte para atualizar as linhas, os totais e a exportação.</p>}
      </form>
    </Panel>
    {error && <p role="alert" className="notice notice-warning">{error}</p>}
    {loading && <p role="status">Consultando {installments ? "parcelas" : "recebimentos"}…</p>}
    {report && <>
      <section className="report-totals" aria-label="Totais da seleção">
        {isInstallments(report) ? <>
          <div className="report-total"><span>Valor das parcelas</span><strong>{money(report.totals.principalCents)}</strong><small>Somente acordos existentes na data-base.</small></div>
          <div className="report-total"><span>Pago até a data-base</span><strong>{money(report.totals.paidCents)}</strong><small>Sem antecipar pagamentos posteriores.</small></div>
          <div className="report-total"><span>Saldo na data-base</span><strong>{money(report.totals.balanceCents)}</strong><small>Saldo de toda a seleção filtrada.</small></div>
          <div className="report-total"><span>Vencido na data-base</span><strong>{money(report.totals.overdueCents)}</strong><small>Vencimento anterior à data-base e saldo positivo.</small></div>
        </> : <>
          <div className="report-total"><span>Recebido no período</span><strong>{money(report.totals.amountCents)}</strong><small>Total de toda a seleção, sem duplicar parcelas.</small></div>
          <div className="report-total"><span>Recebimentos na seleção</span><strong>{report.totals.count.toLocaleString("pt-BR")}</strong><small>Cada pagamento é contado uma vez.</small></div>
        </>}
      </section>
      <Panel title={installments ? "Parcelas registradas" : "Pagamentos registrados"} subtitle={`Consulta gerada em ${accessDate(report.generatedAt)}. Nomes preservados no ${installments ? "acordo" : "recibo"}.`}>
        {!report.items.length ? <p>{installments ? "Nenhuma parcela nesta seleção." : "Nenhum recebimento nesta seleção."}</p> : <div className="report-table-scroll" role="region" aria-label={`Linhas de ${installments ? "parcelas" : "recebimentos"}`} tabIndex={0}><ReportRows report={report} /></div>}
        <div className={styles.pagination}>
          <span>{report.totals.count ? `${report.offset + 1}–${Math.min(report.offset + report.limit, report.totals.count)} de ${report.totals.count}` : "0 registros"}</span>
          <button className="button button-secondary" disabled={dirty || loading || !report.offset} onClick={() => void load(report.filters, Math.max(0, report.offset - report.limit))}>Página anterior</button>
          <button className="button button-secondary" disabled={dirty || loading || report.offset + report.limit >= report.totals.count} onClick={() => void load(report.filters, report.offset + report.limit)}>Próxima página</button>
        </div>
        <p className="report-period-note">O CSV inclui toda a seleção, até 10 mil {installments ? "parcelas" : "recebimentos"}, com os dados disponíveis no momento da exportação. Vendas e OS conectados terão relatórios próprios.</p>
      </Panel>
    </>}
  </div>;
}
