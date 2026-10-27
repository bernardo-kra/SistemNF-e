"use client";

import Link from "@/components/demo-link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Building2,
  ClipboardCheck,
  FilePlus2,
  ShieldCheck,
} from "lucide-react";
import { useDemo } from "@/lib/demo-store";
import { dateLabel, matches, money, type Tone } from "@/lib/domain";
import { fiscalStatusLabels } from "@/lib/fiscal/defaults";
import { reviewPreparation } from "@/lib/fiscal/engine";
import type {
  FiscalAction,
  FiscalDocument,
  FiscalModel,
  FiscalSource,
  FiscalStatus,
  SimulationOutcome,
} from "@/lib/fiscal/types";
import {
  Badge,
  EmptyState,
  Field,
  FormError,
  Modal,
  PageHeader,
  PaginationInfo,
  SearchField,
} from "@/components/ui";

const tones: Record<FiscalStatus, Tone> = {
  draft: "neutral",
  queued: "info",
  processing: "info",
  authorized: "success",
  rejected: "danger",
  unknown: "warning",
  cancellation_pending: "warning",
  cancelled: "neutral",
};
const sourceKey = (source: FiscalSource) => `${source.type}:${source.id}`;
const parseSource = (key: string): FiscalSource | null => {
  const [type, id] = key.split(":");
  return id && (type === "sale" || type === "order") ? { type, id } : null;
};
function updateDocumentUrl(id: string | null) {
  const url = new URL(window.location.href);
  url.searchParams.delete("source");
  if (id) url.searchParams.set("doc", id);
  else url.searchParams.delete("doc");
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}
const statusLabel = (doc: FiscalDocument) =>
  doc.mode === "simulation"
    ? fiscalStatusLabels[doc.status]
    : `${({ authorized: "Autorizada", rejected: "Rejeitada", draft: "Rascunho" } as Partial<Record<FiscalStatus, string>>)[doc.status] || fiscalStatusLabels[doc.status]} · exemplo`;

