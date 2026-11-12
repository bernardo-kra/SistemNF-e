"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { accessRequest, accessBase, accessDate, AccessError, type AccessIdentity } from "@/lib/access-api";
import { useWorkspace } from "./workspace-session";
import { Field, Modal, PageHeader } from "@/components/ui";
import { money, connectedStages as stages, type ConnectedStage as Stage } from "@/lib/domain";
import { orderReturnReasons, type OrderReturnReason } from "../../shared/order-return.mjs";
import { orderApprovalChannels, type OrderBudgetRevision } from "../../shared/order-budget.mjs";
import { parsePurchaseXml } from "@/lib/purchases/xml";
import type { PurchaseDocument, PurchaseDecision, PurchasePlan } from "@/lib/purchases/types";
import { CheckoutEditor } from "./checkout";
import { AgreementEditor, FinancePanel, ReceiveEditor, ReceiptDialog } from "./finance-live";
import { SaleItemPricing, SaleTotals, saleLineAmounts } from "./sale-item-pricing";
import { CustomerPicker, type CustomerChoice } from "./customer-picker";
import { ProductPicker, type ProductChoice } from "./product-picker";
import { LiveOrderReceipt } from "./live-order-receipt";
import styles from "./access-control.module.css";
import op from "./operations-page.module.css";

type Row = Record<string, any>;
export type Resource = "products" | "stock" | "sales" | "orders" | "purchases" | "finance";
type PageData = { tenantId: string; items: Row[]; total: number; limit: number; offset: number };
type Editor = { kind: "product" | "stock" | "sale" | "order" | "editOrder" | "approveOrder" | "assignOrder" | "deliverOrder" | "returnOrder" | "prices" | "agreement"; row?: Row };
const labels: Record<Resource, string> = { products: "Produtos", stock: "Estoque", sales: "Vendas", orders: "Ordens de serviço", purchases: "Compras", finance: "Financeiro" };
const types: Record<Resource, string> = { products: "product", stock: "stock", sales: "sale", orders: "order", purchases: "purchase", finance: "payment" };
const resourceRights: Record<Resource, string> = { products: "products.read", stock: "stock.read", sales: "sales.read", orders: "orders.read", purchases: "purchases.read", finance: "finance.read" };
const statuses: Record<Resource, { value: string; label: string }[]> = {
  products: [{ value: "active", label: "Ativos" }, { value: "inactive", label: "Inativos" }, { value: "pending", label: "Preço pendente" }],
  stock: [{ value: "available", label: "Com disponível" }, { value: "reserved", label: "Com reservas" }],
  sales: [{ value: "confirmed", label: "Confirmadas" }, { value: "delivered", label: "Entregues" }],
  orders: Object.entries(stages).map(([value, entry]) => ({ value, label: entry.label })),
  purchases: [{ value: "pending", label: "Sem recebimento" }, { value: "partial", label: "Parciais" }, { value: "received", label: "Recebidas" }],
  finance: [],
};
const endpoint = (tenant: string) => `${accessBase(tenant)}/operations`;
const message = (error: unknown) => error instanceof Error ? error.message : "Não foi possível concluir a operação.";
const amount = (raw: string) => {
  if (!raw.trim()) return null;
  if (!/^\d+(?:[,.]\d{1,2})?$/.test(raw.trim())) throw new Error("Informe o valor com até duas casas decimais.");
  const [whole, fraction = ""] = raw.trim().split(/[,.]/); const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result)) throw new Error("Valor fora do limite suportado."); return result;
};
const priceText = (value: number | null | undefined) => value == null ? "" : (value / 100).toFixed(2).replace(".", ",");
function trap(event: React.KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;
  const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]')].filter((item) => item.getClientRects().length);
  const first = controls[0], last = controls.at(-1);
  if (!first || !last) { event.preventDefault(); return; }
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

