"use client";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { Field, Modal } from "@/components/ui";
import { accessBase, accessRequest, AccessError } from "@/lib/access-api";
import { money } from "@/lib/domain";
import { planInstallments, type AgreementTerms } from "../../shared/finance-planner.mjs";
import { emptyPayment, financeTrap, liveDay, parseLiveMoney, paymentData, PaymentFields, ReceiptDialog, useFinanceCommand, useOverview, type FinanceRow } from "./finance-live";
import styles from "./access-control.module.css";
import op from "./operations-page.module.css";
import { SaleItemPricing, SaleTotals, saleLineAmounts } from "./sale-item-pricing";
import { CustomerPicker, type CustomerChoice } from "./customer-picker";
import { ProductPicker, type ProductChoice } from "./product-picker";

type AuxiliaryProps = { tenant: string; kind: "customer" | "technician" | "product"; onClose: () => void; onSaved: (entity: FinanceRow) => void; onUnauthorized?: (error: unknown) => void };
type Line = { key: string; productId: string; quantity: number; discount?: string };
function endOfMonth() { const [year, month] = liveDay().split("-").map(Number); return new Date(Date.UTC(year, month, 0, 12)).toISOString().slice(0, 10); }
export function CheckoutEditor({ tenant, actorId, rights, auxiliary: Auxiliary, onClose, onSaved, onUnauthorized }: { tenant: string; actorId: string; rights: string[]; auxiliary: ComponentType<AuxiliaryProps>; onClose: () => void; onSaved: (text?: string) => void; onUnauthorized: (error: unknown) => void }) {
  const command = useFinanceCommand(tenant, onUnauthorized), overview = useOverview(tenant, onUnauthorized);
  const [products, setProducts] = useState<FinanceRow[]>([]), [selectedCustomer, setSelectedCustomer] = useState<CustomerChoice | null>(null);
  const customerId = selectedCustomer?.id ?? "";
  const [items, setItems] = useState<Line[]>([{ key: "first", productId: "", quantity: 1 }]), [condition, setCondition] = useState("later"), [due, setDue] = useState(endOfMonth), [firstDue, setFirstDue] = useState(endOfMonth), [down, setDown] = useState("0"), [count, setCount] = useState(1), [deliver, setDeliver] = useState(rights.includes("sales.deliver")), [receive, setReceive] = useState(false), [payment, setPayment] = useState(emptyPayment), [dateOverrides, setDateOverrides] = useState<Record<number, string>>({});
  const [context, setContext] = useState<"customer" | "product" | null>(null), [receipt, setReceipt] = useState<FinanceRow | null>(null), [scan, setScan] = useState(""), [scanning, setScanning] = useState(false), [completed, setCompleted] = useState(false);
  const [catalogFix, setCatalogFix] = useState<{ kind: "price" | "stock"; product: FinanceRow } | null>(null);
  const alive = useRef(true), reader = useRef<HTMLInputElement>(null), scanFlight = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const fail = (failure: unknown) => { if (!alive.current) return; if (failure instanceof AccessError && [401, 403].includes(failure.status)) onUnauthorized(failure); else command.setError(failure instanceof Error ? failure.message : "Não foi possível consultar os dados."); };
  let total = 0, grossCents = 0, discountCents = 0, pricingError = "";
  try { for (const item of items) {
    const values = saleLineAmounts(products.find((row) => row.id === item.productId)?.salePriceCents ?? 0, item.quantity, item.discount);
    total += values.totalCents; grossCents += values.grossCents; discountCents += values.discountCents;
    if (![total, grossCents, discountCents].every(Number.isSafeInteger)) throw new Error("O total excede o limite suportado.");
  } } catch (failure) { pricingError = (failure as Error).message; }
  let terms: AgreementTerms | null = null, plan: ReturnType<typeof planInstallments> = [], previewError = "";
  try {
    terms = condition === "cash" ? { downPaymentCents: total, installmentCount: 0 } : condition === "later" ? { downPaymentCents: 0, installmentCount: 1, firstDue: due } : { downPaymentCents: parseLiveMoney(down), installmentCount: count, firstDue };
    const natural = planInstallments(total, terms, liveDay());
    if (condition === "installments" && Object.keys(dateOverrides).length) terms.installmentDueDates = natural.filter((row) => row.kind === "installment").map((row, index) => dateOverrides[index] ?? row.due);
    plan = planInstallments(total, terms, liveDay());
  } catch (failure) { previewError = failure instanceof Error ? failure.message : "Confira as condições."; }
  const shouldReceive = condition === "cash" || (condition === "installments" && receive), amountToReceive = terms?.downPaymentCents ?? 0;
  const eligible = Boolean(customerId) && !pricingError && items.length > 0 && items.every((item) => { const product = products.find((row) => row.id === item.productId), quantity = items.filter((row) => row.productId === item.productId).reduce((sum, row) => sum + row.quantity, 0); return product && !product.serialized && product.salePriceCents != null && Number.isInteger(item.quantity) && item.quantity > 0 && quantity <= (product.stock?.available ?? 0); });
  function finishOrClose() {
    if (command.busy) return;
    if (completed) onSaved("Venda concluída. O recibo pode ser consultado no Financeiro."); else onClose();
  }
  async function readCode() {
    const code = scan.trim(); if (!code || command.busy || scanFlight.current) return; scanFlight.current = true; setScanning(true); command.setError("");
    try {
      // O cache é parcial e GTIN não é único: uma consulta exata por leitura,
      // limitada a dois candidatos, confirma a correspondência no catálogo atual.
      const data = await accessRequest<{ tenantId: string; items: FinanceRow[]; total: number }>(`${accessBase(tenant)}/operations/products?status=active&limit=2&code=${encodeURIComponent(code)}`);
      if (data.tenantId !== tenant) throw new AccessError(503);
      const matches = data.items.filter((row) => row.sku?.toLowerCase() === code.toLowerCase() || row.gtin === code);
      if (!alive.current) return;
      if (data.total > 1 || matches.length !== 1) throw new Error(data.total > 1 || matches.length > 1 ? "Há mais de um produto com esse código. Escolha pela busca." : "Código não encontrado. Use a busca ou cadastre o produto aqui.");
      const product = matches[0]; setProducts((old) => [...new Map([...old, product].map((row) => [row.id, row])).values()]);
      setItems((old) => { const existing = old.find((item) => item.productId === product.id); if (existing) return old.map((item) => item === existing ? { ...item, quantity: item.quantity + 1 } : item); const empty = old.find((item) => !item.productId); return empty ? old.map((item) => item === empty ? { ...item, productId: product.id } : item) : [...old, { key: crypto.randomUUID(), productId: product.id, quantity: 1 }]; });
      setScan(""); requestAnimationFrame(() => reader.current?.focus());
    } catch (failure) { fail(failure); } finally { scanFlight.current = false; if (alive.current) setScanning(false); }
  }
  return <Modal title="Nova venda" wide onClose={finishOrClose} onCancel={(event) => { if (command.busy) event.preventDefault(); else finishOrClose(); }} onKeyDown={financeTrap}><form onSubmit={(event) => { event.preventDefault(); if (!terms || previewError || !eligible || completed) return; try { void command.run("sale.checkout", { customerId, items: items.map((item) => ({ productId: item.productId, quantity: item.quantity, version: products.find((row) => row.id === item.productId)?.version, ...(item.discount === undefined ? {} : { discountCents: saleLineAmounts(products.find((row) => row.id === item.productId)?.salePriceCents ?? 0, item.quantity, item.discount).discountCents }) })), deliver, terms, ...(shouldReceive ? { payment: paymentData(payment, amountToReceive, overview.data, actorId) } : {}) }, (sale) => {
    if (sale.checkoutPaymentId && rights.includes("finance.read")) { setCompleted(true); void accessRequest<{ tenantId: string; payment: FinanceRow }>(`${financeBasePath(tenant)}/payments/${sale.checkoutPaymentId}`).then((result) => { if (alive.current) { if (result.tenantId !== tenant) throw new AccessError(503); setReceipt(result.payment); } }).catch(() => { if (alive.current) onSaved("Venda concluída. O recibo pode ser consultado no Financeiro."); }); }
    else onSaved("Venda concluída com as condições combinadas.");
  }); } catch (failure) { fail(failure); } }}><fieldset className={op.form} disabled={command.busy || completed || Boolean(context) || Boolean(catalogFix) || Boolean(receipt)}>
    {(command.error || overview.error) && <p className={styles.error} role="alert">{command.error || overview.error}</p>}
    <CustomerPicker tenant={tenant} value={selectedCustomer} onChange={setSelectedCustomer} onUnauthorized={onUnauthorized} onCreate={rights.includes("customers.create") ? () => setContext("customer") : undefined} />
    <Field label="Ler código ou SKU"><input ref={reader} value={scan} maxLength={100} onChange={(event) => setScan(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void readCode(); } }} /></Field><button type="button" className="button button-secondary" disabled={scanning} onClick={() => void readCode()}>Adicionar código</button>
    {items.map((item, index) => <div key={item.key} className={op.saleLine}>
      <ProductPicker tenant={tenant} index={index + 1} value={products.find((row) => row.id === item.productId) as ProductChoice ?? null} onUnauthorized={onUnauthorized} onChange={(product) => {
        if (product) setProducts((old) => [...new Map([...old, product].map((row) => [row.id, row])).values()]);
        setItems((old) => old.map((entry) => entry.key === item.key ? { ...entry, productId: product?.id ?? "", discount: undefined } : entry));
      }} />
      <Field label={`Quantidade ${index + 1}`}><input type="number" min={1} max={1000000} required value={item.quantity} onChange={(event) => setItems((old) => old.map((entry) => entry.key === item.key ? { ...entry, quantity: Number(event.target.value) } : entry))} /></Field>
      <button type="button" onClick={() => setItems((old) => old.filter((entry) => entry.key !== item.key))}>Remover</button>
      {item.productId && <SaleItemPricing index={index + 1} unitPriceCents={products.find((row) => row.id === item.productId)?.salePriceCents ?? null} quantity={item.quantity} discount={item.discount} canDiscount={rights.includes("sales.discount")} onDiscount={(discount) => setItems((old) => old.map((entry) => entry.key === item.key ? { ...entry, discount } : entry))} />}
    </div>)}
    <button type="button" className="button button-secondary" onClick={() => setItems((old) => [...old, { key: crypto.randomUUID(), productId: "", quantity: 1 }])}>Adicionar produto</button>{rights.includes("products.create") && <button type="button" className="button button-secondary" onClick={() => setContext("product")}>Cadastrar produto aqui</button>}
    {[...new Set(items.map((row) => row.productId))].filter(Boolean).map((id) => { const product = products.find((row) => row.id === id); if (!product) return null; const quantity = items.filter((row) => row.productId === id).reduce((sum, row) => sum + row.quantity, 0); return <div key={id}>{product.serialized ? <p className={styles.note}>{product.name}: venda por série individual ainda indisponível.</p> : <>{product.salePriceCents == null && <p className={styles.note}>{product.name}: preço de venda pendente. {rights.includes("products.update") && <button type="button" onClick={() => setCatalogFix({ kind: "price", product })}>Definir preço aqui</button>}</p>}{quantity > (product.stock?.available ?? 0) && <p className={styles.note}>{product.name}: disponível {product.stock?.available ?? 0}; pedido {quantity}. {rights.includes("stock.receive") && <button type="button" onClick={() => setCatalogFix({ kind: "stock", product })}>Registrar entrada aqui</button>}</p>}</>}</div>; })}
    {pricingError ? <p className={styles.note}>{pricingError}</p> : <SaleTotals grossCents={grossCents} discountCents={discountCents} totalCents={total} />}<Field label="Condição de pagamento"><select aria-label="Condição de pagamento" value={condition} onChange={(event) => { setCondition(event.target.value); setDateOverrides({}); }}><option value="later">Pagar depois</option><option value="installments">Entrada + parcelas</option>{rights.includes("finance.receive") && <option value="cash">À vista</option>}</select></Field>
    {condition === "later" && <Field label="Vencimento"><input type="date" required value={due} onChange={(event) => setDue(event.target.value)} /></Field>}
    {condition === "installments" && <><Field label="Entrada"><input inputMode="decimal" required value={down} onChange={(event) => setDown(event.target.value)} /></Field><Field label="Número de parcelas"><input type="number" required min={1} max={36} value={count} onChange={(event) => { setCount(Number(event.target.value)); setDateOverrides({}); }} /></Field><Field label="Primeiro vencimento"><input type="date" required value={firstDue} onChange={(event) => { setFirstDue(event.target.value); setDateOverrides({}); }} /></Field>{rights.includes("finance.receive") && <label><input type="checkbox" checked={receive} onChange={(event) => setReceive(event.target.checked)} />Receber entrada agora</label>}</>}
    {previewError ? <p className={styles.note}>{previewError}</p> : <><ol>{plan.map((row, index) => <li key={index}>{row.kind === "down_payment" ? "Entrada" : `Parcela ${row.number}/${row.count}`} · {row.due} · {money(row.amountCents)}</li>)}</ol>{condition === "installments" && <details><summary>Ajustar vencimentos</summary>{plan.filter((row) => row.kind === "installment").map((row, index) => <Field key={index} label={`Vencimento da parcela ${index + 1}`}><input type="date" value={row.due} onChange={(event) => setDateOverrides((old) => ({ ...old, [index]: event.target.value }))} /></Field>)}</details>}</>}
    {shouldReceive && <PaymentFields tenant={tenant} actorId={actorId} rights={rights} draft={payment} onChange={setPayment} overview={overview.data} onOverview={overview.refresh} onUnauthorized={onUnauthorized} amountCents={amountToReceive} />}
    {rights.includes("sales.deliver") && <label><input type="checkbox" checked={deliver} onChange={(event) => setDeliver(event.target.checked)} />Entregar agora</label>}
    <p className={styles.note}>{deliver ? "A confirmação entrega a mercadoria e baixa o estoque físico." : "A confirmação reserva a mercadoria para retirada posterior."} {shouldReceive ? `Receber ${money(amountToReceive)} pelo meio informado.` : "Nenhum recebimento: as cobranças ficam em aberto."} Sem emissão fiscal ou consulta externa de crédito.</p>
    <div className="form-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancelar</button><button className="button button-primary" type="submit" disabled={command.busy || scanning || Boolean(previewError) || !eligible || (shouldReceive && amountToReceive <= 0)}>Concluir venda</button></div>
  </fieldset></form>{completed && !receipt && <p role="status">Venda concluída. Carregando recibo…</p>}
    {context && <Auxiliary tenant={tenant} kind={context} onUnauthorized={onUnauthorized} onClose={() => setContext(null)} onSaved={(entity) => { if (context === "customer") { setSelectedCustomer({ id: entity.id, name: entity.name, phone: entity.phone, email: entity.email, active: entity.active, type: entity.type }); } else { setProducts((old) => [...old, entity]); setItems((old) => { const empty = old.find((row) => !row.productId); return empty ? old.map((row) => row === empty ? { ...row, productId: entity.id } : row) : [...old, { key: crypto.randomUUID(), productId: entity.id, quantity: 1 }]; }); } setContext(null); }} />}
    {catalogFix && <CatalogFix tenant={tenant} kind={catalogFix.kind} product={catalogFix.product} onClose={() => setCatalogFix(null)} onSaved={(entity) => { setProducts((old) => old.map((row) => row.id === entity.id ? entity : row)); setCatalogFix(null); }} onUnauthorized={onUnauthorized} />}
    {receipt && <ReceiptDialog payment={receipt} onClose={() => { setReceipt(null); onSaved("Venda e recebimento concluídos."); }} />}
  </Modal>;
}
const financeBasePath = (tenant: string) => `${accessBase(tenant)}/finance`;