export function FiscalDocumentsPage() {
  const { state, hydrated } = useDemo();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [preparing, setPreparing] = useState(false);
  const [initialSource, setInitialSource] = useState<FiscalSource | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const opened = useRef(false);
  useEffect(() => {
    if (!hydrated || opened.current) return;
    opened.current = true;
    const params = new URLSearchParams(window.location.search);
    const source = parseSource(params.get("source") || "");
    if (source) {
      setInitialSource(source);
      setPreparing(true);
    } else if (params.has("doc")) setSelected(params.get("doc"));
  }, [hydrated]);
  const documents = state.documents.filter(
    (doc) =>
      matches(`${doc.number} ${doc.customer} ${doc.model}`, query) &&
      (filter === "all" ||
        (filter === "simulation"
          ? doc.mode === "simulation"
          : doc.status === filter)),
  );
  const selectedDocument = state.documents.find((doc) => doc.id === selected);
  const openDocument = (id: string) => {
    setPreparing(false);
    setSelected(id);
    updateDocumentUrl(id);
  };
  const closePreparation = () => {
    setPreparing(false);
    updateDocumentUrl(null);
  };
  const closeDocument = () => {
    setSelected(null);
    updateDocumentUrl(null);
  };
  return (
    <>
      <PageHeader
        eyebrow="DOCUMENTOS E CONFERÊNCIA"
        title="Documentos fiscais"
        description="Prepare operações e percorra o ciclo fiscal em uma simulação local."
        action={
          <button
            className="button button-primary"
            disabled={!hydrated}
            onClick={() => {
              setInitialSource(null);
              setPreparing(true);
            }}
          >
            <FilePlus2 size={17} />
            Preparar documento
          </button>
        }
      />
      <div className="notice notice-warning">
        <ShieldCheck size={20} />
        <div>
          <strong>Simulação sem validade fiscal</strong>
          <p>
            Não há comunicação com SEFAZ ou prefeitura, cálculo de tributos, XML
            autorizado ou DANFE. Use dados fictícios.
          </p>
        </div>
      </div>
      <div className="fiscal-shortcuts">
        <Link href="/fiscal/configuracao/">
          <span className="quick-icon">
            <Building2 size={21} />
          </span>
          <div>
            <strong>Configuração fiscal</strong>
            <p>Emitente, regime declarado e endereço</p>
          </div>
          <ArrowUpRight size={17} />
        </Link>
        <Link href="/fiscal/revisao/">
          <span className="quick-icon">
            <ClipboardCheck size={21} />
          </span>
          <div>
            <strong>Revisar cadastros</strong>
            <p>Dados declarados de produtos e serviços</p>
          </div>
          <ArrowUpRight size={17} />
        </Link>
      </div>
      <section className="panel">
        <div className="list-toolbar">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Número, cliente ou modelo…"
            label="Buscar documentos fiscais"
          />
          <label className="field fiscal-filter">
            <span className="sr-only">Filtrar situação fiscal</span>
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">Todos os documentos</option>
              <option value="simulation">Minhas simulações</option>
              {Object.entries(fiscalStatusLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>DOCUMENTO</th>
                <th>CLIENTE / ORIGEM</th>
                <th>MODELO</th>
                <th>DATA</th>
                <th className="number">VALOR</th>
                <th>SITUAÇÃO</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id}>
                  <td className="strong">{doc.number}</td>
                  <td>
                    <div className="stack-cell">
                      <strong>{doc.customer}</strong>
                      <small>
                        {doc.snapshot?.sourceLabel ||
                          "Exemplo inicial · somente leitura"}
                      </small>
                    </div>
                  </td>
                  <td>{doc.model}</td>
                  <td>{dateLabel(doc.date)}</td>
                  <td className="number strong">{money(doc.total)}</td>
                  <td>
                    <Badge tone={tones[doc.status]}>{statusLabel(doc)}</Badge>
                  </td>
                  <td>
                    <button
                      className="icon-button"
                      aria-label={`Abrir documento ${doc.number}`}
                      onClick={() => openDocument(doc.id)}
                    >
                      <ArrowUpRight size={17} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!documents.length && (
          <EmptyState
            title="Nenhum documento encontrado"
            text="Prepare uma operação ou ajuste os filtros."
          />
        )}
        <PaginationInfo
          count={documents.length}
          noun="documentos demonstrativos"
        />
      </section>
      {preparing && (
        <PreparationModal
          initialSource={initialSource}
          onClose={closePreparation}
          onPrepared={openDocument}
        />
      )}
      {selectedDocument && (
        <DocumentModal
          key={selectedDocument.id}
          document={selectedDocument}
          onClose={closeDocument}
        />
      )}
    </>
  );
}

