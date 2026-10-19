"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  CircleAlert,
  ClipboardList,
  Clock3,
  Download,
  Landmark,
  Plus,
  ReceiptText,
  Wallet,
} from "lucide-react";
import {
  Badge,
  EmptyState,
  Field,
  FormError,
  Modal,
  PageHeader,
  Panel,
  SearchField,
} from "@/components/ui";
import { useDemo, uid } from "@/lib/demo-store";
import { dateLabel, matches, money } from "@/lib/domain";
import { useFinancialDate } from "@/components/use-financial-date";
import {
  accountBalance,
  financeSource,
  financeSummary,
  installmentBalance,
  installmentLabel,
  methodLabels,
  parseMoney,
  previewAgreement,
  sourceAgreement,
} from "@/lib/finance/engine";
import type {
  AgreementInput,
  CashShift,
  FinanceAccount,
  FinancePayment,
  FinanceSource,
  Installment,
  PaymentMethod,
} from "@/lib/finance/types";

type Tab = "sources" | "installments" | "accounts" | "receipts";
const sourceKey = (source: FinanceSource) => `${source.type}:${source.id}`;
const parseSource = (key: string): FinanceSource | null => {
  const [type, id] = key.split(":");
  return id && (type === "order" || type === "sale") ? { type, id } : null;
};
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Confira os dados e tente novamente.";
const amountInput = (cents: number) => (cents / 100).toFixed(2);
function clearSourceUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("source");
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}
function followingMonth(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month, 1, 12));
  const last = new Date(
    Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0, 12),
  ).getUTCDate();
  next.setUTCDate(Math.min(day, last));
  return next.toISOString().slice(0, 10);
}