export function OperationsPage({ resource = "products" }: { resource?: Resource }) {
  const { identity, phase, tenant, handleError } = useWorkspace();
  const [page, setPage] = useState<PageData | null>(null), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [query, setQuery] = useState(""), [search, setSearch] = useState(""), [status, setStatus] = useState("all"), [sort, setSort] = useState("name"), [dateField, setDateField] = useState("created"), [from, setFrom] = useState(""), [to, setTo] = useState(""), [offset, setOffset] = useState(0), [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<Editor | null>(null), [history, setHistory] = useState<{ row: Row; type: string } | null>(null), [busy, setBusy] = useState(false);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [receiveOrder, setReceiveOrder] = useState<Row | null>(null), [paymentReceipt, setPaymentReceipt] = useState<Row | null>(null);
  const generation = useRef(0), opener = useRef<HTMLElement | null>(null);
  const company = identity?.tenants.find((entry) => entry.id === tenant), rights = company?.permissions ?? [];
  const allowed = (permission: string) => rights.includes(permission);
  const clear = useCallback(() => { setPage(null); setEditor(null); setHistory(null); setReceiptId(null); setReceiveOrder(null); setPaymentReceipt(null); setNotice(""); setQuery(""); setSearch(""); setStatus("all"); setSort("name"); setDateField("created"); setFrom(""); setTo(""); setOffset(0); }, []);
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => { const timer = setTimeout(() => setSearch(query), 300); return () => clearTimeout(timer); }, [query]);
  const fail = useCallback((failure: unknown) => {
    if (failure instanceof AccessError && [401,403].includes(failure.status)) { generation.current++; clear(); handleError(failure); }
    else setError(message(failure));
  }, [clear, handleError]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const kind = resource === "products" ? "product" : resource === "sales" ? "sale" : resource === "orders" ? "order" : null;
    const right = resource === "products" ? "products.create" : resource === "sales" ? "sales.create" : "orders.create";
    if (params.has("novo") && kind && rights.includes(right)) { setEditor({ kind }); params.delete("novo"); window.history.replaceState(null,"",window.location.pathname+(params.size ? "?"+params.toString() : "")); }
  }, []);
  useEffect(() => {
    setPage(null); if (phase !== "ready" || !tenant || resource === "finance" || !rights.includes(resourceRights[resource])) return;
    const controller = new AbortController(), tag = generation.current;
    const params = new URLSearchParams({ q: search, status, sort, dateField, limit: "25", offset: String(offset) }); if (from) params.set("from", from); if (to) params.set("to", to);
    void accessRequest<PageData>(`${endpoint(tenant)}/${resource}?${params}`, { signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted && tag === generation.current) { if (data.tenantId !== tenant || !Array.isArray(data.items)) throw new AccessError(503); setPage(data); }
    }).catch((failure) => { if (!controller.signal.aborted && tag === generation.current) fail(failure); });
    return () => controller.abort();
  }, [tenant, resource, phase, search, status, sort, dateField, from, to, offset, revision, rights, fail]);
  function open(next: Editor, element: HTMLElement) { opener.current = element; setNotice(""); setEditor(next); }
  function close() { setEditor(null); setHistory(null); requestAnimationFrame(() => opener.current?.focus()); }
  function saved(text = "Operação confirmada.") { close(); setNotice(text); setError(""); setRevision((value) => value + 1); }
  async function immediate(type: string, data: Row) {
    if (busy) return; const tag = generation.current; setBusy(true); setError("");
    try { await accessRequest(`${endpoint(tenant)}/commands`, { method: "POST", body: { requestId: crypto.randomUUID(), type, data } }); if (tag === generation.current) saved(); }
    catch (failure) { if (tag === generation.current) fail(failure); } finally { setBusy(false); }
  }
  return <><PageHeader eyebrow="ROTINA DA LOJA" title={labels[resource]} description="Cadastros e atendimentos da sua empresa." />
        {error && <p className={styles.error} role="alert">{error}</p>}{notice && <p role="status" className={styles.notice}>{notice}</p>}
        {!tenant ? <p>Selecione uma empresa para continuar.</p> : !rights.some((right) => Object.values(resourceRights).includes(right)) ? <p>Seu perfil não permite acessar a operação.</p> : <>
          {resource === "finance" ? <FinancePanel key={tenant} tenant={tenant} actorId={identity!.user.id} rights={rights} onUnauthorized={fail} /> : <section className={styles.panel}><div className={styles.panelHeader}><div><h2>{labels[resource]}</h2><p>{resource === "stock" ? "Físico, reservado e disponível têm a mesma origem." : "Histórico e horário registrados automaticamente ao confirmar."}</p></div>
            <div className={op.headerActions}>
            {resource === "products" && allowed("products.create") && <button className="button button-primary" onClick={(event) => open({ kind: "product" }, event.currentTarget)}>Novo produto</button>}
            {resource === "products" && allowed("products.update") && allowed("products.cost.read") && <button className="button button-secondary" onClick={(event) => open({ kind: "prices" }, event.currentTarget)}>Precificar pendentes</button>}
            {resource === "sales" && allowed("sales.create") && <button className="button button-primary" onClick={(event) => open({ kind: "sale" }, event.currentTarget)}>Nova venda</button>}
            {resource === "orders" && allowed("orders.create") && <button className="button button-primary" onClick={(event) => open({ kind: "order" }, event.currentTarget)}>Nova OS</button>}
            </div>
          </div>
            {resource === "purchases" && allowed("purchases.import") && <PurchaseImport key={tenant} tenant={tenant} generation={generation} onSaved={() => saved("Compra confirmada.")} onUnauthorized={fail} canReceive={allowed("purchases.receive")} />}
            <div className={styles.filters}><Field label="Buscar"><input placeholder={resource === "orders" ? "Número, cliente ou equipamento" : "Nome, número ou referência"} maxLength={100} value={query} onChange={(event) => { setQuery(event.target.value); setOffset(0); }} /></Field>
              <Field label="Status"><select aria-label="Status" value={status} onChange={(event) => { setStatus(event.target.value); setOffset(0); }}><option value="all">Todos</option>{statuses[resource].map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}</select></Field>
              <Field label="Ordenar por"><select aria-label="Ordenar por" value={sort} onChange={(event) => { setSort(event.target.value); setOffset(0); }}><option value="name">Nome ou número</option><option value="created">Últimos cadastros</option><option value="updated">Últimas alterações</option></select></Field><button className="button button-secondary" onClick={() => { setQuery(""); setSearch(""); setStatus("all"); setFrom(""); setTo(""); setOffset(0); }}>Limpar filtros</button></div>
            <details className={styles.dates}><summary>Filtrar por período</summary><div className={styles.dateFields}><Field label="Data"><select aria-label="Data" value={dateField} onChange={(event) => { setDateField(event.target.value); setOffset(0); }}><option value="created">Criado em</option><option value="updated">Alterado em</option></select></Field><Field label="De"><input type="date" value={from} max={to || undefined} onChange={(event) => { setFrom(event.target.value); setOffset(0); }} /></Field><Field label="Até"><input type="date" value={to} min={from || undefined} onChange={(event) => { setTo(event.target.value); setOffset(0); }} /></Field></div></details>
            {!page ? <p className={styles.empty} role="status">{error ? "Consulta não concluída." : "Carregando…"}</p> : !page.items.length ? <p className={styles.empty}>Nenhum registro encontrado. Os dados da demonstração não são copiados para esta empresa.</p> : <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>{resource === "products" || resource === "stock" ? "Produto" : "Referência"}</th>
              {resource === "products" ? <>{allowed("products.cost.read") && <th>Compra</th>}<th>Venda</th>{allowed("products.cost.read") && <th>Lucro estimado</th>}</> : resource === "stock" ? <><th>Físico</th><th>Reservado</th><th>Disponível</th></> : <><th>Situação</th><th>{resource === "orders" ? "Serviço" : "Total"}</th></>}
              <th>Alteração</th><th>Ações</th></tr></thead><tbody>{page.items.map((row) => {
                const title = row.name ?? `${resource === "orders" ? "OS" : resource === "sales" ? "Venda" : "Compra"} ${row.number}`;
                return <tr key={row.id}><td><strong>{title}</strong><small>{row.sku ?? row.customerName ?? row.supplierName}{row.equipment ? ` · ${row.equipment}` : ""}</small>{row.finance && <small>Recebido {money(row.finance.paidCents)} · Em aberto {money(row.finance.outstandingCents)}</small>}
                  {resource === "sales" && Array.isArray(row.items) && <details className={op.saleDetails}><summary>Itens da venda ({row.items.length})</summary><ul>{row.items.map((item: Row, index: number) => <li key={`${item.productId ?? "legacy"}:${index}`}>
                    <strong>{item.name}</strong><span>{item.quantity} × {money(item.unitPriceCents)} · Desconto: {money(item.discountCents ?? 0)} · Subtotal: {money(item.totalCents ?? item.quantity * item.unitPriceCents - (item.discountCents ?? 0))}</span>
                  </li>)}</ul><p>Descontos da venda: {money(row.discountCents ?? 0)} · Total: {money(row.totalCents)}</p></details>}
                </td>
                  {resource === "products" ? <>{allowed("products.cost.read") && <td>{row.costCents == null ? "Pendente" : money(row.costCents)}</td>}<td>{row.salePriceCents == null ? "Pendente" : money(row.salePriceCents)}</td>{allowed("products.cost.read") && <td>{row.costCents == null || row.salePriceCents == null ? "Não calculado" : money(row.salePriceCents - row.costCents)}</td>}</> : resource === "stock" ? <><td>{row.physical}</td><td>{row.reserved}</td><td>{row.available}</td></> : <><td>{resource === "orders" ? stages[row.stage as Stage]?.label : resource === "sales" ? row.status === "delivered" ? "Entregue" : "Confirmada" : row.status === "received" ? "Recebida" : row.status === "partial" ? "Parcial" : "Sem recebimento"}{resource === "orders" && <small>{row.technicianName ?? "Técnico a definir"}</small>}</td><td>{resource === "orders" ? (row.laborCents == null ? "Orçamento pendente" : money(row.laborCents)) : resource === "sales" ? money(row.totalCents) : row.document?.totalCents == null ? "—" : money(row.document.totalCents)}</td></>}
                  <td>{accessDate(row.updatedAt)}<small>Cadastro: {accessDate(row.createdAt)}</small></td><td><div className={op.actions}>
                    {resource === "orders" && allowed("orders.read") && <button aria-label={`Imprimir comprovante da OS ${row.number}`} onClick={(event) => { opener.current = event.currentTarget; setReceiptId(row.id); }}>Imprimir comprovante</button>}
                    {resource === "orders" && row.agreementId && row.finance?.outstandingCents > 0 && allowed("finance.read") && allowed("finance.receive") && <button onClick={(event) => { opener.current = event.currentTarget; setReceiveOrder(row); }}>Receber OS {row.number}</button>}
                    {resource === "products" && allowed("products.update") && <button onClick={(event) => open({ kind: "product", row }, event.currentTarget)}>Editar produto</button>}
                    {(resource === "stock" || resource === "products") && allowed("stock.receive") && <button onClick={(event) => open({ kind: "stock", row }, event.currentTarget)}>Registrar entrada</button>}
                    {resource === "sales" && row.status === "confirmed" && allowed("sales.deliver") && <button disabled={busy} onClick={() => void immediate("sale.deliver", { id: row.id, version: row.version })}>Entregar venda</button>}
                    {(resource === "sales" || (resource === "orders" && row.approved && row.laborCents > 0)) && !row.agreementId && allowed("finance.agreements.create") && <button onClick={(event) => open({ kind: "agreement", row: { ...row, sourceType: types[resource] } }, event.currentTarget)}>Combinar pagamento</button>}
                    {resource === "orders" && row.returnWithoutRepair && <p>Devolvida a {row.returnWithoutRepair.recipientName} · {orderReturnReasons[row.returnWithoutRepair.reason as OrderReturnReason]} · {accessDate(row.returnWithoutRepair.at)}</p>}
                    {resource === "orders" && !["delivered", "closed_without_repair"].includes(row.stage) && <>
                      {allowed("orders.update") && <button onClick={(event) => open({ kind: "editOrder", row }, event.currentTarget)}>Editar OS</button>}
                      {row.stage === "awaiting_approval" && !row.approved && allowed("orders.update") && <><button disabled={busy || row.laborCents == null} onClick={(event) => open({ kind: "approveOrder", row }, event.currentTarget)}>Registrar aprovação</button>{row.laborCents == null && <p>Defina a mão de obra em Editar OS antes de registrar a aprovação.</p>}</>}
                      {row.stage === "quality_check" && !row.tested && allowed("orders.update") && <button disabled={busy} onClick={() => void immediate("order.update", { id: row.id, version: row.version, tested: true })}>Registrar testes concluídos</button>}
                      {row.stage !== "ready_for_pickup" && allowed("orders.advance") && (row.stage === "received" && !row.technicianId ? allowed("orders.update") ? <button disabled={busy} onClick={(event) => open({ kind: "assignOrder", row }, event.currentTarget)}>Iniciar diagnóstico</button> : <p>Peça a quem pode editar a OS para definir o técnico antes do diagnóstico.</p> : <button disabled={busy || (row.stage === "awaiting_approval" && !row.approved) || (row.stage === "quality_check" && !row.tested)} onClick={() => void immediate("order.advance", { id: row.id, version: row.version })}>Avançar etapa</button>)}
                      {row.stage === "ready_for_pickup" && allowed("orders.deliver") && <button onClick={(event) => open({ kind: "deliverOrder", row }, event.currentTarget)}>Entregar equipamento</button>}
                      {!row.approved && !row.tested && !row.agreementId && ["received", "diagnosing", "awaiting_approval"].includes(row.stage) && allowed("orders.deliver") && <button onClick={(event) => open({ kind: "returnOrder", row }, event.currentTarget)}>Devolver sem reparo</button>}
                    </>}
                    {allowed("audit.read") && <button aria-label={`Histórico de ${title}`} onClick={(event) => { opener.current = event.currentTarget; setHistory({ row, type: types[resource] }); }}>Histórico</button>}
                  </div></td></tr>;
              })}</tbody></table></div>}
            {page && <div className={styles.footer}><span>{page.total} registros</span><div><button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 25))}>Anterior</button><button disabled={offset + 25 >= page.total} onClick={() => setOffset(offset + 25)}>Próxima</button></div></div>}
          </section>}
        </>}

      {editor && (editor.kind === "prices" ? <PricesEditor key={tenant} tenant={tenant} onClose={close} onSaved={saved} onUnauthorized={fail} /> : editor.kind === "agreement" ? <AgreementEditor tenant={tenant} source={editor.row!} onClose={close} onSaved={saved} onUnauthorized={fail} /> : editor.kind === "sale" && allowed("finance.agreements.create") ? <CheckoutEditor key={tenant} tenant={tenant} actorId={identity!.user.id} rights={rights} auxiliary={AuxiliaryForm} onClose={close} onSaved={saved} onUnauthorized={fail} /> : <OperationEditor key={`${tenant}:${editor.kind}:${editor.row?.id ?? "new"}`} tenant={tenant} editor={editor} rights={rights} onClose={close} onSaved={saved} onUnauthorized={fail} generation={generation} />)}
      {history && <HistoryDialog key={`${tenant}:${history.row.id}`} tenant={tenant} value={history} onClose={close} onUnauthorized={fail} />}
      {receiptId && <LiveOrderReceipt key={`${tenant}:${receiptId}`} tenant={tenant} orderId={receiptId} onClose={() => { setReceiptId(null); requestAnimationFrame(() => opener.current?.focus()); }} />}
      {receiveOrder && <ReceiveEditor key={`${tenant}:${receiveOrder.id}`} tenant={tenant} actorId={identity!.user.id} rights={rights} customer={{ customerId: receiveOrder.customerId, customerName: receiveOrder.customerName }} source={{ type: "order", id: receiveOrder.id, label: `OS ${receiveOrder.number}` }} onUnauthorized={fail} onClose={() => { setReceiveOrder(null); requestAnimationFrame(() => opener.current?.focus()); }} onSaved={(payment) => { setReceiveOrder(null); setPaymentReceipt(payment); setRevision((old) => old + 1); }} />}
      {paymentReceipt && <ReceiptDialog payment={paymentReceipt} onClose={() => { setPaymentReceipt(null); requestAnimationFrame(() => { if (opener.current?.isConnected) opener.current.focus(); else document.querySelector<HTMLElement>("main button")?.focus(); }); }} />}
  </>;
}