function PreparationModal({
  initialSource,
  onClose,
  onPrepared,
}: {
  initialSource: FiscalSource | null;
  onClose: () => void;
  onPrepared: (id: string) => void;
}) {
  const { state, prepareFiscal } = useDemo();
  const [key, setKey] = useState(initialSource ? sourceKey(initialSource) : "");
  const [model, setModel] = useState<FiscalModel>(
    initialSource?.type === "order" ? "NFS-e" : "NF-e",
  );
  const [error, setError] = useState("");
  const source = parseSource(key);
  const reviewed = source ? reviewPreparation(state, source, model) : null;
  const existing =
    source &&
    state.documents.find(
      (doc) =>
        doc.mode === "simulation" &&
        doc.source?.type === source.type &&
        doc.source.id === source.id &&
        doc.status !== "cancelled",
    );
  const order =
    source?.type === "order"
      ? state.orders.find((o) => o.id === source.id)
      : undefined;
  return (
    <Modal
      title="Preparar documento simulado"
      description="A conferência local verifica preenchimento e consistência. Não valida o enquadramento tributário."
      onClose={onClose}
      wide
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!source) return;
          try {
            onPrepared(prepareFiscal(source, model));
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <div className="form-grid">
          <Field label="Operação de origem">
            <select
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                setModel(
                  parseSource(e.target.value)?.type === "order"
                    ? "NFS-e"
                    : "NF-e",
                );
                setError("");
              }}
            >
              <option value="">Selecione uma venda ou OS</option>
              <optgroup label="Vendas de mercadorias">
                {state.sales.map((sale) => (
                  <option key={sale.id} value={`sale:${sale.id}`}>
                    Pedido #{sale.number} ·{" "}
                    {
                      state.customers.find((c) => c.id === sale.customerId)
                        ?.name
                    }
                  </option>
                ))}
              </optgroup>
              <optgroup label="Serviços de assistência">
                {state.orders.map((order) => (
                  <option key={order.id} value={`order:${order.id}`}>
                    OS #{order.number} ·{" "}
                    {
                      state.customers.find((c) => c.id === order.customerId)
                        ?.name
                    }
                  </option>
                ))}
              </optgroup>
            </select>
          </Field>
          <Field label="Modelo do documento">
            <select
              value={model}
              disabled={!source}
              onChange={(e) => setModel(e.target.value as FiscalModel)}
            >
              {source?.type === "order" ? (
                <option value="NFS-e">NFS-e · serviços</option>
              ) : (
                <>
                  <option value="NF-e">NF-e · mercadorias</option>
                  <option value="NFC-e">NFC-e · consumidor</option>
                </>
              )}
            </select>
          </Field>
        </div>
        {order && (
          <div className="notice notice-info">
            Esta simulação de NFS-e inclui somente {money(order.labor)} de
            serviço. Peças de {money(order.parts)} ficam fora do documento; sua
            operação de mercadorias continua pendente.
          </div>
        )}
        {existing ? (
          <div className="fiscal-preflight">
            <h3>Esta operação já possui documento ativo</h3>
            <p>
              Abra {existing.number} para acompanhar, consultar ou corrigir a
              tentativa. Trocar o modelo não cria uma segunda cobrança fiscal na
              demonstração.
            </p>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => onPrepared(existing.id)}
            >
              Abrir documento existente
            </button>
          </div>
        ) : (
          reviewed && (
            <div className="fiscal-preflight">
              <div className="fiscal-section-heading">
                <h3>Conferência local</h3>
                <Badge tone={reviewed.issues.length ? "warning" : "success"}>
                  {reviewed.issues.length
                    ? `${reviewed.issues.length} pendências`
                    : "Preenchimento completo"}
                </Badge>
              </div>
              {reviewed.issues.length ? (
                <ul className="fiscal-issue-links">
                  {reviewed.issues.map((item, index) => (
                    <li key={`${item.code}-${index}`}>
                      <Link href={item.href}>
                        {item.label}
                        <ArrowUpRight size={14} />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                reviewed.snapshot && (
                  <>
                    <p>
                      {reviewed.snapshot.sourceLabel} ·{" "}
                      {reviewed.snapshot.customer.name}
                    </p>
                    <p className="fiscal-total">
                      Valor da operação:{" "}
                      <strong>{money(reviewed.snapshot.total)}</strong>
                    </p>
                    <p className="muted">
                      Tributos não calculados. O rascunho guardará uma cópia dos
                      dados declarados; preencher todos os campos não comprova
                      aptidão para emissão real.
                    </p>
                  </>
                )
              )}
            </div>
          )
        )}
        <FormError message={error} />
        <div className="form-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={onClose}
          >
            Voltar
          </button>
          <button
            type="submit"
            className="button button-primary"
            disabled={!reviewed?.snapshot || !!existing}
          >
            Criar rascunho simulado
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DocumentModal({
  document: doc,
  onClose,
}: {
  document: FiscalDocument;
  onClose: () => void;
}) {
  const { fiscalAction, processFiscal } = useDemo();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<SimulationOutcome>("authorized");
  const [reason, setReason] = useState("");
  const action = (type: FiscalAction) => {
    try {
      fiscalAction(doc.id, type, reason);
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const process = async () => {
    setBusy(true);
    setError("");
    try {
      await processFiscal(doc.id, outcome);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const snapshot = doc.snapshot;
  return (
    <Modal
      title={`${doc.model} ${doc.number}`}
      description="Documento demonstrativo. Nenhuma ação desta janela emite ou cancela notas reais."
      onClose={onClose}
      wide
    >
      <div className="fiscal-section-heading">
        <Badge tone={tones[doc.status]}>{statusLabel(doc)}</Badge>
        <span className="muted">
          {doc.attempts || 0} tentativa(s) simulada(s)
        </span>
      </div>
      <dl className="details-list fiscal-summary">
        <div>
          <dt>Destinatário</dt>
          <dd>{doc.customer}</dd>
        </div>
        <div>
          <dt>Valor da operação</dt>
          <dd>{money(doc.total)}</dd>
        </div>
        <div>
          <dt>Origem</dt>
          <dd>{snapshot?.sourceLabel || "Exemplo sem vínculo operacional"}</dd>
        </div>
        <div>
          <dt>Cálculo de tributos</dt>
          <dd>Não implementado</dd>
        </div>
      </dl>
      {doc.mode !== "simulation" || !snapshot ? (
        <div className="notice notice-info">
          Este é um exemplo inicial, disponível somente para leitura. Use
          “Preparar documento” para testar uma operação com dados conferidos.
        </div>
      ) : (
        <>
          <div className="fiscal-operation" aria-busy={busy}>
            {doc.resultMessage && (
              <p className="notice notice-info">{doc.resultMessage}</p>
            )}
            {doc.status === "draft" && (
              <>
                <p>
                  Os dados foram copiados para este rascunho. Colocá-lo na fila
                  não movimenta estoque nem registra recebimento.
                </p>
                <button
                  className="button button-primary"
                  onClick={() => action("queue")}
                >
                  Colocar na fila simulada
                </button>
              </>
            )}
            {doc.status === "queued" && (
              <>
                <Field label="Resultado a simular">
                  <select
                    value={outcome}
                    onChange={(e) =>
                      setOutcome(e.target.value as SimulationOutcome)
                    }
                  >
                    <option value="authorized">Autorização fictícia</option>
                    <option value="rejected">Rejeição fictícia</option>
                    <option value="unknown">
                      Resposta desconhecida / timeout fictício
                    </option>
                  </select>
                </Field>
                <button
                  className="button button-primary"
                  disabled={busy}
                  onClick={process}
                >
                  Processar simulação
                </button>
                <p className="muted">
                  O cenário é escolhido para testar a interface. Não representa
                  uma resposta de autorizador.
                </p>
              </>
            )}
            {doc.status === "processing" && busy && (
              <p role="status">Processando cenário simulado…</p>
            )}
            {(doc.status === "unknown" ||
              (doc.status === "processing" && !busy)) && (
              <>
                <p>
                  Confirme o resultado antes de reenviar. Esta etapa representa
                  uma consulta; nenhuma consulta externa será realizada.
                </p>
                <div className="fiscal-action-row">
                  <button
                    className="button button-secondary"
                    onClick={() => action("reconcile_authorized")}
                  >
                    Simular consulta: autorizada
                  </button>
                  <button
                    className="button button-secondary"
                    onClick={() => action("reconcile_rejected")}
                  >
                    Simular consulta: rejeitada
                  </button>
                </div>
              </>
            )}
            {doc.status === "rejected" && (
              <>
                <p>
                  Revise os cadastros necessários. A nova tentativa usará os
                  dados atuais, manterá este documento e preservará as cópias
                  das tentativas anteriores.
                </p>
                <div className="fiscal-action-row">
                  <Link
                    className="button button-secondary"
                    href="/fiscal/revisao/"
                  >
                    Revisar cadastros
                  </Link>
                  <button
                    className="button button-primary"
                    onClick={() => action("retry")}
                  >
                    Revisar para nova tentativa
                  </button>
                </div>
              </>
            )}
            {doc.status === "authorized" && (
              <>
                <p>
                  Autorização fictícia. Não existe chave de acesso ou protocolo
                  fiscal válido.
                </p>
                <Field label="Justificativa do cancelamento simulado">
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    minLength={15}
                    maxLength={255}
                    placeholder="Descreva o motivo para testar o fluxo."
                  />
                </Field>
                <p className="muted">
                  Nesta demonstração: 15 a 255 caracteres. Regras e prazos do
                  autorizador serão integrados posteriormente.
                </p>
                <button
                  className="button button-secondary"
                  onClick={() => action("request_cancel")}
                >
                  Solicitar cancelamento simulado
                </button>
              </>
            )}
            {doc.status === "cancellation_pending" && (
              <>
                <p>
                  Solicitação registrada. O documento ainda aguarda a
                  confirmação fictícia do cancelamento.
                </p>
                <p className="muted">{doc.cancellationReason}</p>
                <button
                  className="button button-primary"
                  onClick={() => action("confirm_cancel")}
                >
                  Confirmar cancelamento fictício
                </button>
              </>
            )}
            {doc.status === "cancelled" && (
              <p>
                Cancelamento fictício concluído. Estoque e recebimentos
                permanecem como registrados na operação.
              </p>
            )}
            <FormError message={error} />
          </div>
          <details className="fiscal-form-details">
            <summary>Dados preservados do documento</summary>
            <div className="detail-card-content">
              <dl className="details-list">
                <div>
                  <dt>Emitente</dt>
                  <dd>{snapshot.company.legalName}</dd>
                </div>
                <div>
                  <dt>CNPJ declarado</dt>
                  <dd>{snapshot.company.cnpj}</dd>
                </div>
                <div>
                  <dt>Documento do destinatário</dt>
                  <dd>{snapshot.customer.document}</dd>
                </div>
              </dl>
              <ul className="fiscal-lines">
                {snapshot.lines.map((line, index) => (
                  <li key={index}>
                    <strong>{line.description}</strong>
                    <span>
                      {line.quantity} × {money(line.unitPrice)}
                    </span>
                    {line.productFiscal && (
                      <small>
                        NCM {line.ncm} · CFOP {line.productFiscal.cfop} ·
                        CST/CSOSN {line.productFiscal.taxSituation} · declarados
                      </small>
                    )}
                    {line.serviceFiscal && (
                      <small>
                        Código de serviço declarado:{" "}
                        {line.serviceFiscal.serviceCode}
                      </small>
                    )}
                  </li>
                ))}
              </ul>
              {snapshot.warnings.map((warning) => (
                <p className="muted" key={warning}>
                  {warning}
                </p>
              ))}
            </div>
          </details>
          <section className="fiscal-history">
            <h3>Histórico da simulação</h3>
            <ol>
              {doc.history?.map((event, index) => (
                <li key={`${event.at}-${index}`}>
                  <span className="status-dot" />
                  <div>
                    <strong>{event.label}</strong>
                    <time dateTime={event.at}>
                      {new Date(event.at).toLocaleString("pt-BR")}
                    </time>
                    {event.snapshot && (
                      <details>
                        <summary>Cópia dos dados desta etapa</summary>
                        <pre>{JSON.stringify(event.snapshot, null, 2)}</pre>
                      </details>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
      <div className="form-actions">
        <button className="button button-secondary" onClick={onClose}>
          Fechar documento
        </button>
      </div>
    </Modal>
  );
}
