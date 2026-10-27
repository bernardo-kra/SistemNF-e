"use client";

import { useEffect, useRef, useState } from "react";
import Link from "@/components/demo-link";
import { OrderReceipt, type OrderReceiptSnapshot } from "@/components/order-receipt";
import { findOrderByCode, orderCode } from "@/lib/order-code";
import { orderReceived, sourceAgreement } from "@/lib/finance/engine";
import {
  Plus,
  Wrench,
  ArrowLeft,
  ChevronRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Package,
  FileText,
  Wallet,
  ClipboardCheck,
  Pencil,
  ArrowRight,
  Printer,
  ScanBarcode,
} from "lucide-react";
import { useDemo, newOrder } from "@/lib/demo-store";
import { techniciansForState } from "@/lib/technicians";
import {
  ContextualDialog,
  CustomerEditor,
  TechnicianEditor,
} from "@/components/contextual-catalog";
import {
  dateLabel,
  matches,
  money,
  stages,
  sumOrder,
  TODAY,
  type ServiceOrder,
  type Stage,
} from "@/lib/domain";
import {
  Avatar,
  Badge,
  EmptyState,
  Field,
  FormError,
  Modal,
  PageHeader,
  PaginationInfo,
  Panel,
  SearchField,
} from "@/components/ui";

const nextLabels: Record<Stage, string> = {
  received: "Iniciar diagnóstico",
  diagnosing: "Preparar orçamento",
  awaiting_approval: "Registrar aprovação",
  in_progress: "Encaminhar para testes",
  quality_check: "Concluir testes",
  ready_for_pickup: "Registrar entrega",
  delivered: "Atendimento concluído",
};