function OperationEditor({ tenant, editor, rights, onClose, onSaved, onUnauthorized, generation }: { tenant: string; editor: Editor; rights: string[]; onClose: () => void; onSaved: (text?: string) => void; onUnauthorized: (error: unknown) => void; generation: React.RefObject<number> }) {
  const row = editor.row, [draft, setDraft] = useState<Row>({ sku: row?.sku ?? "", name: row?.name ?? "", category: row?.category ?? "Geral", cost: priceText(row?.costCents), price: priceText(row?.salePriceCents), quantity: "1", reference: "", customerId: "", technicianId: row?.technicianId ?? "", equipment: "", issue: "", diagnosis: row?.diagnosis ?? "", budgetScope: row?.budgetScope ?? row?.issue ?? "", due: row?.due ?? "", labor: priceText(row?.laborCents), active: row?.active ?? true, serialized: row?.serialized ?? false, allowUnsettled: false });
  const [items, setItems] = useState<{ key: string; productId: string; quantity: number; discount?: string }[]>([{ key: crypto.randomUUID(), productId: "", quantity: 1 }]), [products, setProducts] = useState<Row[]>([]), [technicians, setTechnicians] = useState<Row[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerChoice | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [auxiliary, setAuxiliary] = useState<"customer" | "technician" | "product" | null>(null);
  const attempt = useRef<{ content: string; id: string } | null>(null), alive = useRef(true), tag = useRef(generation.current);
  const has = (permission: string) => rights.includes(permission), set = (key: string, value: any) => setDraft((previous) => ({ ...previous, [key]: value }));
  const [returnReason, setReturnReason] = useState(""), [returnDetails, setReturnDetails] = useState(""), [otherRecipient, setOtherRecipient] = useState(false), [recipientName, setRecipientName] = useState(""), [returnAuthorization, setReturnAuthorization] = useState("");
  const [approvalChannel, setApprovalChannel] = useState(""), [approvalReference, setApprovalReference] = useState("");
  let saleTotal = 0, saleGross = 0, saleDiscount = 0, salePricingError = "";
  if (editor.kind === "sale") { try { for (const item of items) {
    const values = saleLineAmounts(products.find((product) => product.id === item.productId)?.salePriceCents ?? 0, item.quantity, item.discount);
    saleTotal += values.totalCents; saleGross += values.grossCents; saleDiscount += values.discountCents;
    if (![saleTotal, saleGross, saleDiscount].every(Number.isSafeInteger)) throw new Error("O total excede o limite suportado.");
  } } catch (failure) { salePricingError = (failure as Error).message; } }
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const invalidated = () => !alive.current || tag.current !== generation.current;
  useEffect(() => {
    if (!["order", "editOrder", "assignOrder"].includes(editor.kind)) return; const controller = new AbortController();
    void accessRequest<PageData>(`${endpoint(tenant)}/technicians?limit=100`, { signal: controller.signal }).then((data) => { if (!controller.signal.aborted && !invalidated()) setTechnicians(data.items); }).catch((failure) => { if (!controller.signal.aborted && !invalidated()) setError(message(failure)); }); return () => controller.abort();
  }, [tenant, editor.kind]);
  function submission(): { type: string; data: Row } {
    if (editor.kind === "product") {
      const data: Row = { ...(row ? { id: row.id, version: row.version } : {}), sku: draft.sku, name: draft.name, category: draft.category, salePriceCents: amount(draft.price), serialized: draft.serialized };
      if (has("products.cost.read")) data.costCents = amount(draft.cost); if (row && has("products.archive")) data.active = draft.active;
      return { type: row ? "product.update" : "product.create", data };
    }
    if (editor.kind === "stock") return { type: "stock.receive", data: { productId: row?.productId ?? row?.id, quantity: Number(draft.quantity), reference: draft.reference } };
    if (editor.kind === "sale") return { type: "sale.confirm", data: { customerId: draft.customerId, items: items.map((item) => ({ productId: item.productId, quantity: item.quantity, version: products.find((product) => product.id === item.productId)?.version, ...(item.discount === undefined ? {} : { discountCents: saleLineAmounts(products.find((product) => product.id === item.productId)?.salePriceCents ?? 0, item.quantity, item.discount).discountCents }) })) } };
    if (editor.kind === "order") return { type: "order.create", data: { customerId: draft.customerId, technicianId: draft.technicianId || null, equipment: draft.equipment, issue: draft.issue, due: draft.due || null, laborCents: amount(draft.labor) } };
    if (editor.kind === "assignOrder") return { type: "order.advance", data: { id: row?.id, version: row?.version, technicianId: draft.technicianId } };
    if (editor.kind === "editOrder") return { type: "order.update", data: { id: row?.id, version: row?.version, technicianId: draft.technicianId || null, diagnosis: draft.diagnosis, due: draft.due || null, laborCents: amount(draft.labor), budgetScope: draft.budgetScope } };
    if (editor.kind === "approveOrder") return { type: "order.approve", data: { id: row?.id, version: row?.version, budgetRevision: row?.budgetRevision ?? 0, channel: approvalChannel, ...(approvalReference.trim() ? { reference: approvalReference.trim() } : {}) } };
    if (editor.kind === "returnOrder") return { type: "order.return_without_repair", data: { id: row?.id, version: row?.version, reason: returnReason, ...(returnReason === "other" ? { details: returnDetails } : {}), recipient: otherRecipient ? { type: "other", name: recipientName.trim(), authorization: returnAuthorization.trim() } : { type: "customer" }, confirmed: true } };
    return { type: "order.deliver", data: { id: row?.id, version: row?.version, allowUnsettled: draft.allowUnsettled } };
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy || (["sale", "order"].includes(editor.kind) && !draft.customerId)) return; setBusy(true); setError("");
    try { const input = submission(), content = JSON.stringify(input); if (attempt.current?.content !== content) attempt.current = { content, id: crypto.randomUUID() };
      await accessRequest(`${endpoint(tenant)}/commands`, { method: "POST", body: { requestId: attempt.current!.id, ...input } }); if (!invalidated()) onSaved();
    } catch (failure) { if (!invalidated()) { if (failure instanceof AccessError && [401, 403].includes(failure.status)) onUnauthorized(failure); else setError(message(failure)); } }
    finally { if (!invalidated()) setBusy(false); }
  }
  const titles: Record<Editor["kind"], string> = { product: row ? "Editar produto" : "Novo produto", stock: "Registrar entrada", sale: "Nova venda", order: "Nova OS", editOrder: "Editar OS", approveOrder: "Registrar aprovação", assignOrder: "Iniciar diagnóstico", deliverOrder: "Entregar equipamento", returnOrder: "Devolver equipamento sem reparo", prices: "Preços", agreement: "Pagamento" };
  const saveLabel = editor.kind === "approveOrder" ? "Confirmar aprovação" : editor.kind === "assignOrder" ? "Iniciar diagnóstico" : editor.kind === "returnOrder" ? `Confirmar devolução a ${otherRecipient ? recipientName.trim() || "outra pessoa" : row?.customerName}` : editor.kind === "product" ? "Salvar produto" : editor.kind === "sale" ? "Confirmar venda" : editor.kind === "stock" ? "Confirmar entrada" : editor.kind === "deliverOrder" ? "Confirmar entrega" : "Salvar OS";
  return <Modal title={titles[editor.kind]} onClose={() => { if (!busy) onClose(); }} onCancel={(event) => { if (busy) event.preventDefault(); else onClose(); }} onKeyDown={trap} wide={editor.kind === "sale"}>
    <form onSubmit={(event) => void submit(event)}><fieldset className={op.form} disabled={busy || Boolean(auxiliary)}>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {editor.kind === "product" && <><Field label="SKU"><input required={Boolean(row)} placeholder="Automático ao salvar" maxLength={80} value={draft.sku} onChange={(event) => set("sku", event.target.value)} /></Field><Field label="Nome"><input required maxLength={160} value={draft.name} onChange={(event) => set("name", event.target.value)} /></Field><Field label="Tipo"><input required maxLength={80} value={draft.category} onChange={(event) => set("category", event.target.value)} /></Field>
        {has("products.cost.read") && <Field label="Preço de compra"><input inputMode="decimal" value={draft.cost} onChange={(event) => set("cost", event.target.value)} /></Field>}<Field label="Preço de venda"><input inputMode="decimal" placeholder="Pendente" value={draft.price} onChange={(event) => set("price", event.target.value)} /></Field>
        {has("products.cost.read") && <p className={styles.note}>Lucro estimado: {(() => { try { const cost = amount(draft.cost), price = amount(draft.price); return cost == null || price == null ? "Não calculado" : `${money(price - cost)}${price ? ` · Margem ${((price - cost) / price * 100).toFixed(2)}%` : ""}`; } catch { return "Confira os valores"; } })()} · Antes de impostos e despesas.</p>}
        <label><input type="checkbox" checked={draft.serialized} onChange={(event) => set("serialized", event.target.checked)} /> Controle por série (recebimento e venda ainda indisponíveis)</label>
        {row && has("products.archive") && <label><input type="checkbox" checked={draft.active} onChange={(event) => set("active", event.target.checked)} /> Produto ativo</label>}
      </>}
      {editor.kind === "stock" && <><p>{row?.name}</p><Field label="Quantidade"><input type="number" min={1} max={1000000} step={1} required value={draft.quantity} onChange={(event) => set("quantity", event.target.value)} /></Field><Field label="Referência da entrada"><input required maxLength={160} value={draft.reference} onChange={(event) => set("reference", event.target.value)} /></Field><p className={styles.note}>A entrada aumenta o estoque físico. Não registra pagamento.</p></>}
      {["sale", "order"].includes(editor.kind) && <CustomerPicker tenant={tenant} value={selectedCustomer} onChange={(customer) => { setSelectedCustomer(customer); set("customerId", customer?.id ?? ""); }} onUnauthorized={onUnauthorized} onCreate={has("customers.create") ? () => setAuxiliary("customer") : undefined} />}
      {editor.kind === "sale" && <>{items.map((item, index) => <div key={item.key} className={op.saleLine}>
        <ProductPicker tenant={tenant} index={index + 1} value={products.find((product) => product.id === item.productId) as ProductChoice ?? null} onUnauthorized={onUnauthorized} onChange={(product) => {
          if (product) setProducts((current) => [...new Map([...current, product].map((entry) => [entry.id, entry])).values()]);
          setItems((current) => current.map((line) => line.key === item.key ? { ...line, productId: product?.id ?? "", discount: undefined } : line));
        }} />
        <Field label={`Quantidade ${index + 1}`}><input type="number" required min={1} max={1000000} step={1} value={item.quantity} onChange={(event) => setItems((current) => current.map((line) => line.key === item.key ? { ...line, quantity: Number(event.target.value) } : line))} /></Field>
        <button type="button" aria-label={`Remover produto ${index + 1}`} onClick={() => setItems((current) => current.filter((line) => line.key !== item.key))}>Remover</button>
        {item.productId && <SaleItemPricing index={index + 1} unitPriceCents={products.find((product) => product.id === item.productId)?.salePriceCents ?? null} quantity={item.quantity} discount={item.discount} canDiscount={has("sales.discount")} onDiscount={(discount) => setItems((current) => current.map((line) => line.key === item.key ? { ...line, discount } : line))} />}
      </div>)}<button type="button" className="button button-secondary" onClick={() => setItems((current) => [...current, { key: crypto.randomUUID(), productId: "", quantity: 1 }])}>Adicionar produto</button>{has("products.create") && <button type="button" className="button button-secondary" onClick={() => setAuxiliary("product")}>Cadastrar produto aqui</button>}{salePricingError ? <p className={styles.note}>{salePricingError}</p> : <SaleTotals grossCents={saleGross} discountCents={saleDiscount} totalCents={saleTotal} />}<p className={styles.note}>A confirmação reserva o conjunto; não recebe dinheiro nem entrega a mercadoria.</p></>}
      {["order", "editOrder", "assignOrder"].includes(editor.kind) && <><Field label="Técnico responsável"><select aria-label="Técnico responsável" required={editor.kind === "assignOrder"} value={draft.technicianId} onChange={(event) => set("technicianId", event.target.value)}><option value="" disabled={editor.kind === "assignOrder" || (editor.kind === "editOrder" && row?.stage !== "received")}>A definir</option>{technicians.map((technician) => <option key={technician.id} value={technician.id}>{technician.name}</option>)}</select></Field>{has("orders.create") && <button type="button" className="button button-secondary" onClick={() => setAuxiliary("technician")}>Cadastrar técnico aqui</button>}
        {editor.kind !== "assignOrder" && <>{editor.kind === "order" ? <><Field label="Equipamento"><input required maxLength={160} value={draft.equipment} onChange={(event) => set("equipment", event.target.value)} /></Field><Field label="Serviço solicitado"><textarea required maxLength={2000} value={draft.issue} onChange={(event) => set("issue", event.target.value)} /></Field></> : <Field label="Diagnóstico"><textarea maxLength={4000} value={draft.diagnosis} onChange={(event) => set("diagnosis", event.target.value)} /></Field>}
        {editor.kind === "editOrder" && <><Field label="Serviço proposto"><textarea aria-label="Serviço proposto" required maxLength={2000} disabled={row?.approved} value={draft.budgetScope} onChange={(event) => set("budgetScope", event.target.value)} /></Field>{row?.budgetHistory?.length > 0 && <details><summary>Versões do orçamento</summary><ol>{(row?.budgetHistory as OrderBudgetRevision[]).map(value => <li key={value.revision}><strong>Orçamento {value.revision} · {value.laborCents == null ? "Valor a definir" : money(value.laborCents)}</strong><p>{value.scope}</p><small>{value.source === "legacy_snapshot" ? "Fotografia observada" : "Registrado"} em {accessDate(value.at)} por {value.actorName}</small></li>)}</ol></details>}</>}
        <Field label="Previsão"><input aria-label="Previsão" aria-describedby="order-due-help" type="date" value={draft.due} onChange={(event) => set("due", event.target.value)} /></Field><Field label="Mão de obra"><input aria-label="Mão de obra" aria-describedby="order-labor-help" inputMode="decimal" placeholder="Valor a definir" disabled={row?.approved} value={draft.labor} onChange={(event) => set("labor", event.target.value)} /></Field><small id="order-labor-help">Deixe vazio se o orçamento ainda não foi definido. Zero significa serviço gratuito.</small><small id="order-due-help">A previsão é opcional. Deixe vazia enquanto não houver uma estimativa.</small></>}</>}
      {editor.kind === "approveOrder" && <>
        <p>{row?.customerName}</p><p>{row?.budgetScope ?? row?.issue}</p>
        <p>Orçamento {row?.budgetRevision ?? "anterior"} · {row?.laborCents == null ? "Valor a definir" : money(row.laborCents)}</p>
        <p className={styles.note}>Registre como o cliente autorizou este serviço e valor. Esta confirmação registra seu relato; não envia mensagens nem recebe pagamento.</p>
        <Field label="Como o cliente autorizou?"><select aria-label="Como o cliente autorizou?" required value={approvalChannel} onChange={event => setApprovalChannel(event.target.value)}><option value="">Selecione o canal</option>{Object.entries(orderApprovalChannels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>
        <Field label="Referência da autorização (opcional)"><input aria-label="Referência da autorização (opcional)" maxLength={500} placeholder="Ex.: referência da conversa, sem senhas" value={approvalReference} onChange={event => setApprovalReference(event.target.value)} /></Field>
      </>}
      {editor.kind === "editOrder" && row?.budgetApproval && <div>
        <p>Autorização do orçamento {row.budgetApproval.revision}: {orderApprovalChannels[row.budgetApproval.channel as keyof typeof orderApprovalChannels]} · registrada por {row.budgetApproval.actorName} em {accessDate(row.budgetApproval.at)}.</p>
        {row.budgetApproval.reference && <p>Referência: {row.budgetApproval.reference}</p>}
      </div>}
      {editor.kind === "deliverOrder" && <><p>OS {row?.number} · {row?.customerName} · {row?.equipment}</p><p className={styles.notice}>{row?.finance ? `Recebido: ${money(row.finance.paidCents)}. Em aberto: ${money(row.finance.outstandingCents)}.` : row?.agreementId ? "Condições financeiras registradas. Confira os recebimentos com o responsável financeiro." : "Esta OS ainda não tem condições de pagamento registradas."} Esta ação registra somente a entrega do equipamento.</p><label><input type="checkbox" required checked={draft.allowUnsettled} onChange={(event) => set("allowUnsettled", event.target.checked)} />Confirmo a entrega com a situação financeira informada.</label></>}
      {editor.kind === "returnOrder" && <>
        <p>OS {row?.number} · {row?.customerName} · {row?.equipment}</p>
        <p className={styles.notice}>Confira a identidade de quem retira, o equipamento e os acessórios antes de confirmar. A devolução encerra esta OS sem reparo e não registra cobrança, pagamento ou reembolso.</p>
        <Field label="Motivo da devolução"><select aria-label="Motivo da devolução" required value={returnReason} onChange={event => setReturnReason(event.target.value)}><option value="">Selecione o motivo</option>{Object.entries(orderReturnReasons).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>
        {returnReason === "other" && <Field label="Detalhe do motivo"><textarea aria-label="Detalhe do motivo" required maxLength={500} value={returnDetails} onChange={event => setReturnDetails(event.target.value)} /></Field>}
        <label><input type="checkbox" checked={otherRecipient} onChange={event => setOtherRecipient(event.target.checked)} />Outra pessoa vai retirar</label>
        {otherRecipient && <><Field label="Nome do retirante"><input aria-label="Nome do retirante" required maxLength={120} value={recipientName} onChange={event => setRecipientName(event.target.value)} /></Field><Field label="Autorização da retirada"><textarea aria-label="Autorização da retirada" required maxLength={500} placeholder="Registre como o cliente autorizou esta retirada, sem senhas ou documentos pessoais." value={returnAuthorization} onChange={event => setReturnAuthorization(event.target.value)} /></Field></>}
      </>}
      <div className="form-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancelar</button><button className="button button-primary" type="submit" disabled={busy || (["sale", "order"].includes(editor.kind) && !draft.customerId) || (editor.kind === "sale" && (!items.length || items.some((item) => !item.productId) || Boolean(salePricingError)))}>{busy ? "Confirmando…" : saveLabel}</button></div>
    </fieldset></form>
    {auxiliary && <AuxiliaryForm tenant={tenant} kind={auxiliary} onClose={() => setAuxiliary(null)} onUnauthorized={onUnauthorized} onSaved={(entity) => {
      if (auxiliary === "customer") { set("customerId", entity.id); setSelectedCustomer({ id: entity.id, name: entity.name, phone: entity.phone, email: entity.email, active: entity.active, type: entity.type }); }
      if (auxiliary === "technician") { setTechnicians((current) => [...current, entity]); set("technicianId", entity.id); }
      if (auxiliary === "product") { setProducts((current) => [...current, entity]); setItems((current) => { const empty = current.find((line) => !line.productId); return empty ? current.map((line) => line === empty ? { ...line, productId: entity.id, discount: undefined } : line) : [...current, { key: crypto.randomUUID(), productId: entity.id, quantity: 1 }]; }); }
      setAuxiliary(null);
    }} />}
  </Modal>;
}

function PricesEditor({ tenant, onClose, onSaved, onUnauthorized }: { tenant: string; onClose: () => void; onSaved: (text?: string) => void; onUnauthorized: (error: unknown) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null), [percent, setPercent] = useState(""), [manual, setManual] = useState<Record<string, string>>({}), [excluded, setExcluded] = useState<Record<string, boolean>>({}), [error, setError] = useState(""), [busy, setBusy] = useState(false), [more, setMore] = useState(false);
  const alive = useRef(true), attempt = useRef<{ content: string; id: string } | null>(null);
  useEffect(() => {
    alive.current = true; const controller = new AbortController();
    void (async () => { const found: Row[] = []; let offset = 0, total = 0;
      do { const data = await accessRequest<PageData>(`${endpoint(tenant)}/products?status=pending&limit=100&offset=${offset}`, { signal: controller.signal }); if (data.tenantId !== tenant) throw new AccessError(503); found.push(...data.items); total = data.total; if (!data.items.length) break; offset += data.items.length; } while (offset < total && found.length < 500);
      if (!controller.signal.aborted && alive.current) { setRows(found.slice(0, 500)); setMore(total > 500); }
    })().catch((failure) => { if (!controller.signal.aborted && alive.current) { if (failure instanceof AccessError && [401, 403].includes(failure.status)) onUnauthorized(failure); else setError(message(failure)); } });
    return () => { alive.current = false; controller.abort(); };
  }, [tenant, onUnauthorized]);
  function price(row: Row): number | null {
    if (Object.hasOwn(manual, row.id)) return amount(manual[row.id]);
    if (row.costCents == null || row.costCents <= 0) return null;
    const basis = amount(percent); if (basis === null || basis > 1000000) return null;
    const value = (BigInt(row.costCents) * (10000n + BigInt(basis)) + 5000n) / 10000n;
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) return null; return Number(value);
  }
  let changes: Row[] = []; try { changes = (rows ?? []).filter((row) => !excluded[row.id] && price(row) !== null).map((row) => ({ id: row.id, version: row.version, salePriceCents: price(row) })); } catch { /* invalid inputs keep save disabled */ }
  return <Modal title="Preços pendentes" description="Um acréscimo sobre a compra para o conjunto. Exceções manuais são opcionais." wide onClose={() => { if (!busy) onClose(); }} onCancel={(event) => { if (busy) event.preventDefault(); else onClose(); }} onKeyDown={trap}><form onSubmit={async (event) => {
    event.preventDefault(); if (busy || !changes.length) return; setBusy(true); setError("");
    try { const data = { items: changes }, content = JSON.stringify(data); if (attempt.current?.content !== content) attempt.current = { content, id: crypto.randomUUID() };
      await accessRequest(`${endpoint(tenant)}/commands`, { method: "POST", body: { requestId: attempt.current!.id, type: "product.prices", data } }); if (alive.current) onSaved("Preços do lote salvos.");
    } catch (failure) { if (alive.current) { if (failure instanceof AccessError && [401, 403].includes(failure.status)) onUnauthorized(failure); else setError(message(failure)); } } finally { if (alive.current) setBusy(false); }
  }}><fieldset className={op.form} disabled={busy}>{error && <p className={styles.error} role="alert">{error}</p>}<Field label="Acréscimo sobre a compra (%)"><input inputMode="decimal" required value={percent} onChange={(event) => setPercent(event.target.value)} placeholder="Ex.: 50" /></Field>
    {!rows ? <p>Carregando pendentes…</p> : <><p>{changes.length} de {rows.length} produtos selecionados. Custo ausente ou zero exige valor manual, sem sugestão presumida.</p>{more && <p>Primeiros 500 pendentes. Após salvar este conjunto, abra o próximo lote.</p>}<details><summary>Conferir preços ou definir exceções</summary><div className={op.priceList}>{rows.map((row) => { let value: number | null = null; try { value = price(row); } catch { /* invalid manual draft */ } return <div key={row.id} className={op.review}><label><input type="checkbox" checked={!excluded[row.id]} onChange={(event) => setExcluded((old) => ({ ...old, [row.id]: !event.target.checked }))} />{row.name}</label><p>Compra: {row.costCents == null ? "Pendente" : money(row.costCents)} · Venda: {value == null ? "Pendente" : money(value)} · Lucro: {value == null || row.costCents == null ? "Não calculado" : money(value - row.costCents)}</p><Field label={`Preço manual de ${row.name}`}><input inputMode="decimal" value={manual[row.id] ?? ""} onChange={(event) => setManual((old) => ({ ...old, [row.id]: event.target.value }))} placeholder="Usar percentual" /></Field><button type="button" onClick={() => setManual((old) => { const next = { ...old }; delete next[row.id]; return next; })}>Usar percentual</button></div>; })}</div></details></>}
    <div className="form-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancelar</button><button type="submit" className="button button-primary" disabled={busy || !changes.length}>Salvar preços do lote</button></div>
  </fieldset></form></Modal>;
}

function AuxiliaryForm({ tenant, kind, onClose, onSaved, onUnauthorized }: { tenant: string; kind: "customer" | "technician" | "product"; onClose: () => void; onSaved: (row: Row) => void; onUnauthorized?: (error: unknown) => void }) {
  const [name, setName] = useState(""), [sku, setSku] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(""); const id = useRef(crypto.randomUUID()); const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return <Modal title={kind === "customer" ? "Cadastrar cliente" : kind === "product" ? "Cadastrar produto" : "Cadastrar técnico"} onClose={() => { if (!busy) onClose(); }} onKeyDown={trap} onCancel={(event) => { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); }}><form onSubmit={async (event) => {
    event.preventDefault(); event.stopPropagation(); if (busy) return; setBusy(true); setError("");
    try {
      const result = kind === "customer" ? await accessRequest<{ customer: Row }>(`${accessBase(tenant)}/customers`, { method: "POST", body: { requestId: id.current, name, type: "Pessoa física" } }) : await accessRequest<{ entity: Row }>(`${endpoint(tenant)}/commands`, { method: "POST", body: { requestId: id.current, type: kind === "product" ? "product.create" : "technician.create", data: kind === "product" ? { name, sku } : { name } } });
      if (mounted.current) onSaved("entity" in result ? result.entity : result.customer);
    } catch (failure) { if (mounted.current) { if (failure instanceof AccessError && [401, 403].includes(failure.status) && onUnauthorized) onUnauthorized(failure); else setError(message(failure)); } } finally { if (mounted.current) setBusy(false); }
  }}><fieldset disabled={busy} className={op.form}>{error && <p className={styles.error} role="alert">{error}</p>}<Field label="Nome"><input autoFocus required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></Field>{kind === "product" && <><Field label="SKU"><input placeholder="Automático ao salvar" maxLength={80} value={sku} onChange={(event) => setSku(event.target.value)} /></Field><p>Produto começa sem estoque e com preço pendente.</p></>}<div className="form-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancelar</button><button type="submit" className="button button-primary">Salvar cadastro</button></div></fieldset></form></Modal>;
}

function HistoryDialog({ tenant, value, onClose, onUnauthorized }: { tenant: string; value: { row: Row; type: string }; onClose: () => void; onUnauthorized: (error: unknown) => void }) {
  const [page, setPage] = useState<PageData | null>(null), [error, setError] = useState(""), [offset, setOffset] = useState(0);
  useEffect(() => { const controller = new AbortController(); setPage(null); void accessRequest<PageData>(`${endpoint(tenant)}/history?entityType=${value.type}&id=${encodeURIComponent(value.row.id)}&limit=25&offset=${offset}`, { signal: controller.signal }).then((result) => { if (!controller.signal.aborted) { if (result.tenantId !== tenant) throw new AccessError(503); setPage(result); } }).catch((failure) => { if (!controller.signal.aborted) { if (failure instanceof AccessError && [401, 403].includes(failure.status)) onUnauthorized(failure); else setError(message(failure)); } }); return () => controller.abort(); }, [tenant, value, offset, onUnauthorized]);
  return <Modal title="Histórico de alterações" description="Horários de Brasília. Consulta e tentativas sem alteração não criam eventos." onClose={onClose} onKeyDown={trap}>{error && <p role="alert" className={styles.error}>{error}</p>}{!page ? <p>Carregando…</p> : <><ol className={styles.audit}>{page.items.map((event) => <li key={event.id}><strong>{event.actorName}</strong><div>{event.action} · Versão {event.version}</div><small>{accessDate(event.at)}</small><details><summary>Campos alterados</summary><p>{event.fields.join(", ")}</p><pre className={op.values}>{JSON.stringify({ antes: event.before, depois: event.after }, null, 2)}</pre></details></li>)}</ol>{!page.items.length && <p>Nenhuma alteração registrada.</p>}<div className={styles.footer}><button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 25))}>Mais recentes</button><button disabled={offset + 25 >= page.total} onClick={() => setOffset(offset + 25)}>Mais antigas</button></div></>}</Modal>;
}