export function FinancePage() {
  const { state, hydrated, storageAvailable } = useDemo();
  const [tab, setTab] = useState<Tab>("sources");
  const asOf = useFinancialDate(state.finance);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("open");
  const [agreementFilter, setAgreementFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [initialSource, setInitialSource] = useState<FinanceSource | null>(
    null,
  );
  const [receiving, setReceiving] = useState<string | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [shiftAction, setShiftAction] = useState<{
    account: FinanceAccount;
    shift?: CashShift;
  } | null>(null);
  const opened = useRef(false);
  const ready = hydrated && storageAvailable;
  useEffect(() => {
    if (!hydrated) return;
    if (opened.current) return;
    opened.current = true;
    const source = parseSource(
      new URLSearchParams(window.location.search).get("source") || "",
    );
    if (source) {
      const existing = sourceAgreement(state, source);
      if (existing) {
        setAgreementFilter(existing.id);
        setTab("installments");
        clearSourceUrl();
      } else {
        setInitialSource(source);
        setCreating(true);
      }
    }
  }, [hydrated]);
  const sourceIssues: {
    source: FinanceSource;
    label: string;
    message: string;
  }[] = [];
  const sources = [
    ...state.sales.map((s) => ({ type: "sale" as const, id: s.id })),
    ...state.orders
      .filter((o) => o.approved)
      .map((o) => ({ type: "order" as const, id: o.id })),
  ].flatMap((source) => {
    try {
      return [{ source, ...financeSource(state, source) }];
    } catch (error) {
      const label =
        source.type === "order"
          ? `OS #${state.orders.find((o) => o.id === source.id)?.number}`
          : `Venda #${state.sales.find((s) => s.id === source.id)?.number}`;
      sourceIssues.push({ source, label, message: errorText(error) });
      return [];
    }
  });
  const summary = financeSummary(state, asOf);
  const installments = state.finance.installments
    .filter((item) => {
      const agreement = state.finance.agreements.find(
        (a) => a.id === item.agreementId,
      );
      const balance = installmentBalance(state, item.id);
      return (
        !!agreement &&
        (!agreementFilter || agreement.id === agreementFilter) &&
        matches(
          `${agreement.sourceLabel} ${agreement.customerName} ${installmentLabel(item)}`,
          query,
        ) &&
        (filter === "all" ||
          (filter === "paid"
            ? balance === 0
            : filter === "overdue"
              ? balance > 0 && item.due < asOf
              : balance > 0))
      );
    })
    .sort((a, b) => a.due.localeCompare(b.due) || a.number - b.number);
  const receipt = state.finance.payments.find((p) => p.id === receiptId);
  const paymentItem = state.finance.installments.find(
    (i) => i.id === receiving,
  );
  const closeAgreement = () => {
    setCreating(false);
    clearSourceUrl();
  };
  const showInstallments = (id: string) => {
    setAgreementFilter(id);
    setFilter("all");
    setQuery("");
    setTab("installments");
    closeAgreement();
  };
  if (!hydrated)
    return (
      <>
        <PageHeader
          eyebrow="RECEBIMENTOS E COMPROMISSOS"
          title="Financeiro"
          description="Entrada, parcelas e recebimentos da loja e da assistência."
        />
        <p className="finance-loading" role="status">
          Recuperando os registros deste navegador…
        </p>
      </>
    );
  return (
    <>
      <PageHeader
        eyebrow="RECEBIMENTOS E COMPROMISSOS"
        title="Financeiro"
        description="Organize parcelas e registre recebimentos, preservando a origem de cada valor."
        action={
          <button
            className="button button-primary"
            disabled={!ready}
            onClick={() => {
              setInitialSource(null);
              setCreating(true);
            }}
          >
            <Plus size={17} />
            Criar acordo
          </button>
        }
      />
      <div className="notice notice-warning">
        <CircleAlert size={19} />
        <div>
          <strong>Controle demonstrativo de entradas</strong>
          <p>
            Use dados fictícios. Confirmações são manuais; contas começam em
            zero e mostram apenas os novos registros deste controle. Cartão,
            cheque, despesas e estornos ainda não estão disponíveis.
          </p>
        </div>
      </div>
      {!storageAvailable && (
        <div className="notice notice-warning" role="alert">
          <div>
            <strong>Gravação está bloqueada ou indisponível</strong>
            <p>
              As ações financeiras estão bloqueadas para proteger seus dados. Em
              Configurações, exporte o arquivo local original antes de restaurar
              exemplos.
            </p>
            <Link className="text-link" href="/configuracoes/">
              Abrir configurações
              <ArrowUpRight size={14} />
            </Link>
          </div>
        </div>
      )}
      <div className="finance-meta">
        <CalendarDays size={15} />
        <span>
          Data-base financeira: {dateLabel(asOf)} · {asOf.slice(0, 4)} ·
          America/Sao_Paulo
        </span>
        <span>
          Histórico informado nas OS: {money(summary.legacy)} · fora do saldo
          das contas
        </span>
      </div>
      <section className="finance-stats" aria-label="Resumo financeiro">
        <div className="finance-stat">
          <span>
            <ArrowDownLeft size={16} />
            Novos recebimentos
          </span>
          <strong>{money(summary.received)}</strong>
          <small>Registros deste controle até a data-base</small>
        </div>
        <div className="finance-stat">
          <span>
            <Wallet size={16} />
            Em aberto nas parcelas
          </span>
          <strong>{money(summary.open)}</strong>
          <small>Acordos confirmados · saldo pendente</small>
        </div>
        <div className="finance-stat">
          <span>
            <Clock3 size={16} />
            Parcelas vencidas
          </span>
          <strong>{money(summary.overdue)}</strong>
          <small>Saldo em atraso · recebimento incerto</small>
        </div>
        <div className="finance-stat">
          <span>
            <CalendarDays size={16} />
            Entradas previstas
          </span>
          <strong>{money(summary.future)}</strong>
          <small>Pendentes na data-base e adiante</small>
        </div>
      </section>
      <div
        className="finance-tabs"
        role="tablist"
        aria-label="Áreas do financeiro"
      >
        {(
          [
            { id: "sources", label: "Operações", icon: ClipboardList },
            { id: "installments", label: "Parcelas", icon: CalendarDays },
            { id: "accounts", label: "Caixa e contas", icon: Landmark },
            { id: "receipts", label: "Recebimentos", icon: ReceiptText },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            role="tab"
            tabIndex={tab === item.id ? 0 : -1}
            aria-selected={tab === item.id}
            aria-controls={`finance-${item.id}`}
            id={`finance-tab-${item.id}`}
            onKeyDown={(event) => {
              const ids: Tab[] = [
                "sources",
                "installments",
                "accounts",
                "receipts",
              ];
              const index = ids.indexOf(item.id);
              const next =
                event.key === "ArrowRight"
                  ? ids[(index + 1) % ids.length]
                  : event.key === "ArrowLeft"
                    ? ids[(index + ids.length - 1) % ids.length]
                    : event.key === "Home"
                      ? ids[0]
                      : event.key === "End"
                        ? ids[ids.length - 1]
                        : null;
              if (!next) return;
              event.preventDefault();
              setTab(next);
              setQuery("");
              document.getElementById(`finance-tab-${next}`)?.focus();
            }}
            onClick={() => {
              setTab(item.id);
              setQuery("");
            }}
          >
            <item.icon size={16} />
            {item.label}
          </button>
        ))}
      </div>
      {tab === "sources" && (
        <section
          id="finance-sources"
          role="tabpanel"
          aria-labelledby="finance-tab-sources"
        >
          <div className="finance-source-heading">
            <div>
              <h2>Vendas e OS aprovadas</h2>
              <p className="finance-note">
                Defina o vencimento financeiro. A previsão de entrega da OS não
                é o vencimento da cobrança.
              </p>
            </div>
            <SearchField
              value={query}
              onChange={setQuery}
              label="Buscar operação financeira"
              placeholder="Cliente, venda ou OS…"
            />
          </div>
          {sourceIssues.length > 0 && (
            <div className="notice notice-warning">
              <div>
                <strong>
                  Operações que precisam de revisão: {sourceIssues.length}
                </strong>
                <p>
                  Os registros foram preservados. Confira os dados de origem
                  antes de organizar a cobrança.
                </p>
                <ul className="fiscal-issue-links">
                  {sourceIssues.map((issue) => (
                    <li key={sourceKey(issue.source)}>
                      <button
                        className="text-link"
                        onClick={() => {
                          setInitialSource(issue.source);
                          setCreating(true);
                        }}
                      >
                        {issue.label}: {issue.message}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          <div className="finance-source-list">
            {sources
              .filter((s) =>
                matches(`${s.sourceLabel} ${s.customerName}`, query),
              )
              .map((item) => {
                const agreement = sourceAgreement(state, item.source);
                return (
                  <article
                    className="finance-source-card"
                    key={sourceKey(item.source)}
                  >
                    <div>
                      <h3>{item.sourceLabel}</h3>
                      <p>{item.customerName}</p>
                      <small>
                        Total comercial {money(item.commercialTotal)}
                        {item.legacyReceived > 0
                          ? ` · histórico informado ${money(item.legacyReceived)}`
                          : ""}
                      </small>
                    </div>
                    <div className="finance-source-value">
                      {money(item.principal)}
                      <small>
                        {agreement
                          ? "Saldo original do acordo"
                          : "Saldo a organizar em parcelas"}
                      </small>
                    </div>
                    {agreement ? (
                      <button
                        className="button button-secondary button-small"
                        onClick={() => showInstallments(agreement.id)}
                      >
                        Ver parcelas
                        <ArrowUpRight size={14} />
                      </button>
                    ) : item.principal > 0 ? (
                      <button
                        className="button button-secondary button-small"
                        disabled={!ready}
                        aria-label={`Definir parcelas de ${item.sourceLabel}`}
                        onClick={() => {
                          setInitialSource(item.source);
                          setCreating(true);
                        }}
                      >
                        Definir parcelas
                      </button>
                    ) : (
                      <Badge tone="neutral">Quitado no histórico</Badge>
                    )}
                  </article>
                );
              })}
          </div>
          {!sources.filter((s) =>
            matches(`${s.sourceLabel} ${s.customerName}`, query),
          ).length && (
            <EmptyState
              title="Nenhuma operação nesta seleção"
              text="Vendas confirmadas e OS aprovadas com valor aparecem aqui."
            />
          )}
        </section>
      )}
      {tab === "installments" && (
        <section
          id="finance-installments"
          role="tabpanel"
          aria-labelledby="finance-tab-installments"
        >
          <section className="panel">
            <div className="list-toolbar">
              <SearchField
                value={query}
                onChange={setQuery}
                label="Buscar parcelas"
                placeholder="Cliente, origem ou parcela…"
              />
              <div className="finance-section-actions">
                <label className="field finance-filter">
                  <span className="sr-only">Situação das parcelas</span>
                  <select
                    aria-label="Situação das parcelas"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="open">Em aberto</option>
                    <option value="overdue">Vencidas</option>
                    <option value="paid">Quitadas</option>
                    <option value="all">Todas as parcelas</option>
                  </select>
                </label>
                {agreementFilter && (
                  <button
                    className="text-link"
                    onClick={() => setAgreementFilter("")}
                  >
                    Mostrar todas as origens
                  </button>
                )}
              </div>
            </div>
            {installments.length ? (
              <div className="table-scroll">
                <table className="finance-installments-table">
                  <thead>
                    <tr>
                      <th>PARCELA / ORIGEM</th>
                      <th>CLIENTE</th>
                      <th>VENCIMENTO</th>
                      <th className="number">ORIGINAL</th>
                      <th className="number">APLICADO</th>
                      <th className="number">SALDO</th>
                      <th>SITUAÇÃO</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {installments.map((item) => {
                      const agreement = state.finance.agreements.find(
                        (a) => a.id === item.agreementId,
                      )!;
                      const balance = installmentBalance(state, item.id);
                      const late = balance > 0 && item.due < asOf;
                      return (
                        <tr key={item.id}>
                          <td data-label="Parcela / origem">
                            <div className="stack-cell">
                              <strong>{installmentLabel(item)}</strong>
                              <small>{agreement.sourceLabel}</small>
                            </div>
                          </td>
                          <td data-label="Cliente">{agreement.customerName}</td>
                          <td data-label="Vencimento">
                            {dateLabel(item.due)}
                            <small
                              className={`finance-date-year ${late ? "finance-overdue" : "muted"}`}
                            >
                              {item.due.slice(0, 4)}
                              {late ? " · em atraso" : ""}
                            </small>
                          </td>
                          <td data-label="Original" className="number">
                            {money(item.amount)}
                          </td>
                          <td data-label="Aplicado" className="number muted">
                            {money(item.amount - balance)}
                          </td>
                          <td data-label="Saldo" className="number strong">
                            {money(balance)}
                          </td>
                          <td data-label="Situação">
                            <Badge
                              tone={
                                !balance
                                  ? "success"
                                  : late
                                    ? "danger"
                                    : balance < item.amount
                                      ? "info"
                                      : "warning"
                              }
                            >
                              {!balance
                                ? "Quitada"
                                : late
                                  ? "Vencida"
                                  : balance < item.amount
                                    ? "Parcial"
                                    : "Em aberto"}
                            </Badge>
                          </td>
                          <td>
                            {balance > 0 && (
                              <button
                                className="button button-small button-secondary"
                                disabled={!ready}
                                aria-label={`Receber ${installmentLabel(item)} de ${agreement.sourceLabel}`}
                                onClick={() => setReceiving(item.id)}
                              >
                                Receber
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title="Nenhuma parcela nesta seleção"
                text="Confirme um acordo em Operações ou altere o filtro."
                action={
                  <button
                    className="button button-secondary"
                    onClick={() => setTab("sources")}
                  >
                    Ver operações
                  </button>
                }
              />
            )}
          </section>
          <p className="finance-note">
            Previsão parcial de entradas: não inclui despesas ou operações ainda
            sem acordo. Valores vencidos permanecem destacados e não são
            tratados como entrada garantida hoje.
          </p>
        </section>
      )}
      {tab === "accounts" && (
        <section
          id="finance-accounts"
          role="tabpanel"
          aria-labelledby="finance-tab-accounts"
        >
          <div className="finance-source-heading">
            <div>
              <h2>Saldo deste controle: {money(summary.available)}</h2>
              <p className="finance-note">
                As contas fictícias começam em zero. Não representam o saldo
                real da loja nem incluem recebimentos antigos das OS.
              </p>
            </div>
          </div>
          <div className="finance-accounts">
            {state.finance.accounts.map((account) => {
              const shift = state.finance.shifts.find(
                (s) => s.accountId === account.id && s.status === "open",
              );
              const previous = state.finance.shifts.find(
                (s) => s.accountId === account.id && s.status === "closed",
              );
              return (
                <Panel
                  key={account.id}
                  title={account.name}
                  subtitle={
                    account.type === "cash"
                      ? "Espécie · turno do operador"
                      : "Créditos conferidos manualmente"
                  }
                >
                  <div className="finance-account-body">
                    <Badge
                      tone={
                        account.type === "cash"
                          ? shift
                            ? "success"
                            : "neutral"
                          : "info"
                      }
                    >
                      {account.type === "cash"
                        ? shift
                          ? "Caixa aberto"
                          : "Caixa fechado"
                        : "Sem integração bancária"}
                    </Badge>
                    <div className="finance-account-balance">
                      {money(accountBalance(state, account.id, asOf))}
                    </div>
                    <p className="muted">
                      Saldo inicial do controle: {money(account.openingBalance)}
                    </p>
                    {shift && (
                      <p className="finance-note">
                        Operador: {shift.operator} · abertura em{" "}
                        {dateLabel(shift.openedOn)},{" "}
                        {shift.openedOn.slice(0, 4)}. Pagamentos em dinheiro
                        exigem turno do mesmo dia.
                      </p>
                    )}
                    {previous && previous.difference !== 0 && (
                      <div className="notice notice-warning">
                        <div>
                          <strong>
                            Diferença no último fechamento:{" "}
                            {money(previous.difference || 0)}
                          </strong>
                          <p>
                            A contagem foi preservada. Nenhum ajuste de saldo
                            foi realizado.
                          </p>
                        </div>
                      </div>
                    )}
                    {account.type === "cash" && (
                      <button
                        className="button button-secondary"
                        disabled={!ready}
                        onClick={() => setShiftAction({ account, shift })}
                      >
                        {shift ? "Fechar caixa" : "Abrir caixa"}
                      </button>
                    )}
                  </div>
                </Panel>
              );
            })}
          </div>
          <Panel
            title="Movimentos de entrada"
            subtitle="Somente recebimentos novos; abertura e fechamento não criam receita."
          >
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>DATA</th>
                    <th>CONTA</th>
                    <th>RECIBO / MEIO</th>
                    <th className="number">ENTRADA</th>
                  </tr>
                </thead>
                <tbody>
                  {state.finance.movements
                    .filter((m) => m.date <= asOf)
                    .map((movement) => {
                      const payment = state.finance.payments.find(
                        (p) => p.id === movement.paymentId,
                      );
                      return (
                        <tr key={movement.id}>
                          <td>
                            {dateLabel(movement.date)} ·{" "}
                            {movement.date.slice(0, 4)}
                          </td>
                          <td>
                            {
                              state.finance.accounts.find(
                                (a) => a.id === movement.accountId,
                              )?.name
                            }
                          </td>
                          <td>
                            <div className="stack-cell">
                              <strong>{payment?.receipt.code}</strong>
                              <small>
                                {payment && methodLabels[payment.method]}
                              </small>
                            </div>
                          </td>
                          <td className="number strong">
                            {money(movement.amount)}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            {!state.finance.movements.length && (
              <EmptyState
                title="Nenhum movimento novo"
                text="Recebimentos confirmados aparecerão aqui. O histórico antigo das OS não foi convertido em caixa."
              />
            )}
          </Panel>
          <div className="finance-service-panel">
            <Panel
              title="Fechamentos registrados"
              subtitle="Esperado e contado ficam preservados, inclusive quando há diferença."
            >
              {state.finance.shifts.some((s) => s.status === "closed") ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>OPERADOR</th>
                        <th>FECHAMENTO</th>
                        <th className="number">ESPERADO</th>
                        <th className="number">CONTADO</th>
                        <th className="number">DIFERENÇA</th>
                        <th>CONFERIDO POR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.finance.shifts
                        .filter((s) => s.status === "closed")
                        .map((shift) => (
                          <tr key={shift.id}>
                            <td>{shift.operator}</td>
                            <td>
                              {dateLabel(shift.closedOn!)} ·{" "}
                              {shift.closedOn!.slice(0, 4)}
                            </td>
                            <td className="number">
                              {money(shift.expected || 0)}
                            </td>
                            <td className="number">
                              {money(shift.counted || 0)}
                            </td>
                            <td className="number">
                              <Badge
                                tone={shift.difference ? "warning" : "success"}
                              >
                                {money(shift.difference || 0)}
                              </Badge>
                            </td>
                            <td>{shift.closedBy}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  title="Nenhum fechamento registrado"
                  text="Abra o caixa para registrar recebimentos em espécie e confira a contagem ao encerrar."
                />
              )}
            </Panel>
          </div>
        </section>
      )}
      {tab === "receipts" && (
        <section
          id="finance-receipts"
          role="tabpanel"
          aria-labelledby="finance-tab-receipts"
        >
          <Panel
            title="Recebimentos registrados"
            subtitle="Abra ou baixe um recibo existente sem repetir a baixa."
          >
            {state.finance.payments.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>RECIBO / DATA</th>
                      <th>CLIENTE / ORIGEM</th>
                      <th>MEIO</th>
                      <th className="number">VALOR</th>
                      <th>CONFERIDO POR</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {state.finance.payments.map((payment) => (
                      <tr key={payment.id}>
                        <td>
                          <div className="stack-cell">
                            <strong>{payment.receipt.code}</strong>
                            <small>
                              {dateLabel(payment.receivedOn)} ·{" "}
                              {payment.receivedOn.slice(0, 4)}
                            </small>
                          </div>
                        </td>
                        <td>
                          <div className="stack-cell">
                            <strong>{payment.receipt.customerName}</strong>
                            <small>
                              {payment.receipt.sourceLabel} ·{" "}
                              {payment.receipt.installmentLabel}
                            </small>
                          </div>
                        </td>
                        <td>{methodLabels[payment.method]}</td>
                        <td className="number strong">
                          {money(payment.amount)}
                        </td>
                        <td>{payment.confirmedBy}</td>
                        <td>
                          <button
                            className="button button-small button-secondary"
                            aria-label={`Abrir recibo ${payment.receipt.code}`}
                            onClick={() => setReceiptId(payment.id)}
                          >
                            Ver recibo
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title="Nenhum recebimento novo"
                text="Os valores antigos informados nas OS permanecem no histórico e não geram recibos fictícios."
              />
            )}
          </Panel>
        </section>
      )}
      {creating && (
        <AgreementModal
          initialSource={initialSource}
          asOf={asOf}
          onClose={closeAgreement}
          onCreated={showInstallments}
        />
      )}
      {paymentItem && (
        <PaymentModal
          key={paymentItem.id}
          item={paymentItem}
          asOf={asOf}
          onClose={() => setReceiving(null)}
          onReceived={(id) => {
            setReceiving(null);
            setReceiptId(id);
          }}
        />
      )}
      {receipt && (
        <ReceiptModal payment={receipt} onClose={() => setReceiptId(null)} />
      )}
      {shiftAction && (
        <ShiftModal
          account={shiftAction.account}
          shift={shiftAction.shift}
          onClose={() => setShiftAction(null)}
        />
      )}
    </>
  );
}

function AgreementModal({
  initialSource,
  asOf,
  onClose,
  onCreated,
}: {
  initialSource: FinanceSource | null;
  asOf: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { state, createPaymentAgreement } = useDemo();
  const [key, setKey] = useState(initialSource ? sourceKey(initialSource) : "");
  const [down, setDown] = useState("0.00");
  const [downDue, setDownDue] = useState(asOf);
  const [count, setCount] = useState(1);
  const [firstDue, setFirstDue] = useState(followingMonth(asOf));
  const [customDates, setCustomDates] = useState<string[]>([]);
  const [error, setError] = useState("");
  const source = parseSource(key);
  const existing = source && sourceAgreement(state, source);
  let origin: ReturnType<typeof financeSource> | null = null;
  let preview: ReturnType<typeof previewAgreement> | null = null;
  let input: AgreementInput | null = null;
  let validation = "";
  try {
    if (source) {
      origin = financeSource(state, source);
      input = {
        source,
        downPayment: parseMoney(down),
        downPaymentDue: downDue,
        installmentCount: count,
        firstDue,
      };
      preview = previewAgreement(state, input);
      if (customDates.length) {
        input = { ...input, installmentDueDates: customDates };
        previewAgreement(state, input);
      }
    }
  } catch (err) {
    validation = errorText(err);
  }
  const resetDates = () => {
    setCustomDates([]);
    setError("");
  };
  const normalDates =
    preview?.schedule
      .filter((i) => i.kind === "installment")
      .map((i) => i.due) || [];
  return (
    <Modal
      title="Criar acordo de pagamento"
      description="Entrada e parcelas são compromissos a receber. Confirmar o acordo não registra pagamento."
      onClose={onClose}
      wide
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!input) return;
          try {
            onCreated(createPaymentAgreement(input));
          } catch (err) {
            setError(errorText(err));
          }
        }}
      >
        <div className="form-grid">
          <Field label="Operação de origem" className="full">
            <select
              aria-label="Operação de origem"
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                resetDates();
              }}
              required
            >
              <option value="">Selecione uma venda ou OS aprovada</option>
              <optgroup label="Vendas confirmadas">
                {state.sales.map((s) => (
                  <option key={s.id} value={`sale:${s.id}`}>
                    Venda #{s.number} ·{" "}
                    {state.customers.find((c) => c.id === s.customerId)?.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="OS aprovadas">
                {state.orders
                  .filter((o) => o.approved)
                  .map((o) => (
                    <option key={o.id} value={`order:${o.id}`}>
                      OS #{o.number} ·{" "}
                      {state.customers.find((c) => c.id === o.customerId)?.name}
                    </option>
                  ))}
              </optgroup>
            </select>
          </Field>
        </div>
        {origin && (
          <div className="amount-highlight">
            <span>
              Saldo a organizar
              {origin.legacyReceived > 0
                ? ` · histórico preservado de ${money(origin.legacyReceived)}`
                : ""}
            </span>
            <strong>{money(origin.principal)}</strong>
          </div>
        )}
        {existing ? (
          <div className="notice notice-info">
            <div>
              <strong>Esta operação já possui um acordo</strong>
              <p>
                Abra as parcelas existentes. Nesta etapa, não há renegociação ou
                substituição de acordos.
              </p>
              <button
                type="button"
                className="text-link"
                onClick={() => onCreated(existing.id)}
              >
                Ver parcelas existentes
                <ArrowUpRight size={14} />
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="form-grid">
              <Field label="Entrada (R$)">
                <input
                  inputMode="decimal"
                  value={down}
                  onChange={(e) => {
                    setDown(e.target.value);
                    resetDates();
                  }}
                  maxLength={14}
                />
              </Field>
              <Field label="Vencimento da entrada">
                <input
                  type="date"
                  value={downDue}
                  onChange={(e) => {
                    setDownDue(e.target.value);
                    resetDates();
                  }}
                />
              </Field>
              <Field label="Quantidade de parcelas">
                <input
                  type="number"
                  min={0}
                  max={36}
                  value={count}
                  onChange={(e) => {
                    setCount(Number(e.target.value));
                    resetDates();
                  }}
                />
              </Field>
              <Field label="Primeiro vencimento">
                <input
                  type="date"
                  value={firstDue}
                  onChange={(e) => {
                    setFirstDue(e.target.value);
                    resetDates();
                  }}
                  disabled={count === 0}
                />
              </Field>
            </div>
            <p className="finance-note">
              A entrada também fica pendente até ser recebida. Se ela cobrir
              todo o saldo, use zero parcelas adicionais. Sem juros ou encargos
              neste recorte.
            </p>
            {preview && (
              <div className="finance-preview">
                <h3>Prévia do acordo</h3>
                <p className="muted">
                  Valores rateados em centavos; meses curtos preservam o dia
                  contratado nos meses seguintes. Ajuste os vencimentos abaixo
                  se necessário.
                </p>
                <div className="finance-schedule">
                  {preview.schedule.map((item, index) => (
                    <div className="finance-schedule-row" key={index}>
                      <strong>{installmentLabel(item)}</strong>
                      {item.kind === "down_payment" ? (
                        <span>
                          {dateLabel(item.due)} · {item.due.slice(0, 4)}
                        </span>
                      ) : (
                        <Field label={`Vencimento da parcela ${item.number}`}>
                          <input
                            type="date"
                            value={customDates[item.number - 1] ?? item.due}
                            onChange={(e) => {
                              const next = customDates.length
                                ? [...customDates]
                                : [...normalDates];
                              next[item.number - 1] = e.target.value;
                              setCustomDates(next);
                              setError("");
                            }}
                            required
                          />
                        </Field>
                      )}
                      <strong>{money(item.amount)}</strong>
                    </div>
                  ))}
                </div>
                <div className="estimate-total">
                  <span>Total do acordo</span>
                  <strong>{money(preview.principal)}</strong>
                </div>
              </div>
            )}
          </>
        )}
        <FormError message={error || validation} />
        <div className="form-actions">
          <button
            className="button button-secondary"
            type="button"
            onClick={onClose}
          >
            Voltar
          </button>
          <button
            className="button button-primary"
            type="submit"
            disabled={!input || !!validation || !!existing}
          >
            Confirmar acordo
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PaymentModal({
  item,
  asOf,
  onClose,
  onReceived,
}: {
  item: Installment;
  asOf: string;
  onClose: () => void;
  onReceived: (id: string) => void;
}) {
  const { state, registerInstallmentPayment, openCashShift } = useDemo();
  const agreement = state.finance.agreements.find(
    (a) => a.id === item.agreementId,
  )!;
  const balance = installmentBalance(state, item.id);
  const [amount, setAmount] = useState(amountInput(balance));
  const [method, setMethod] = useState<PaymentMethod>("pix");
  const [accountId, setAccountId] = useState(
    state.finance.accounts.find((a) => a.type === "bank" && a.active)?.id || "",
  );
  const [person, setPerson] = useState("");
  const [reference, setReference] = useState("");
  const [tendered, setTendered] = useState(amountInput(balance));
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [opening, setOpening] = useState(false);
  const [operator, setOperator] = useState("");
  const [openingError, setOpeningError] = useState("");
  const operatorRef = useRef<HTMLInputElement>(null);
  const openingActionRef = useRef<HTMLButtonElement>(null);
  const paymentActionRef = useRef<HTMLButtonElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<"opening" | "payment" | null>(null);
  const key = useRef<string | null>(null);
  const shift = state.finance.shifts.find(
    (s) => s.accountId === accountId && s.status === "open",
  );
  const accounts = state.finance.accounts.filter(
    (a) => a.active && a.type === (method === "cash" ? "cash" : "bank"),
  );
  const account = accounts.find((a) => a.id === accountId);
  const payableShift = shift?.openedOn === asOf ? shift : undefined;
  useEffect(() => {
    if (opening) {
      operatorRef.current?.focus();
    } else if (returnFocus.current) {
      const action = returnFocus.current === "opening"
        ? openingActionRef.current
        : paymentActionRef.current;
      if (action && !action.disabled) action.focus();
      else amountRef.current?.focus();
      returnFocus.current = null;
    }
  }, [opening]);
  const cancelOpening = () => {
    returnFocus.current = "opening";
    setOpening(false);
  };
  let previewChange: number | null = null;
  try {
    if (method === "cash")
      previewChange = parseMoney(tendered) - parseMoney(amount);
  } catch {
    /* The submission reports malformed money without resetting the form. */
  }
  return (
    <Modal
      title={opening ? "Abrir caixa" : "Receber parcela"}
      description={`${agreement.sourceLabel} · ${agreement.customerName} · ${installmentLabel(item)}`}
      onClose={opening ? cancelOpening : onClose}
      onCancel={opening ? (event) => {
        event.preventDefault();
        cancelOpening();
      } : undefined}
      onKeyDown={(event) => {
        if (
          event.key !== "Tab" || event.defaultPrevented ||
          event.altKey || event.ctrlKey || event.metaKey
        ) return;
        const dialog = event.currentTarget;
        const controls = Array.from(dialog.querySelectorAll<HTMLElement>(
          "button, a[href], input, select, textarea, [tabindex]",
        )).filter((element) =>
          element.tabIndex >= 0 && !element.matches(":disabled") &&
          !element.closest("[inert]") && element.getClientRects().length > 0,
        );
        const first = controls[0];
        const last = controls[controls.length - 1];
        const boundary = event.shiftKey ? first : last;
        // Keep both Tab directions in this payment journey at the boundaries.
        if (first && last && (
          document.activeElement === boundary || document.activeElement === dialog
        )) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }}
    >
      {opening ? (
        <form
          key="opening"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              if (method !== "cash" || !account)
                throw new Error("Selecione uma conta ativa de caixa físico.");
              openCashShift({ accountId: account.id, operator });
              returnFocus.current = "payment";
              setOpening(false);
              setError("");
            } catch (err) {
              setOpeningError(errorText(err));
            }
          }}
        >
          <div className="finance-preview">
            <p><strong>{account?.name || "Conta de caixa indisponível"}</strong></p>
            <p className="finance-note">
              Abrir o caixa cria somente o turno, sem receber esta parcela.
              Depois, confira os dados e confirme o recebimento separadamente.
            </p>
          </div>
          <Field label="Operador do caixa">
            <input
              ref={operatorRef}
              value={operator}
              onChange={(e) => setOperator(e.target.value)}
              maxLength={100}
              required
            />
          </Field>
          <p className="finance-note">
            O turno começa com o saldo já registrado nesta conta fictícia.
            A abertura não registra receita nem adiciona fundo de caixa.
            O operador informado não altera o responsável pela conferência.
          </p>
          <FormError message={openingError} />
          <div className="form-actions">
            <button
              className="button button-secondary"
              type="button"
              onClick={cancelOpening}
            >
              Cancelar abertura
            </button>
            <button className="button button-primary" type="submit">
              Confirmar abertura
            </button>
          </div>
        </form>
      ) : (
      <form
        key="payment"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            key.current ||= uid();
            const id = registerInstallmentPayment({
              installmentId: item.id,
              amount: parseMoney(amount),
              method,
              accountId,
              shiftId: method === "cash" ? payableShift?.id : undefined,
              confirmedBy: person,
              reference: method === "cash" ? "" : reference,
              tendered: method === "cash" ? parseMoney(tendered) : undefined,
              creditConfirmed: method !== "cash" && confirmed,
              idempotencyKey: key.current,
            });
            onReceived(id);
          } catch (err) {
            setError(errorText(err));
          }
        }}
      >
        <div className="amount-highlight">
          <span>Saldo desta parcela</span>
          <strong>{money(balance)}</strong>
        </div>
        <div className="form-grid">
          <Field label="Valor a aplicar (R$)">
            <input
              ref={amountRef}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              maxLength={14}
              required
            />
          </Field>
          <Field label="Forma de pagamento">
            <select
              aria-label="Forma de pagamento"
              value={method}
              onChange={(e) => {
                const next = e.target.value as PaymentMethod;
                setMethod(next);
                setAccountId(
                  state.finance.accounts.find(
                    (a) =>
                      a.active &&
                      a.type === (next === "cash" ? "cash" : "bank"),
                  )?.id || "",
                );
                setConfirmed(false);
                setError("");
              }}
            >
              <option value="pix">Pix</option>
              <option value="cash">Dinheiro</option>
              <option value="transfer">Transferência</option>
            </select>
          </Field>
          <Field label="Conta de destino" className="full">
            <select
              aria-label="Conta de destino"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              required
            >
              <option value="">Selecionar conta</option>
              {accounts.map((a) => (
                <option value={a.id} key={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Responsável pela conferência" className="full">
            <input
              value={person}
              onChange={(e) => setPerson(e.target.value)}
              maxLength={100}
              required
            />
          </Field>
          {method === "cash" ? (
            <Field label="Valor entregue (R$)" className="full">
              <input
                inputMode="decimal"
                value={tendered}
                onChange={(e) => setTendered(e.target.value)}
                maxLength={14}
                required
              />
            </Field>
          ) : (
            <Field label="Referência do crédito" className="full">
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                maxLength={120}
                placeholder="Referência que você conferiu na conta fictícia"
                required
              />
            </Field>
          )}
        </div>
        {method === "cash" ? (
          <>
            <div className="finance-preview">
              <p>
                <strong>
                  Troco:{" "}
                  {previewChange === null || previewChange < 0
                    ? "Confira os valores"
                    : money(previewChange)}
                </strong>
              </p>
              <p className="finance-note">
                {!account
                  ? "Selecione uma conta ativa de caixa físico."
                  : shift && !payableShift
                    ? `O turno de ${shift.operator}, aberto em ${shift.openedOn}, é de outro dia. Trate o turno anterior na aba Caixa e contas antes de receber em dinheiro.`
                    : shift
                      ? `Turno de ${shift.operator}, aberto em ${shift.openedOn}.`
                      : "Não há turno aberto nesta conta. Abra o caixa para continuar com estes dados."}
              </p>
              {account && !shift && (
                <button
                  ref={openingActionRef}
                  className="button button-secondary"
                  type="button"
                  onClick={() => {
                    setOperator(person);
                    setOpeningError("");
                    setOpening(true);
                  }}
                >
                  Abrir caixa nesta conta
                </button>
              )}
            </div>
            <p className="finance-note">
              Somente o valor aplicado à parcela entra no saldo. O troco
              permanece discriminado no recibo.
            </p>
          </>
        ) : (
          <label className="finance-check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>Conferi o crédito na conta de destino</span>
          </label>
        )}
        <p className="finance-note">
          Registro manual demonstrativo, sem transação bancária. Data e
          responsável serão preservados. Não há estorno neste primeiro recorte;
          confira antes de confirmar.
        </p>
        <FormError message={error} />
        <div className="form-actions">
          <button
            className="button button-secondary"
            type="button"
            onClick={onClose}
          >
            Voltar
          </button>
          <button
            ref={paymentActionRef}
            className="button button-primary"
            type="submit"
            disabled={method === "cash" && (!account || !payableShift)}
          >
            Confirmar recebimento
          </button>
        </div>
      </form>
      )}
    </Modal>
  );
}

function ReceiptModal({
  payment,
  onClose,
}: {
  payment: FinancePayment;
  onClose: () => void;
}) {
  const r = payment.receipt;
  const download = () => {
    const text = [
      "SISTEM · RECIBO DEMONSTRATIVO",
      "Sem validade fiscal. Dados fictícios.",
      "",
      `Referência: ${r.code}`,
      `Loja: ${r.companyName}`,
      `Cliente: ${r.customerName}`,
      `Origem: ${r.sourceLabel}`,
      `Título: ${r.installmentLabel}`,
      `Vencimento: ${r.due}`,
      `Data de recebimento: ${r.receivedOn} (America/Sao_Paulo)`,
      `Valor aplicado: ${money(r.amount)}`,
      `Meio: ${methodLabels[r.method]}`,
      `Conta: ${r.accountName}`,
      `Conferido por: ${r.confirmedBy}`,
      `Referência do crédito: ${r.reference || "Não se aplica"}`,
      `Valor entregue: ${money(r.tendered)}`,
      `Troco: ${money(r.change)}`,
      `Saldo da parcela após este recebimento: ${money(r.remaining)}`,
      "",
      "Reemissão de uma cópia preservada. Não registra outro recebimento.",
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/plain;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${r.code}.txt`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  return (
    <Modal
      title="Recibo demonstrativo"
      description="Cópia preservada na data do recebimento. Não substitui documento fiscal."
      onClose={onClose}
    >
      <div className="finance-receipt">
        <div className="finance-receipt-header">
          <ReceiptText size={28} />
          <div>
            <h3>{r.code}</h3>
            <p>{r.companyName}</p>
          </div>
        </div>
        <dl className="details-list">
          <div>
            <dt>Cliente</dt>
            <dd>{r.customerName}</dd>
          </div>
          <div>
            <dt>Origem / título</dt>
            <dd>
              {r.sourceLabel} · {r.installmentLabel}
            </dd>
          </div>
          <div>
            <dt>Recebido em</dt>
            <dd>
              {dateLabel(r.receivedOn)} · {r.receivedOn.slice(0, 4)} ·
              America/Sao_Paulo
            </dd>
          </div>
          <div>
            <dt>Meio / conta</dt>
            <dd>
              {methodLabels[r.method]} · {r.accountName}
            </dd>
          </div>
          <div>
            <dt>Conferido por</dt>
            <dd>{r.confirmedBy}</dd>
          </div>
          {r.reference && (
            <div>
              <dt>Referência do crédito</dt>
              <dd>{r.reference}</dd>
            </div>
          )}
          {r.method === "cash" && (
            <>
              <div>
                <dt>Valor entregue</dt>
                <dd>{money(r.tendered)}</dd>
              </div>
              <div>
                <dt>Troco</dt>
                <dd>{money(r.change)}</dd>
              </div>
            </>
          )}
          <div>
            <dt>Saldo da parcela após este recebimento</dt>
            <dd>{money(r.remaining)}</dd>
          </div>
        </dl>
        <div className="finance-receipt-total">
          <span>Valor aplicado à parcela</span>
          <strong>{money(r.amount)}</strong>
        </div>
      </div>
      <p className="finance-note">
        Este recibo retrata o momento registrado. Pagamentos posteriores não
        reescrevem a cópia. Dados de demonstração, sem validade fiscal.
      </p>
      <div className="form-actions">
        <button className="button button-secondary" onClick={onClose}>
          Fechar recibo
        </button>
        <button className="button button-primary" onClick={download}>
          <Download size={16} />
          Baixar recibo (.txt)
        </button>
      </div>
    </Modal>
  );
}

function ShiftModal({
  account,
  shift,
  onClose,
}: {
  account: FinanceAccount;
  shift?: CashShift;
  onClose: () => void;
}) {
  const { state, openCashShift, closeCashShift } = useDemo();
  const [person, setPerson] = useState(shift?.operator || "");
  const [counted, setCounted] = useState("");
  const [error, setError] = useState("");
  const expected = accountBalance(state, account.id);
  return (
    <Modal
      title={shift ? "Fechar caixa" : "Abrir caixa"}
      description={account.name}
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            if (shift)
              closeCashShift({
                shiftId: shift.id,
                counted: parseMoney(counted),
                closedBy: person,
              });
            else openCashShift({ accountId: account.id, operator: person });
            onClose();
          } catch (err) {
            setError(errorText(err));
          }
        }}
      >
        <div className="amount-highlight">
          <span>
            {shift
              ? "Saldo esperado do controle"
              : "Saldo escritural para este turno"}
          </span>
          <strong>{money(expected)}</strong>
        </div>
        <div className="form-grid">
          <Field
            label={shift ? "Conferido por" : "Operador do caixa"}
            className="full"
          >
            <input
              value={person}
              onChange={(e) => setPerson(e.target.value)}
              maxLength={100}
              required
            />
          </Field>
          {shift && (
            <Field label="Valor contado (R$)" className="full">
              <input
                value={counted}
                onChange={(e) => setCounted(e.target.value)}
                inputMode="decimal"
                maxLength={14}
                required
              />
            </Field>
          )}
        </div>
        <p className="finance-note">
          {shift
            ? "A diferença entre esperado e contado ficará registrada. Fechar o caixa não altera o saldo nem cria um ajuste automático."
            : "O turno começa com o saldo já registrado nesta conta fictícia. Abrir novamente não soma um novo fundo nem registra receita. Saldo inicial zero; fundo real e sangria ficam para outra etapa."}
        </p>
        <FormError message={error} />
        <div className="form-actions">
          <button
            className="button button-secondary"
            type="button"
            onClick={onClose}
          >
            Voltar
          </button>
          <button className="button button-primary" type="submit">
            {shift ? "Confirmar fechamento" : "Confirmar abertura"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