export function OrdersPage() {
  const { state, saveOrder, advanceOrder, notify } = useDemo();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<ServiceOrder | null>(null);
  const [editingCustomerId, setEditingCustomerId] = useState("");
  const [editingTechnician, setEditingTechnician] = useState("Não atribuído");
  const [contextual, setContextual] = useState<"customer" | "technician" | null>(
    null,
  );
  const [action, setAction] = useState<ServiceOrder | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("overview");
  const [readerActive, setReaderActive] = useState(false);
  const [readerMessage, setReaderMessage] = useState("Leia a folha para abrir diretamente a ordem.");
  const [allowOutstanding, setAllowOutstanding] = useState(false);
  const [receipt, setReceipt] = useState<OrderReceiptSnapshot | null>(null);
  const saving = useRef(false);
  const advancing = useRef(false);
  const reading = useRef("");
  const openEditing = (order: ServiceOrder) => {
    setError("");
    saving.current = false;
    reading.current = "";
    setEditingCustomerId(order.customerId);
    setEditingTechnician(order.technician);
    setContextual(null);
    setEditing(order);
  };
  const closeEditing = () => {
    setContextual(null);
    setEditing(null);
  };
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("os")) setSelected(params.get("os"));
    if (params.has("nova")) openEditing(newOrder(state.customers[0]?.id || ""));
  }, []);
  const selectedOrder = state.orders.find((o) => o.id === selected);
  const receivedTotal = selectedOrder ? orderReceived(state, selectedOrder) : 0;
  const outstanding = selectedOrder ? Math.max(0, sumOrder(selectedOrder) - receivedTotal) : 0;
  const paymentAgreement =
    selectedOrder &&
    sourceAgreement(state, { type: "order", id: selectedOrder.id });
  const editingAgreement =
    editing && sourceAgreement(state, { type: "order", id: editing.id });
  const technicianNames = [
    ...new Set([
      ...techniciansForState(state).map((technician) => technician.name),
      ...(editingTechnician && editingTechnician !== "Não atribuído"
        ? [editingTechnician]
        : []),
    ]),
  ];
  const customer =
    selectedOrder &&
    state.customers.find((c) => c.id === selectedOrder.customerId);
  const filtered = state.orders.filter(
    (o) =>
      matches(
        `${o.number} ${o.equipment} ${o.serial} ${state.customers.find((c) => c.id === o.customerId)?.name}`,
        query,
      ) &&
      (!filter ||
        (filter === "late"
          ? o.due < TODAY && o.stage !== "delivered"
          : o.stage === filter)),
  );
  const selectOrder = (id: string) => {
    setError("");
    setAction(null);
    setAllowOutstanding(false);
    setSelected(id);
    setTab(state.orders.find((order) => order.id === id)?.stage === "delivered" ? "history" : "overview");
    window.history.replaceState(null, "", `?os=${encodeURIComponent(id)}`);
    window.scrollTo({ top: 0, behavior: "auto" });
  };
  const closeDetail = () => {
    setSelected(null);
    window.history.replaceState(null, "", "/demo/ordens/");
  };

  useEffect(() => {
    advancing.current = false;
    setAction(null);
    setAllowOutstanding(false);
  }, [selectedOrder?.id, selectedOrder?.stage]);

  useEffect(() => {
    const capture = (event: KeyboardEvent) => {
      if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const editable = target?.closest("input, textarea, select, [contenteditable='true']");
      const fieldValue = editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement ? editable.value : "";
      if (event.key === "Enter" && event.repeat) { event.preventDefault(); return; }
      if (event.key === "Enter") {
        const code = reading.current;
        reading.current = "";
        const isReference = code.startsWith("SISTEM-OS:") || fieldValue.includes("SISTEM-OS:");
        if (!isReference) return;
        // A scanner's Enter must never submit a draft or activate the focused button.
        event.preventDefault(); event.stopPropagation();
        if (!readerActive || editable || editing || contextual || receipt || action || document.querySelector("dialog[open]")) return;
        const order = findOrderByCode(state.orders, code);
        if (!order) {
          const message = "OS não encontrada. Confira a folha ou use a busca pelo número.";
          setReaderMessage(message); notify(message); return;
        }
        selectOrder(order.id);
        setReaderMessage(`OS #${order.number} localizada. Confira o cliente e o equipamento antes de agir.`);
        return;
      }
      if (!readerActive) return;
      if (event.key === "Escape") { reading.current = ""; return; }
      if (event.key.length !== 1) return;
      const next = reading.current + event.key;
      // Only a reference prefix starts a command; ordinary typing is left alone.
      if ("SISTEM-OS:".startsWith(next) || next.startsWith("SISTEM-OS:")) reading.current = next.slice(0, 128);
      else reading.current = event.key === "S" ? "S" : "";
    };
    document.addEventListener("keydown", capture, true);
    return () => document.removeEventListener("keydown", capture, true);
  }, [readerActive, editing, contextual, receipt, action, state.orders, notify]);

  const printOrder = (order: ServiceOrder) => {
    try {
      orderCode(order);
      setReceipt({
        order: structuredClone(order),
        customer: structuredClone(state.customers.find((item) => item.id === order.customerId)),
        company: state.fiscalProfile.legalName || "Sistem",
        at: new Date().toISOString(),
      });
    } catch (failure) { setError((failure as Error).message); }
  };
  const moveOrder = (order: ServiceOrder, note = "") => {
    if (advancing.current) return;
    advancing.current = true;
    setError("");
    try { advanceOrder(order.id, note, order.stage, allowOutstanding); setAction(null); }
    catch (failure) { advancing.current = false; setError((failure as Error).message); }
  };
  const startAction = (order: ServiceOrder) => {
    setError("");
    if (["awaiting_approval", "quality_check"].includes(order.stage)) setAction(order);
    else moveOrder(order);
  };

  return (
    <>
      <div className="order-scan-panel">
        <div><strong><ScanBarcode size={18} /> Leitor de ordens de serviço</strong>
          <p className="order-scan-status" aria-live="polite">{readerActive
            ? editing || action || receipt ? "Conclua o formulário ou comprovante para voltar ao balcão." : readerMessage
            : "Ative uma vez para ler os códigos das folhas neste balcão."}</p>
        </div>
        <button className="button button-secondary" onClick={(event) => {
          reading.current = ""; setReaderActive(!readerActive); event.currentTarget.blur();
        }}>{readerActive ? "Desativar leitor de OS" : "Ativar leitor de OS"}</button>
      </div>
      {selectedOrder ? (
        <>
          <button className="back-link" onClick={closeDetail}>
            <ArrowLeft size={16} />
            Voltar para ordens de serviço
          </button>
          <PageHeader
            eyebrow={`ASSISTÊNCIA / OS #${selectedOrder.number}`}
            title={`OS #${selectedOrder.number}`}
            description={`${customer?.name || "Cliente"} · ${selectedOrder.equipment}`}
            action={
              <>
                <button className="button button-secondary" onClick={() => printOrder(selectedOrder)}>
                  <Printer size={16} /> Imprimir comprovante
                </button>
                <Link
                  className="button button-secondary"
                  href={`/fiscal/?source=order:${selectedOrder.id}`}
                >
                  Preparar NFS-e simulada
                </Link>
                <button
                  className="button button-secondary"
                  onClick={() => {
                    openEditing(selectedOrder);
                  }}
                  disabled={selectedOrder.approved}
                >
                  <Pencil size={16} />
                  Editar diagnóstico
                </button>
                {selectedOrder.stage !== "ready_for_pickup" && <button
                  className="button button-primary"
                  disabled={selectedOrder.stage === "delivered"}
                  onClick={(event) => { if (event.detail <= 1) startAction(selectedOrder); }}
                  onKeyDown={(event) => { if (event.repeat && ["Enter", " "].includes(event.key)) event.preventDefault(); }}
                >{nextLabels[selectedOrder.stage]}<ArrowRight size={17} /></button>}
              </>
            }
          />
          <div className="order-status-line">
            <Badge tone={stages[selectedOrder.stage].tone}>
              {stages[selectedOrder.stage].label}
            </Badge>
            <span>
              <CalendarDays size={15} />
              Previsão: {dateLabel(selectedOrder.due)}
            </span>
            <span>
              <Avatar name={selectedOrder.technician} small />
              {selectedOrder.technician}
            </span>
          </div>
          <FormError message={action ? "" : error} />
          {selectedOrder.stage === "ready_for_pickup" && (
            <section className="quick-action-panel" aria-label="Retirada do equipamento">
              <h2>Conferir e entregar</h2>
              <p><strong>{customer?.name || "Cliente não localizado"}</strong> · {selectedOrder.equipment}
                {selectedOrder.serial && ` · ${selectedOrder.serial}`}</p>
              <p>Acessórios: {selectedOrder.accessories || "Nenhum informado"}. Ao confirmar, você declara que conferiu o equipamento, os acessórios e a identidade autorizada para retirada.</p>
              {!selectedOrder.tested && <div className="notice notice-warning">Testes pendentes: conclua o checklist antes da entrega.</div>}
              {!selectedOrder.approved && <div className="notice notice-warning">Aprovação pendente: o orçamento precisa estar autorizado antes da entrega.</div>}
              {outstanding > 0 && <div className="notice notice-warning">
                <div><strong>Saldo pendente: {money(outstanding)}</strong><p>A entrega não registra pagamento nem quita o saldo.</p>
                  <label className="checkbox-field"><input type="checkbox" checked={allowOutstanding}
                    onChange={(event) => setAllowOutstanding(event.target.checked)} />Confirmo a entrega com saldo pendente nesta demonstração</label>
                </div>
              </div>}
              {action?.id !== selectedOrder.id && <div className="form-actions">
                <button className="button button-secondary" onClick={() => { setError(""); setAction(selectedOrder); }}>
                  Outra pessoa vai retirar
                </button>
                <button className="button button-primary"
                  disabled={!customer || !selectedOrder.tested || !selectedOrder.approved || (outstanding > 0 && !allowOutstanding)}
                  onClick={(event) => { if (event.detail <= 1 && customer) moveOrder(selectedOrder, customer.name); }}
                  onKeyDown={(event) => { if (event.repeat && ["Enter", " "].includes(event.key)) event.preventDefault(); }}>
                  Confirmar entrega a {customer?.name || "cliente"}
                </button>
              </div>}
            </section>
          )}
          {action && action.id === selectedOrder.id && action.stage === selectedOrder.stage && (
            <section className="quick-action-panel" aria-label={nextLabels[action.stage]}>
              <h2>{action.stage === "ready_for_pickup" ? "Retirada por pessoa autorizada" : nextLabels[action.stage]}</h2>
              {readerActive && <p className="form-note">Leitor de OS suspenso durante esta conferência.</p>}
              <form className="quick-action-form" onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                moveOrder(action, String(data.get("approval") || data.get("recipient") || ""));
              }}>
                {action.stage === "awaiting_approval" ? <>
                  <div className="notice notice-info">Orçamento: <strong>{money(sumOrder(action))}</strong>. Registre uma aprovação recebida fora da plataforma; nenhuma mensagem será enviada.</div>
                  <Field label="Responsável e canal da aprovação *"><textarea name="approval" required maxLength={300}
                    placeholder="Ex.: Mariana Costa, por telefone, autorizou o orçamento." rows={3} autoFocus /></Field>
                  <label className="checkbox-field"><input type="checkbox" required />Confirmo que o cliente autorizou os valores e o serviço.</label>
                </> : action.stage === "quality_check" ? <div className="checklist">
                  {["Funcionamento testado após o reparo", "Equipamento e acessórios conferidos", "Resultado do serviço aprovado pelo técnico"].map((item) => (
                    <label className="checkbox-field" key={item}><input type="checkbox" required />{item}</label>
                  ))}
                </div> : <>
                  <Field label="Nome do responsável pela retirada *"><input required name="recipient" maxLength={100} autoFocus /></Field>
                  <label className="checkbox-field"><input required type="checkbox" />Equipamento e acessórios foram conferidos e entregues.</label>
                </>}
                <FormError message={error} />
                <div className="form-actions">
                  <button className="button button-secondary" type="button" onClick={() => { setAction(null); setError(""); }}>Cancelar</button>
                  <button className="button button-primary" type="submit"
                    disabled={action.stage === "ready_for_pickup" && (!selectedOrder.approved || !selectedOrder.tested || (outstanding > 0 && !allowOutstanding))}
                    onClick={(event) => { if (event.detail > 1) event.preventDefault(); }}>Confirmar etapa</button>
                </div>
              </form>
            </section>
          )}
          {selectedOrder.stage === "awaiting_approval" && (
            <div className="notice notice-warning">
              <Clock3 size={19} />
              <div>
                <strong>
                  O próximo passo depende da aprovação do cliente.
                </strong>
                <p>
                  Registre quem autorizou este orçamento antes de iniciar a
                  execução.
                </p>
              </div>
            </div>
          )}
          <div className="tabs" role="tablist" aria-label="Seções da ordem">
            {[
              { id: "overview", label: "Visão geral" },
              { id: "estimate", label: "Orçamento" },
              { id: "history", label: "Histórico" },
            ].map((t) => (
              <button
                role="tab"
                id={`tab-${t.id}`}
                aria-controls={`panel-${t.id}`}
                aria-selected={tab === t.id}
                key={t.id}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            id={`panel-${tab}`}
            aria-labelledby={`tab-${tab}`}
          >
            {tab === "history" ? (
              <Panel
                title="Histórico do atendimento"
                subtitle="Cada etapa fica registrada."
              >
                <History order={selectedOrder} />
              </Panel>
            ) : (
              <div className="detail-grid">
                <div className="detail-main">
                  {tab === "overview" && (
                    <>
                      <Panel
                        title="Equipamento e entrada"
                        subtitle="Identificação e custódia do bem do cliente"
                      >
                        <div className="detail-card-content">
                          <div className="equipment-heading">
                            <span className="product-icon large">
                              <Wrench size={26} />
                            </span>
                            <div>
                              <h3>{selectedOrder.equipment}</h3>
                              <Badge tone="info">Equipamento do cliente</Badge>
                            </div>
                          </div>
                          <dl className="details-list">
                            <div>
                              <dt>Série / etiqueta</dt>
                              <dd>
                                {selectedOrder.serial || "Sem série informada"}
                              </dd>
                            </div>
                            <div>
                              <dt>Acessórios recebidos</dt>
                              <dd>
                                {selectedOrder.accessories ||
                                  "Nenhum acessório"}
                              </dd>
                            </div>
                            <div>
                              <dt>Recebido em</dt>
                              <dd>{dateLabel(selectedOrder.created)}</dd>
                            </div>
                            <div>
                              <dt>Custódia</dt>
                              <dd>
                                {selectedOrder.stage === "delivered"
                                  ? "Entregue ao cliente"
                                  : "Na loja"}
                              </dd>
                            </div>
                          </dl>
                          <div className="description-block">
                            <span>RELATO DO CLIENTE</span>
                            <p>{selectedOrder.issue}</p>
                          </div>
                        </div>
                      </Panel>
                      <Panel title="Diagnóstico técnico">
                        <div className="detail-card-content">
                          <p className="body-copy">
                            {selectedOrder.diagnosis ||
                              "O diagnóstico ainda não foi registrado. Edite a ordem para adicionar a avaliação técnica."}
                          </p>
                          <div className="inline-info">
                            <ClipboardCheck size={17} />
                            <span>
                              {selectedOrder.tested
                                ? "Checklist funcional aprovado."
                                : "Testes de conclusão ainda não realizados."}
                            </span>
                          </div>
                        </div>
                      </Panel>
                    </>
                  )}
                  <Panel
                    title="Itens do orçamento"
                    subtitle="Peças e mão de obra, separadamente."
                  >
                    <div className="detail-card-content">
                      <div className="estimate-row">
                        <span>
                          <Package size={18} />
                          Peças e materiais
                        </span>
                        <strong>{money(selectedOrder.parts)}</strong>
                      </div>
                      <div className="estimate-row">
                        <span>
                          <Wrench size={18} />
                          Serviços de manutenção
                        </span>
                        <strong>{money(selectedOrder.labor)}</strong>
                      </div>
                      <div className="estimate-total">
                        <span>Total do orçamento</span>
                        <strong>{money(sumOrder(selectedOrder))}</strong>
                      </div>
                      <div className="estimate-approval">
                        <Badge
                          tone={selectedOrder.approved ? "success" : "warning"}
                        >
                          {selectedOrder.approved
                            ? "Orçamento aprovado"
                            : "Aprovação pendente"}
                        </Badge>
                        <span>
                          {selectedOrder.approved
                            ? "Valores preservados após aprovação."
                            : "Este valor ainda é uma previsão."}
                        </span>
                      </div>
                    </div>
                  </Panel>
                  {tab === "overview" && (
                    <Panel title="Últimas atividades">
                      <History order={selectedOrder} />
                    </Panel>
                  )}
                </div>
                <div className="detail-aside">
                  <Panel title="Estado da operação">
                    <div className="operation-states">
                      <div>
                        <span className="state-icon green">
                          <Wallet size={18} />
                        </span>
                        <div>
                          <small>Financeiro</small>
                          <strong>
                            {!selectedOrder.approved
                              ? "Recebível não gerado"
                              : receivedTotal >= sumOrder(selectedOrder)
                                ? "Quitado"
                                : receivedTotal > 0
                                  ? "Recebido parcialmente"
                                  : "Em aberto"}
                          </strong>
                          <p>
                            {selectedOrder.approved
                              ? `${money(receivedTotal)} recebido${selectedOrder.received > 0 ? ` · ${money(selectedOrder.received)} de histórico informado` : ""}`
                              : "Aguardando aprovação"}
                          </p>
                        </div>
                      </div>
                      <div>
                        <span className="state-icon blue">
                          <FileText size={18} />
                        </span>
                        <div>
                          <small>Fiscal</small>
                          <strong>Não solicitado</strong>
                          <p>Sem emissão fiscal neste protótipo</p>
                        </div>
                      </div>
                      <div>
                        <span className="state-icon orange">
                          <Package size={18} />
                        </span>
                        <div>
                          <small>Peças</small>
                          <strong>Conferência na execução</strong>
                          <p>Esta OS não movimenta peças no protótipo</p>
                        </div>
                      </div>
                    </div>
                    {selectedOrder.approved && (
                      <Link
                        className="aside-link"
                        href={`/financeiro/?source=order:${selectedOrder.id}`}
                      >
                        {paymentAgreement
                          ? "Acompanhar parcelas"
                          : "Organizar pagamento"}{" "}
                        <ArrowRight size={15} />
                      </Link>
                    )}
                  </Panel>
                  <div className="detail-tip">
                    <CheckCircle2 size={23} />
                    <h3>Conferir antes de entregar</h3>
                    <p>
                      Equipamento, acessórios e testes concluídos fazem parte de
                      um atendimento bem fechado.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <PageHeader
            eyebrow="DO DIAGNÓSTICO À ENTREGA"
            title="Ordens de serviço"
            description="Cada equipamento com uma história. Cada etapa sob controle."
            action={
              <button
                className="button button-primary"
                onClick={() => {
                  openEditing(newOrder(state.customers[0]?.id || ""));
                }}
              >
                <Plus size={18} />
                Nova ordem de serviço
              </button>
            }
          />
          <div className="filter-chips">
            <button
              className={!filter ? "active" : ""}
              onClick={() => setFilter("")}
            >
              Todas <span>{state.orders.length}</span>
            </button>
            <button
              className={filter === "awaiting_approval" ? "active" : ""}
              onClick={() => setFilter("awaiting_approval")}
            >
              Aguardando aprovação{" "}
              <span>
                {
                  state.orders.filter((o) => o.stage === "awaiting_approval")
                    .length
                }
              </span>
            </button>
            <button
              className={filter === "ready_for_pickup" ? "active" : ""}
              onClick={() => setFilter("ready_for_pickup")}
            >
              Prontas para retirada{" "}
              <span>
                {
                  state.orders.filter((o) => o.stage === "ready_for_pickup")
                    .length
                }
              </span>
            </button>
            <button
              className={filter === "late" ? "active" : ""}
              onClick={() => setFilter("late")}
            >
              Em atraso{" "}
              <span>
                {
                  state.orders.filter(
                    (o) => o.due < TODAY && o.stage !== "delivered",
                  ).length
                }
              </span>
            </button>
          </div>
          <section className="panel">
            <div className="list-toolbar">
              <SearchField
                value={query}
                onChange={setQuery}
                placeholder="Buscar OS, cliente, equipamento ou série…"
              />
              <span className="toolbar-label">
                {filtered.length} atendimentos encontrados
              </span>
            </div>
            {filtered.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>ORDEM / EQUIPAMENTO</th>
                      <th>CLIENTE</th>
                      <th>TÉCNICO</th>
                      <th>ETAPA</th>
                      <th>PREVISÃO</th>
                      <th className="number">ORÇAMENTO</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((o) => (
                      <tr key={o.id}>
                        <td>
                          <button
                            className="order-cell table-button"
                            onClick={() => selectOrder(o.id)}
                          >
                            <span className="device-icon">
                              <Wrench size={18} />
                            </span>
                            <span>
                              <strong>
                                #{o.number} <span>{o.equipment}</span>
                              </strong>
                              <small>{o.serial}</small>
                            </span>
                          </button>
                        </td>
                        <td>
                          {
                            state.customers.find((c) => c.id === o.customerId)
                              ?.name
                          }
                        </td>
                        <td>
                          <div className="person-cell compact">
                            <Avatar name={o.technician} small />
                            <span>{o.technician}</span>
                          </div>
                        </td>
                        <td>
                          <Badge tone={stages[o.stage].tone}>
                            {stages[o.stage].label}
                          </Badge>
                        </td>
                        <td
                          className={
                            o.due < TODAY && o.stage !== "delivered"
                              ? "overdue"
                              : "muted"
                          }
                        >
                          {dateLabel(o.due)}
                        </td>
                        <td className="number strong">{money(sumOrder(o))}</td>
                        <td>
                          <button
                            className="icon-button"
                            aria-label={`Abrir OS ${o.number}`}
                            onClick={() => selectOrder(o.id)}
                          >
                            <ChevronRight size={18} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState />
            )}
            <PaginationInfo count={filtered.length} noun="ordens de serviço" />
          </section>
        </>
      )}
      {editing && (
        <Modal
          title={
            editing.number
              ? `Editar OS #${editing.number}`
              : "Nova ordem de serviço"
          }
          description="Registre o equipamento e o problema relatado pelo cliente."
          wide
          onClose={closeEditing}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (saving.current) return;
              const f = new FormData(e.currentTarget);
              try {
                if (
                  !String(f.get("equipment")).trim() ||
                  !String(f.get("issue")).trim()
                )
                  throw new Error("Preencha equipamento e problema relatado.");
                saving.current = true;
                const saved = saveOrder({
                  ...editing,
                  customerId: editingCustomerId,
                  equipment: String(f.get("equipment")).trim(),
                  serial: String(f.get("serial")).trim(),
                  accessories: String(f.get("accessories")).trim(),
                  issue: String(f.get("issue")).trim(),
                  diagnosis: String(f.get("diagnosis")).trim(),
                  due: String(f.get("due")),
                  technician: editingTechnician,
                  parts: Math.round(Number(f.get("parts")) * 100),
                  labor: Math.round(Number(f.get("labor")) * 100),
                });
                const submitter = (e.nativeEvent as SubmitEvent).submitter;
                closeEditing();
                if (submitter instanceof HTMLButtonElement && submitter.value === "print") {
                  selectOrder(saved.id);
                  printOrder(saved);
                }
              } catch (err) {
                saving.current = false;
                setError((err as Error).message);
              }
            }}
          >
            {readerActive && <p className="form-note">Leitor de OS suspenso enquanto você preenche este formulário. A leitura não salva nem fecha seu rascunho.</p>}
            <div className="form-grid">
              <div className="contextual-field">
                <Field label="Cliente *">
                  <select
                    name="customerId"
                    required
                    value={editingCustomerId}
                    onChange={(event) => setEditingCustomerId(event.target.value)}
                    disabled={Boolean(editingAgreement)}
                  >
                    {!editingCustomerId && (
                      <option value="">Selecione um cliente</option>
                    )}
                    {state.customers.map((c) => (
                      <option value={c.id} key={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <button
                  type="button"
                  className="button button-small button-secondary contextual-create"
                  onClick={() => setContextual("customer")}
                  disabled={Boolean(editingAgreement)}
                >
                  <Plus size={14} /> Cadastrar cliente
                </button>
                {editingAgreement && (
                  <small>
                    O cliente está preservado pelo acordo financeiro desta OS.
                  </small>
                )}
              </div>
              <div className="contextual-field">
                <Field label="Técnico responsável">
                  <select
                    name="technician"
                    value={editingTechnician}
                    onChange={(event) => setEditingTechnician(event.target.value)}
                  >
                    <option>Não atribuído</option>
                    {technicianNames.map((name) => (
                      <option key={name}>{name}</option>
                    ))}
                  </select>
                </Field>
                <button
                  type="button"
                  className="button button-small button-secondary contextual-create"
                  onClick={() => setContextual("technician")}
                >
                  <Plus size={14} /> Cadastrar técnico
                </button>
              </div>
              <Field label="Equipamento / marca e modelo *" className="full">
                <input
                  name="equipment"
                  required
                  maxLength={100}
                  defaultValue={editing.equipment}
                  placeholder="Ex.: Notebook Dell Inspiron 15"
                />
              </Field>
              <Field label="Número de série / etiqueta">
                <input
                  name="serial"
                  maxLength={60}
                  defaultValue={editing.serial}
                />
              </Field>
              <Field label="Previsão de conclusão *">
                <input
                  name="due"
                  type="date"
                  required
                  defaultValue={editing.due}
                />
              </Field>
              <Field label="Acessórios recebidos" className="full">
                <input
                  name="accessories"
                  maxLength={160}
                  defaultValue={editing.accessories}
                  placeholder="Carregador, bolsa, cabo…"
                />
              </Field>
              <Field label="Problema relatado pelo cliente *" className="full">
                <textarea
                  name="issue"
                  required
                  maxLength={1200}
                  defaultValue={editing.issue}
                  rows={2}
                />
              </Field>
              <Field label="Diagnóstico técnico" className="full">
                <textarea
                  name="diagnosis"
                  maxLength={2000}
                  defaultValue={editing.diagnosis}
                  rows={2}
                />
              </Field>
              <Field label="Peças / materiais (R$)">
                <input
                  name="parts"
                  type="number"
                  min="0"
                  max="9999999"
                  step="0.01"
                  defaultValue={editing.parts / 100}
                />
              </Field>
              <Field label="Serviços (R$)">
                <input
                  name="labor"
                  type="number"
                  min="0"
                  max="9999999"
                  step="0.01"
                  defaultValue={editing.labor / 100}
                />
              </Field>
            </div>
            <FormError message={error} />
            <div className="form-actions">
              <button className="button button-secondary" type="button" onClick={closeEditing}>Cancelar</button>
              <button className="button button-secondary" type="submit">
                {editing.number ? "Salvar alterações" : "Abrir ordem de serviço"}
              </button>
              <button className="button button-primary" type="submit" name="intent" value="print">
                <Printer size={16} /> Salvar e imprimir
              </button>
            </div>
          </form>
          {contextual === "customer" && (
            <ContextualDialog
              title="Novo cliente"
              description="Cadastre o cliente para continuar preenchendo esta OS."
              onClose={() => setContextual(null)}
            >
              <CustomerEditor
                onSaved={(saved) => {
                  setEditingCustomerId(saved.id);
                  setContextual(null);
                }}
                onCancel={() => setContextual(null)}
              />
            </ContextualDialog>
          )}
          {contextual === "technician" && (
            <ContextualDialog
              title="Novo técnico"
              description="Cadastro operacional para atribuir o serviço, sem criar conta de acesso."
              onClose={() => setContextual(null)}
            >
              <TechnicianEditor
                onSaved={(saved) => {
                  setEditingTechnician(saved.name);
                  setContextual(null);
                }}
                onCancel={() => setContextual(null)}
              />
            </ContextualDialog>
          )}
        </Modal>
      )}
      {receipt && <OrderReceipt snapshot={receipt} onClose={() => setReceipt(null)} />}
    </>
  );
}

function History({ order }: { order: ServiceOrder }) {
  return (
    <ol className="timeline">
      {order.history.map((item, index) => (
        <li key={`${index}-${item.label}`}>
          <span className="timeline-dot" />
          <div>
            <strong>{item.label}</strong>
            <small>{item.date}</small>
          </div>
        </li>
      ))}
    </ol>
  );
}