function CatalogFix({ tenant, kind, product, onClose, onSaved, onUnauthorized }: { tenant: string; kind: "price" | "stock"; product: FinanceRow; onClose: () => void; onSaved: (row: FinanceRow) => void; onUnauthorized: (error: unknown) => void }) {
  const command = useFinanceCommand(tenant, onUnauthorized), [price, setPrice] = useState(""), [quantity, setQuantity] = useState("1"), [reference, setReference] = useState("");
  return <Modal title={kind === "price" ? "Definir preço" : "Registrar entrada"} onClose={() => { if (!command.busy) onClose(); }} onCancel={(event) => { event.preventDefault(); event.stopPropagation(); if (!command.busy) onClose(); }} onKeyDown={financeTrap}><form onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); try { void command.run(kind === "price" ? "product.update" : "stock.receive", kind === "price" ? { id: product.id, version: product.version, salePriceCents: parseLiveMoney(price) } : { productId: product.id, quantity: Number(quantity), reference }, onSaved); } catch (failure) { command.setError(failure instanceof Error ? failure.message : "Confira os campos."); } }}><fieldset className={op.form} disabled={command.busy}>{command.error && <p role="alert">{command.error}</p>}<strong>{product.name}</strong>{kind === "price" ? <Field label="Preço de venda"><input required autoFocus inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} /></Field> : <><Field label="Quantidade"><input type="number" min={1} max={1000000} required autoFocus value={quantity} onChange={(event) => setQuantity(event.target.value)} /></Field><Field label="Referência da entrada"><input required maxLength={160} value={reference} onChange={(event) => setReference(event.target.value)} /></Field><p>Confira a entrada física. Esta ação não confirma nem recebe a venda.</p></>}<div className="form-actions"><button type="button" onClick={onClose}>Cancelar</button><button type="submit" className="button button-primary">{kind === "price" ? "Salvar preço" : "Confirmar entrada"}</button></div></fieldset></form></Modal>;
}
