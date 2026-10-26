"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import {
  Upload,
  FileCode2,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  RotateCcw,
} from "lucide-react";
import { useDemo, uid } from "@/lib/demo-store";
import { money, type Product } from "@/lib/domain";
import { Badge, FormError, PageHeader } from "@/components/ui";
import { buildPurchasePlan } from "@/lib/purchases/engine";
import { parsePurchaseXml, decimalCents } from "@/lib/purchases/xml";
import type {
  PurchaseDecision,
  PurchaseDocument,
  PurchasePlan,
  PurchasePlanLine,
} from "@/lib/purchases/types";

const example: PurchaseDocument = {
  key: "DEMO-XML-COMPRA-001",
  supplierId: "local-name:distribuidora exemplo de informatica",
  supplierName: "Distribuidora Exemplo de Informática",
  number: "Compra demonstrativa #001",
  items: [
    {
      id: "1",
      code: "CAB-USB-C",
      description: "Cabo USB-C · 1 metro",
      ncm: "85444200",
      unit: "UN",
      quantity: 10,
      costCents: 1590,
    },
    {
      id: "2",
      code: "HUB-USB",
      description: "Hub USB 3.0 · 4 portas",
      ncm: "84718000",
      unit: "UN",
      quantity: 5,
      costCents: 3490,
    },
    {
      id: "3",
      code: "SSD-480",
      description: "SSD Kingston A400 · 480 GB",
      ncm: "85235190",
      unit: "UN",
      quantity: 3,
      costCents: 18990,
    },
  ],
};
type DraftDecision = PurchaseDecision & {
  resolved: boolean;
  priceText?: string;
};
const actionValue = (decision?: DraftDecision) =>
  decision?.resolved
    ? decision.action === "link"
      ? decision.productId || ""
      : decision.action
    : "";
const sameUnit = (left: string, right: string) =>
  left.trim().toUpperCase() === right.trim().toUpperCase();