function PurchaseImport({ tenant, generation, onSaved, onUnauthorized, canReceive }: { tenant: string; generation: React.RefObject<number>; onSaved: () => void; onUnauthorized: (error: unknown) => void; canReceive: boolean }) {
  const [candidates, setCandidates] = useState<Record<string, { name: string; sku: string }>>({});
  const [document, setDocument] = useState<PurchaseDocument | null>(null), [plan, setPlan] = useState<PurchasePlan | null>(null), [decisions, setDecisions] = useState<Record<string, PurchaseDecision>>({}), [receive, setReceive] = useState(canReceive), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const attempt = useRef<{ content: string; id: string } | null>(null), epoch = useRef(0), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; epoch.current++; }; }, []);
  const reviewing = plan?.lines.filter((line) => line.resolution === "review") ?? [], known = plan?.lines.filter((line) => line.resolution === "known").length ?? 0;
  function change(lineId: string, value: Partial<PurchaseDecision>) { setDecisions((current) => ({ ...current, [lineId]: { ...(current[lineId] ?? {}), ...value } as PurchaseDecision })); }
  return <div className={op.purchase}><fieldset className={op.form} disabled={busy}>{error && <p role="alert" className={styles.error}>{error}</p>}<Field label="Arquivo XML"><input type="file" accept=".xml,text/xml,application/xml" onChange={async (event) => {
    const file = event.target.files?.[0]; if (!file) return; const tag = generation.current, requestEpoch = ++epoch.current; setError(""); setBusy(true); setPlan(null); setDecisions({});
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error("Envie um XML com até 2 MiB.");
      const { originalXml: _raw, ...parsed } = parsePurchaseXml(await file.text());
      const result = await accessRequest<{ tenantId: string; plan: PurchasePlan; candidates?: { id: string; name: string; sku: string }[] }>(`${endpoint(tenant)}/purchase-plan`, { method: "POST", body: { document: parsed } });
      if (alive.current && tag === generation.current && requestEpoch === epoch.current) { if (result.tenantId !== tenant) throw new AccessError(503); setCandidates(Object.fromEntries((result.candidates ?? []).map((row) => [row.id, row]))); setDocument(parsed); setPlan(result.plan); }
    } catch (failure) { if (alive.current && requestEpoch === epoch.current) { if (failure instanceof AccessError && [401, 403].includes(failure.status)) onUnauthorized(failure); else setError(message(failure)); } }
    finally { if (alive.current && requestEpoch === epoch.current) setBusy(false); }
  }} /></Field>
    {plan && document && <><div className={styles.notice}><strong>{document.supplierName} · Documento {document.number}</strong><p>{known} itens reconhecidos</p><p>{plan.lines.filter((line) => line.resolution === "new").length} novos cadastros propostos · {reviewing.length} dúvidas para resolver.</p></div>
      {reviewing.map((line) => <div key={line.source.id} className={op.review}><strong>{line.source.description}</strong><p>{line.reason}</p><Field label={`Ação para ${line.source.description}`}><select aria-label={`Ação para ${line.source.description}`} value={decisions[line.source.id]?.action === "link" ? `link:${decisions[line.source.id]?.productId}` : decisions[line.source.id]?.action ?? ""} onChange={(event) => { const value = event.target.value; change(line.source.id, value.startsWith("link:") ? { action: "link", productId: value.slice(5) } : { action: value as "new" | "ignore" }); }}><option value="">Resolva a dúvida</option>{line.candidates.map((id) => <option key={id} value={`link:${id}`}>{candidates[id] ? `${candidates[id].name} · ${candidates[id].sku}` : `Produto ${id}`}</option>)}<option value="new">Cadastrar nova variação</option><option value="ignore">Ignorar item</option></select></Field><Field label={`Conversão do item ${line.source.code}`}><input type="number" min={1} max={1000000} step={1} value={decisions[line.source.id]?.conversion ?? line.conversion} onChange={(event) => change(line.source.id, { conversion: Number(event.target.value) })} /></Field></div>)}
      <details><summary>Conferir propostas e recebimento parcial</summary>{plan.lines.map((line) => <div className={op.review} key={line.source.id}><strong>{line.name}</strong><small>{line.source.description}</small><p>{line.source.quantity} {line.source.unit} · {money(line.source.costCents)} por unidade de origem</p>{receive && <Field label={`Receber do item ${line.source.code}`}><input type="number" min={0} max={line.source.quantity} step={1} placeholder="Quantidade restante" value={decisions[line.source.id]?.receivedQuantity ?? ""} onChange={(event) => { if (event.target.value === "") { const next = { ...decisions[line.source.id] }; delete next.receivedQuantity; setDecisions((old) => ({ ...old, [line.source.id]: next as PurchaseDecision })); } else change(line.source.id, { receivedQuantity: Number(event.target.value) }); }} /></Field>}</div>)}</details>
      {canReceive && <label><input type="checkbox" checked={receive} onChange={(event) => setReceive(event.target.checked)} />Registrar recebimento do conjunto</label>}<p className={styles.note}>{receive ? "A confirmação registra vínculos/cadastros e a entrada física conferida, sem pagamento." : "A confirmação registra cadastros e vínculos, sem alterar o estoque."}</p>
      <button type="button" className="button button-primary" disabled={busy || reviewing.some((line) => !decisions[line.source.id]?.action)} onClick={async () => {
        setBusy(true); setError(""); const tag = generation.current;
        try {
          const data = { document, decisions, receive }, content = JSON.stringify(data); if (attempt.current?.content !== content) attempt.current = { content, id: crypto.randomUUID() };
          await accessRequest(`${endpoint(tenant)}/commands`, { method: "POST", body: { requestId: attempt.current!.id, type: "purchase.confirm", data } });
          if (alive.current && tag === generation.current) { setPlan(null); setDocument(null); setDecisions({}); onSaved(); }
        } catch (failure) { if (alive.current && tag === generation.current) { if (failure instanceof AccessError && [401, 403].includes(failure.status)) onUnauthorized(failure); else setError(message(failure)); } }
        finally { if (alive.current) setBusy(false); }
      }}>{busy ? "Confirmando…" : receive ? "Confirmar recebimento" : "Confirmar cadastros"}</button>
    </>}
  </fieldset></div>;
}
