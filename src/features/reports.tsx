"use client";

import { useEffect, useState } from "react";
import { CircleAlert, Download } from "lucide-react";
import {
  EmptyState,
  Field,
  FormError,
  PageHeader,
  Panel,
} from "@/components/ui";
import { useFinancialDate } from "@/components/use-financial-date";
import { useDemo } from "@/lib/demo-store";
import { financialDate, methodLabels } from "@/lib/finance/engine";
import type { PaymentMethod } from "@/lib/finance/types";
import { buildReport, reportCellText, reportToCsv } from "@/lib/reports/engine";
import type {
  ReportColumn,
  ReportKind,
  ReportResult,
  ReportRow,
} from "@/lib/reports/types";

const reportLabels: Record<ReportKind, string> = {
  receipts: "Recebimentos",
  installments: "Parcelas",
  sales: "Vendas",
  orders: "Ordens de serviço",
};
const periodDescriptions: Record<ReportKind, string> = {
  receipts: "Data do recebimento. Cada pagamento é contado uma vez; o histórico antigo das OS fica separado.",
  installments: "Período de vencimento das parcelas. Os saldos e o atraso são calculados na data-base informada.",
  sales: "Data da venda, valor comercial e situação atual. Valor vendido não representa dinheiro recebido.",
  orders: "Data de criação da OS e situação atual da assistência. O período não reconstrói etapas ou recebimentos históricos.",
};
type ReportDates = { from: string; to: string; asOf: string };
type TotalItem = { label: string; value: number; note: string; count?: boolean };

function reportMoney(cents: number) {
  // O domínio valida centavos inteiros seguros; separar os dígitos evita
  // arredondar a fração ao converter valores grandes para reais.
  const digits = String(cents).padStart(3, "0");
  const reais = digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `R$\u00a0${reais},${digits.slice(-2)}`;
}

function totalItems(report: ReportResult): TotalItem[] {
  const totals = report.totals;
  switch (report.kind) {
    case "receipts":
      return [
        { label: "Recebido no período", value: totals.received, note: "Novos pagamentos, sem duplicar alocações ou movimentos." },
        { label: "Recebimentos", value: totals.count, count: true, note: "Pagamentos que correspondem aos filtros." },
      ];
    case "installments":
      return [
        { label: "Valor das parcelas", value: totals.principal, note: "Parcelas dos acordos existentes na data-base." },
        { label: "Pago até a data-base", value: totals.paid, note: "Sem antecipar recebimentos posteriores." },
        { label: "Em aberto na data-base", value: totals.balance, note: "Saldo das parcelas selecionadas." },
        { label: "Vencido na data-base", value: totals.overdue, note: "Vencimento anterior à data-base e saldo positivo." },
      ];
    case "sales":
      return [
        { label: "Valor comercial das vendas", value: totals.commercial, note: "Não representa dinheiro recebido." },
        { label: "Vendas na seleção", value: totals.count, count: true, note: "Situação atual das vendas no período." },
      ];
    case "orders":
      return [
        { label: "Valor comercial / orçado", value: totals.commercial, note: "Inclui orçamentos ainda sem aprovação." },
        { label: "Novos recebimentos identificados", value: totals.received, note: "Retrato atual das OS selecionadas." },
        { label: "Legado sem data", value: totals.legacy, note: "Histórico informado separado dos novos pagamentos." },
        { label: "Saldo elegível de OS aprovadas", value: totals.eligibleBalance, note: "Orçamentos sem aprovação não geram dívida confirmada." },
        { label: "Orçado sem aprovação", value: totals.unapproved, note: "Valor comercial ainda não confirmado pelo consumidor." },
        { label: "Registros para revisão", value: totals.reviewCount, count: true, note: "Inconsistências indicadas sem criar crédito." },
      ];
  }
}

function cellText(row: ReportRow, column: ReportColumn) {
  const value = row[column.key];
  if (column.format === "money" && typeof value === "number") return reportMoney(value);
  if (column.format === "date" && typeof value === "string") {
    const [year, month, day] = value.split("-");
    return `${day}/${month}/${year}`;
  }
  return reportCellText(row, column);
}