export function XmlImportPage() {
  const { state, confirmPurchase, hydrated } = useDemo();
  const [file, setFile] = useState<PurchaseDocument | null>(null);
  const [plan, setPlan] = useState<PurchasePlan | null>(null);
  const [decisions, setDecisions] = useState<Record<string, DraftDecision>>({});
  const [receive, setReceive] = useState(false);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [complete, setComplete] = useState(false);
  const [completedSummary, setCompletedSummary] = useState("");
  const [operationId, setOperationId] = useState("");
  const submitting = useRef(false);
  const [showResolved, setShowResolved] = useState(false);
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const decisionPatch = (id: string, patch: Partial<DraftDecision>) => {
    setDecisions((current) => ({
      ...current,
      [id]: { ...current[id], ...patch },
    }));
    setError("");
    // Editing a failed command creates a new identity; an unmodified retry reuses it.
    setOperationId(uid());
  };
  const previous =
    file &&
    state.purchasing?.documents.find((document) => document.key === file.key);
  const alreadyReceived = (lineId: string) =>
    state.purchasing?.receipts
      .filter((receipt) => receipt.documentKey === file?.key)
      .flatMap((receipt) => receipt.items)
      .filter((item) => item.lineId === lineId)
      .reduce((sum, item) => sum + item.quantity, 0) || 0;
  const remaining = (line: PurchasePlanLine) =>
    line.source.quantity - alreadyReceived(line.source.id);
  const loadDocument = (document: PurchaseDocument, isExample = false) => {
    const prepared = buildPurchasePlan(state, document);
    const recorded = state.purchasing?.documents.find(
      (entry) => entry.key === document.key,
    );
    const nextDecisions: Record<string, DraftDecision> = {};
    const nextOpened: Record<string, boolean> = {};
    for (const line of prepared.lines) {
      const old = recorded?.lines.find(
        (entry) => entry.source.id === line.source.id,
      );
      nextDecisions[line.source.id] = old
        ? {
            action: old.action,
            productId: old.productId,
            conversion: old.conversion,
            resolved: true,
          }
        : line.resolution === "known"
          ? {
              action: "link",
              productId: line.productId,
              conversion: line.conversion,
              resolved: true,
            }
          : {
              action: "new",
              name: line.name,
              category: line.category,
              attributes: line.attributes,
              resolved: line.resolution === "new",
            };
      nextOpened[line.source.id] = line.resolution === "review" && !old;
    }
    if (isExample) {
      nextDecisions["1"] = {
        ...nextDecisions["1"],
        resolved: true,
        priceCents: 3990,
        priceText: "39.90",
      };
      nextDecisions["2"] = {
        ...nextDecisions["2"],
        resolved: true,
        priceCents: 6990,
        priceText: "69.90",
      };
      const ssd = state.products.find((product) => product.id === "p1");
      if (ssd)
        nextDecisions["3"] = {
          action: "link",
          productId: ssd.id,
          resolved: true,
          conversion: 1,
        };
    }
    setFile(document);
    setPlan(prepared);
    setDecisions(nextDecisions);
    setOpened(nextOpened);
    setReceive(false);
    setError("");
    setComplete(false);
    setShowResolved(false);
    setOperationId(uid());
  };
  const unresolved =
    plan?.lines.filter((line) => !decisions[line.source.id]?.resolved) || [];
  const countNew =
    plan?.lines.filter(
      (line) =>
        decisions[line.source.id]?.resolved &&
        decisions[line.source.id].action === "new" &&
        !previous,
    ).length || 0;
  const countLinked =
    plan?.lines.filter(
      (line) =>
        decisions[line.source.id]?.resolved &&
        decisions[line.source.id].action === "link",
    ).length || 0;
  const countIgnored =
    plan?.lines.filter(
      (line) =>
        decisions[line.source.id]?.resolved &&
        decisions[line.source.id].action === "ignore",
    ).length || 0;
  const total =
    file?.totalCents ??
    file?.items.reduce(
      (sum, item) => sum + (item.totalCents ?? item.quantity * item.costCents),
      file.totalsAdjustmentCents || 0,
    ) ??
    0;
  const blockers = receive
    ? plan?.lines.filter((line) => {
        const decision = decisions[line.source.id];
        const product =
          decision?.productId &&
          state.products.find((entry) => entry.id === decision.productId);
        return (
          decision?.resolved &&
          decision.action !== "ignore" &&
          ((product && product.serialized) ||
            /\b(?:cores?\s+sortidas?|sortidos?)\b/i.test(
              line.source.description,
            ))
        );
      }) || []
    : [];
  const linesWithDecisions =
    plan?.lines.filter((line) => line.resolution === "review" && !previous) ||
    [];
  const resolvedLines =
    plan?.lines.filter((line) => !linesWithDecisions.includes(line)) || [];
  const submit = async () => {
    if (!file || !plan || submitting.current) return;
    if (unresolved.length) {
      setError(
        `Resolva as ${unresolved.length} dúvidas antes de confirmar o conjunto.`,
      );
      return;
    }
    if (blockers.length) {
      setError(
        "Há itens que exigem séries ou distribuição física de cores. Use Somente cadastrar; o recebimento desses itens continua pendente.",
      );
      return;
    }
    submitting.current = true;
    setSaving(true);
    setError("");
    try {
      // Yield the saving state before validating/persisting the batch.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      const inputDecisions: Record<string, PurchaseDecision> = {};
      for (const line of plan.lines) {
        const {
          resolved: _resolved,
          priceText,
          ...decision
        } = decisions[line.source.id];
        if (priceText?.trim()) decision.priceCents = decimalCents(priceText);
        else if (priceText === "") delete decision.priceCents;
        inputDecisions[line.source.id] = decision;
      }
      confirmPurchase({
        document: file,
        decisions: inputDecisions,
        receive,
        operationId,
        now: new Date().toISOString(),
      });
      setCompletedSummary(
        `${countNew} novos cadastros criados. ${countLinked} itens vinculados${countIgnored ? ` · ${countIgnored} ignorados` : ""}. ${receive ? "Recebimento registrado nas quantidades conferidas." : "Nenhuma entrada de estoque foi gerada."} Nenhum pagamento ou movimento de caixa foi criado.`,
      );
      setComplete(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível salvar a operação. O rascunho foi preservado.",
      );
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };
  const productCaption = (product: Product) =>
    [
      product.sku,
      product.name,
      product.attributes?.finish,
      product.attributes?.color,
      product.attributes?.magsafe === false ? "Sem MagSafe" : "",
    ]
      .filter(Boolean)
      .join(" · ");
  const lineDetails = (line: PurchasePlanLine) => {
    const decision = decisions[line.source.id];
    const source = line.source;
    const product = decision?.productId
      ? state.products.find((entry) => entry.id === decision.productId)
      : undefined;
    const needsConversion =
      decision?.action !== "ignore" &&
      (product
        ? !sameUnit(source.unit, product.unit)
        : !["UN", "PC", "PECA", "UND", "UNID"].includes(
            source.unit.toUpperCase(),
          ));
    return (
      <details
        className="purchase-line"
        key={source.id}
        open={Boolean(opened[source.id])}
        onToggle={(event) => {
          const isOpen = event.currentTarget.open;
          setOpened((current) =>
            current[source.id] === isOpen
              ? current
              : { ...current, [source.id]: isOpen },
          );
        }}
      >
        <summary className="purchase-line-header">
          <div>
            <strong>{product?.name || decision?.name || line.name}</strong>
            <div className="purchase-meta">
              {source.quantity} {source.unit} · {money(source.costCents)} por{" "}
              {source.unit} · {source.code}
            </div>
          </div>
          <Badge
            tone={
              !decision?.resolved
                ? "warning"
                : decision.action === "ignore"
                  ? "neutral"
                  : "success"
            }
          >
            {!decision?.resolved
              ? "Precisa de decisão"
              : decision.action === "new" && !previous
                ? "Novo cadastro proposto"
                : decision.action === "ignore"
                  ? "Ignorado"
                  : "Resolvido"}
          </Badge>
        </summary>
        {opened[source.id] && (
          <div className="purchase-line-body">
            <p className="purchase-meta">
              <strong>Descrição original:</strong> {source.description}
              <br />
              NCM {source.ncm || "não informado"} · GTIN{" "}
              {source.gtin || "não informado"}
            </p>
            <p>{line.reason}</p>
            <div className="form-grid">
              <label>
                Ação para {source.description}
                <select
                  value={actionValue(decision)}
                  disabled={Boolean(previous)}
                  onChange={(event) => {
                    const value = event.target.value;
                    decisionPatch(source.id, {
                      action:
                        value === "new" || value === "ignore" ? value : "link",
                      productId:
                        value === "new" || value === "ignore"
                          ? undefined
                          : value,
                      resolved: Boolean(value),
                      conversion:
                        value === "new" || value === "ignore"
                          ? undefined
                          : (() => {
                              const found = state.products.find(
                                (entry) => entry.id === value,
                              );
                              return found && sameUnit(source.unit, found.unit)
                                ? 1
                                : undefined;
                            })(),
                    });
                  }}
                >
                  <option value="" disabled>
                    Escolha o destino do item
                  </option>
                  <option value="new">Criar novo produto</option>
                  <option value="ignore">Não cadastrar este item</option>
                  {line.candidates.length > 0 && (
                    <optgroup label="Possíveis correspondências">
                      {line.candidates.map((id) => {
                        const candidate = state.products.find(
                          (entry) => entry.id === id,
                        );
                        return (
                          candidate && (
                            <option value={id} key={id}>
                              {productCaption(candidate)}
                            </option>
                          )
                        );
                      })}
                    </optgroup>
                  )}
                  <optgroup label="Catálogo da loja">
                    {state.products
                      .filter((entry) => !line.candidates.includes(entry.id))
                      .map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {productCaption(entry)}
                        </option>
                      ))}
                  </optgroup>
                </select>
              </label>
              {decision?.action === "new" && !previous && (
                <>
                  <label>
                    Nome comercial de {source.description}
                    <input
                      value={decision.name ?? line.name}
                      onChange={(event) =>
                        decisionPatch(source.id, { name: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Preço de venda de {source.description}
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Pendente; definir depois"
                      value={decision.priceText ?? ""}
                      onChange={(event) =>
                        decisionPatch(source.id, {
                          priceText: event.target.value,
                        })
                      }
                    />
                    <small>
                      Opcional para receber. Venda fica bloqueada enquanto o
                      preço estiver pendente.
                    </small>
                  </label>
                </>
              )}
              {needsConversion && (
                <label>
                  Unidades por {source.unit} de {source.description}
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={decision?.conversion ?? ""}
                    placeholder="Informe a conversão conferida"
                    onChange={(event) =>
                      decisionPatch(source.id, {
                        conversion: event.target.value
                          ? Number(event.target.value)
                          : undefined,
                      })
                    }
                  />
                </label>
              )}
              {receive && decision?.action !== "ignore" && (
                <label>
                  Quantidade recebida de {source.description}
                  <input
                    type="number"
                    min="0"
                    max={remaining(line)}
                    step="1"
                    value={decision.receivedQuantity ?? remaining(line)}
                    onChange={(event) =>
                      decisionPatch(source.id, {
                        receivedQuantity: event.target.value
                          ? Number(event.target.value)
                          : 0,
                      })
                    }
                  />
                  <small>
                    {remaining(line)} {source.unit} restantes neste documento.
                  </small>
                </label>
              )}
            </div>
            {!!Object.keys(line.attributes).length && (
              <p className="purchase-meta">
                Características extraídas:{" "}
                {Object.entries(line.attributes)
                  .map(
                    ([key, value]) =>
                      `${({ compatibleModels: "Modelos", material: "Material", finish: "Acabamento", color: "Cor", magsafe: "MagSafe", connectors: "Conectores", lengthMeters: "Metros", lensProtection: "Proteção de lente", border: "Borda", powerWatts: "Potência W" } as Record<string, string>)[key] || key}: ${Array.isArray(value) ? value.join(" / ") : typeof value === "boolean" ? (value ? "sim" : "não") : value}`,
                  )
                  .join(" · ")}
              </p>
            )}
          </div>
        )}
      </details>
    );
  };
  return (
    <>
      <Link href="/produtos/" className="back-link">
        <ArrowLeft size={16} />
        Voltar para produtos
      </Link>
      <PageHeader
        eyebrow="MENOS DIGITAÇÃO, MAIS CONTROLE"
        title="Importar produtos"
        description="Envie a nota inteira. Resolva somente as dúvidas e confirme o conjunto."
      />
      <div className="notice notice-info">
        <FileCode2 size={19} />
        <div>
          <strong>Demonstração local com XML fictício</strong>
          <p>
            A leitura não verifica assinatura, autorização ou destinatário da
            NF-e. O recebimento altera o estoque local somente após sua
            confirmação. Financeiro permanece pendente; nenhum pagamento é
            inferido.
          </p>
        </div>
      </div>
      <div className="purchase-workspace" aria-busy={reading || saving}>
        {complete ? (
          <section className="panel purchase-success">
            <CheckCircle2 size={38} />
            <h2>Importação concluída</h2>
            <p>{completedSummary}</p>
            <p className="purchase-meta">
              Documento {file?.number} · origem, vínculos e recebimentos
              preservados neste navegador.
            </p>
            <div className="purchase-actions">
              <button
                className="button button-secondary"
                onClick={() => {
                  setFile(null);
                  setPlan(null);
                  setDecisions({});
                  setComplete(false);
                  setError("");
                }}
              >
                <RotateCcw size={16} />
                Nova importação
              </button>
              <Link href="/produtos/" className="button button-primary">
                Ver produtos <ArrowRight size={16} />
              </Link>
            </div>
          </section>
        ) : !file ? (
          <section className="panel import-upload-panel">
            <div className="upload-zone">
              <span className="upload-icon">
                <Upload size={30} />
              </span>
              <h2>Comece pelo XML da nota de compra</h2>
              <p>Até 2 MB · de 1 a 500 itens · processamento neste navegador</p>
              <label
                className={`button button-primary file-button ${reading ? "is-loading" : ""}`}
              >
                <Upload size={17} />
                {reading ? "Lendo arquivo…" : "Selecionar arquivo XML"}
                <input
                  type="file"
                  accept=".xml,application/xml,text/xml"
                  disabled={reading || !hydrated}
                  onChange={async (event) => {
                    const input = event.currentTarget;
                    const selected = input.files?.[0];
                    if (!selected) return;
                    setReading(true);
                    setError("");
                    try {
                      if (selected.size > 2 * 1024 * 1024)
                        throw new Error("O arquivo deve ter no máximo 2 MB.");
                      await new Promise<void>((resolve) =>
                        requestAnimationFrame(() => resolve()),
                      );
                      loadDocument(parsePurchaseXml(await selected.text()));
                    } catch (cause) {
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : "Não foi possível ler o arquivo.",
                      );
                    } finally {
                      setReading(false);
                      input.value = "";
                    }
                  }}
                />
              </label>
              <span className="upload-or">ou</span>
              <button
                className="text-link"
                disabled={reading || !hydrated}
                onClick={() => loadDocument(structuredClone(example), true)}
              >
                Experimentar com uma nota de exemplo <ArrowRight size={15} />
              </button>
              {reading && (
                <p role="status">Lendo a nota e preparando os itens em lote…</p>
              )}
            </div>
            <FormError message={error} />
          </section>
        ) : (
          <>
            <section className="panel purchase-summary">
              <h2>{file.supplierName}</h2>
              <p>
                {file.number} · {file.items.length} itens · {money(total)} na
                origem
              </p>
              <div className="purchase-stats">
                <span>
                  <strong>
                    {(plan?.lines.length || 0) - unresolved.length}
                  </strong>{" "}
                  resolvidos
                </span>
                <span>
                  <strong>{countNew}</strong> novos propostos
                </span>
                <span>
                  <strong>{unresolved.length}</strong> precisam de decisão
                </span>
              </div>
              {previous && (
                <div className="notice notice-info">
                  Compra já cadastrada. Receba somente as quantidades restantes;
                  os vínculos originais são preservados.
                </div>
              )}
              <fieldset className="purchase-mode">
                <legend>O que deseja registrar?</legend>
                <label>
                  <input
                    type="radio"
                    name="purchase-mode"
                    checked={!receive}
                    onChange={() => {
                      setReceive(false);
                      setError("");
                      setOperationId(uid());
                    }}
                  />
                  Somente cadastrar
                </label>
                <label>
                  <input
                    type="radio"
                    name="purchase-mode"
                    checked={receive}
                    onChange={() => {
                      setReceive(true);
                      setError("");
                      setOperationId(uid());
                    }}
                  />
                  Registrar recebimento
                </label>
              </fieldset>
              <p>
                {receive
                  ? "Ao confirmar, você declara a conferência física das quantidades apresentadas. Para faltas ou divergências, ajuste somente as linhas necessárias nos detalhes."
                  : "Cria os cadastros e guarda os vínculos. Estoque permanece inalterado."}
              </p>
              <p className="purchase-meta">
                {countNew} novos cadastros · {countLinked} vínculos ·{" "}
                {countIgnored} ignorados. Preços existentes são preservados;
                novos produtos sem preço ficam pendentes. Nenhuma conta a pagar,
                pagamento ou saída de caixa será criada.
              </p>
              {blockers.length > 0 && (
                <div className="notice notice-warning">
                  {blockers.length} itens exigem séries ou distribuição de
                  cores. O recebimento está bloqueado; você pode somente
                  cadastrar.
                </div>
              )}
              <FormError message={error} />
              <div className="purchase-actions">
                <button
                  className="button button-primary"
                  disabled={saving || reading}
                  onClick={submit}
                >
                  <Check size={16} />
                  {saving
                    ? "Salvando…"
                    : receive
                      ? "Confirmar recebimento"
                      : "Confirmar cadastros"}
                </button>
                <button
                  className="button button-secondary"
                  disabled={saving}
                  onClick={() => {
                    setFile(null);
                    setPlan(null);
                    setError("");
                  }}
                >
                  Trocar arquivo
                </button>
              </div>
            </section>
            {linesWithDecisions.length > 0 && (
              <section aria-label="Dúvidas da importação">
                <h2>Decisões necessárias</h2>
                <p>
                  Resolva aqui, sem sair da nota. As outras escolhas permanecem
                  preenchidas.
                </p>
                {linesWithDecisions.map(lineDetails)}
              </section>
            )}
            {resolvedLines.length > 0 && (
              <section aria-label="Itens resolvidos">
                <button
                  className="text-link"
                  onClick={() => setShowResolved((value) => !value)}
                  aria-expanded={showResolved}
                >
                  {showResolved ? "Ocultar" : "Consultar ou ajustar"}{" "}
                  {resolvedLines.length} itens resolvidos
                </button>
                {showResolved && <div>{resolvedLines.map(lineDetails)}</div>}
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}