export function ReportsPage() {
  const { state, hydrated, storageAvailable } = useDemo();
  const today = useFinancialDate(state.finance);
  const [kind, setKind] = useState<ReportKind>("receipts");
  const [dates, setDates] = useState<ReportDates | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [method, setMethod] = useState<PaymentMethod | "">("");
  const [accountId, setAccountId] = useState("");
  const [exportError, setExportError] = useState("");

  useEffect(() => {
    if (!hydrated) return;
    const current = financialDate();
    setDates({ from: `${current.slice(0, 7)}-01`, to: current, asOf: current });
  }, [hydrated]);

  const updateDate = (key: keyof ReportDates, value: string) => {
    setDates((current) => current ? { ...current, [key]: value } : current);
    setExportError("");
  };

  let report: ReportResult | null = null;
  let filterError = "";
  if (hydrated && dates) {
    try {
      report = buildReport(state, {
        kind,
        from: dates.from,
        to: dates.to,
        asOf: kind === "installments" ? dates.asOf : today,
        customerId: customerId || undefined,
        method: kind === "receipts" ? method || undefined : undefined,
        accountId: kind === "receipts" ? accountId || undefined : undefined,
      });
    } catch (error) {
      filterError = error instanceof Error ? error.message : "Confira os filtros e tente novamente.";
    }
  }

  const download = () => {
    if (!report) return;
    try {
      const url = URL.createObjectURL(
        new Blob([reportToCsv(report)], { type: "text/csv;charset=utf-8" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `sistem-${report.kind}-${report.filters.from}-${report.filters.to}.csv`;
      try {
        anchor.click();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }
      setExportError("");
    } catch {
      setExportError("Não foi possível exportar o relatório. Os registros foram preservados; tente novamente.");
    }
  };

  return (
    <div className="report-page">
      <PageHeader
        eyebrow="GESTÃO DA LOJA"
        title="Relatórios"
        description="Consulte recebimentos, parcelas, vendas e OS usando os registros já disponíveis."
        action={
          <button
            type="button"
            className="button button-primary"
            onClick={download}
            disabled={!report}
          >
            <Download size={16} aria-hidden="true" />
            Exportar CSV
          </button>
        }
      />

      <div className="notice notice-info">
        <CircleAlert size={19} aria-hidden="true" />
        <div>
          <strong>Dados da loja neste navegador</strong>
          <p>
            Consultas e exportações não alteram saldos, recebimentos ou operações.
            Os valores são da demonstração local, sem conciliação bancária ou
            fluxo completo de caixa.
          </p>
        </div>
      </div>
      {!storageAvailable && (
        <div className="notice notice-warning" role="status">
          <CircleAlert size={19} aria-hidden="true" />
          <div>
            <strong>Os dados locais precisam de atenção.</strong>
            <p>
              O relatório usa apenas os registros que puderam ser abertos nesta
              sessão. Confira a recuperação nas Configurações antes de usar os
              totais para conferência.
            </p>
          </div>
        </div>
      )}

      <Panel title="Filtros do relatório" subtitle="A seleção atualiza as linhas, os totais e o arquivo CSV.">
        <div className="report-filters">
          <Field label="Tipo de relatório">
            <select
              value={kind}
              onChange={(event) => { setKind(event.target.value as ReportKind); setExportError(""); }}
            >
              {(Object.entries(reportLabels) as [ReportKind, string][]).map(([value, label]) => (
                <option value={value} key={value}>{label}</option>
              ))}
            </select>
          </Field>
          <Field label="Data inicial">
            <input type="date" value={dates?.from || ""} onChange={(event) => updateDate("from", event.target.value)} />
          </Field>
          <Field label="Data final">
            <input type="date" value={dates?.to || ""} onChange={(event) => updateDate("to", event.target.value)} />
          </Field>
          {kind === "installments" && (
            <Field label="Data-base">
              <input type="date" value={dates?.asOf || ""} onChange={(event) => updateDate("asOf", event.target.value)} />
            </Field>
          )}
          <Field label="Consumidor">
            <select
              value={customerId}
              onChange={(event) => { setCustomerId(event.target.value); setExportError(""); }}
            >
              <option value="">Todos os consumidores</option>
              {state.customers.map((customer) => (
                <option value={customer.id} key={customer.id}>{customer.name}</option>
              ))}
            </select>
          </Field>
          {kind === "receipts" && (
            <>
              <Field label="Meio">
                <select
                  value={method}
                  onChange={(event) => { setMethod(event.target.value as PaymentMethod | ""); setExportError(""); }}
                >
                  <option value="">Todos os meios</option>
                  {(Object.entries(methodLabels) as [PaymentMethod, string][]).map(([value, label]) => (
                    <option value={value} key={value}>{label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Conta">
                <select
                  value={accountId}
                  onChange={(event) => { setAccountId(event.target.value); setExportError(""); }}
                >
                  <option value="">Todas as contas</option>
                  {state.finance.accounts.map((account) => (
                    <option value={account.id} key={account.id}>{account.name}{account.active ? "" : " · inativa"}</option>
                  ))}
                </select>
              </Field>
            </>
          )}
        </div>
        <p className="report-period-note">{periodDescriptions[kind]}</p>
      </Panel>

      <FormError message={filterError || exportError} />

      {report && (
        <section className="report-totals" aria-label="Totais do relatório">
          {totalItems(report).map((item) => (
            <div className="report-total" key={item.label}>
              <span>{item.label}</span>
              <strong>{item.count ? item.value.toLocaleString("pt-BR") : reportMoney(item.value)}</strong>
              <small>{item.note}</small>
            </div>
          ))}
        </section>
      )}
      {report && report.warnings.length > 0 && (
        <div className="notice notice-warning">
          <CircleAlert size={19} aria-hidden="true" />
          <div>
            <strong>Como interpretar este relatório</strong>
            <ul className="report-warnings">
              {report.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
            </ul>
          </div>
        </div>
      )}

      <Panel title={reportLabels[kind]} subtitle="As linhas e a exportação respeitam os mesmos filtros.">
        {!hydrated || !dates ? (
          <p className="report-loading" role="status">Carregando registros locais…</p>
        ) : report && report.rows.length > 0 ? (
          <div
            className="report-table-scroll"
            role="region"
            aria-label="Linhas do relatório"
            tabIndex={0}
          >
            <table>
              <caption className="sr-only">{reportLabels[kind]} de {report.filters.from} até {report.filters.to}</caption>
              <thead>
                <tr>
                  {report.columns.map((column) => (
                    <th scope="col" key={column.key} className={column.format === "money" ? "report-money" : undefined}>{column.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.id}>
                    {report.columns.map((column) => (
                      <td key={column.key} className={column.format === "money" ? "report-money" : undefined}>{cellText(row, column)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : report ? (
          <EmptyState title="Nenhum registro nesta seleção" text="Altere o período ou os filtros para consultar outros registros. O CSV mantém os cabeçalhos quando a seleção está vazia." />
        ) : null}
        <div className="report-footer" aria-live="polite">
          <span>{report ? `${report.rows.length} registro${report.rows.length === 1 ? "" : "s"} na seleção` : filterError ? "Corrija os filtros para consultar." : "Preparando consulta…"}</span>
          <span>Eletrônica Central · demonstração local</span>
        </div>
      </Panel>
    </div>
  );
}
