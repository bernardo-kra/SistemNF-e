"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useDemo, uid } from "@/lib/demo-store";
import { money, TODAY } from "@/lib/domain";
import { ContextualDialog, CustomerEditor, ProductEditor, StockEntryEditor } from "./contextual-catalog";
import { Field, FormActions, FormError } from "./ui";

type CartItem = { key: string; productId: string; quantity: string };
type Auxiliary = { kind: "customer" | "product" | "pricing" | "stock"; key?: string };
const readQuantity = (raw: string): number | null => {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
};

/** Keep incomplete quantities intact; merge only quantities the operator has defined. */
function compactCart(input: CartItem[]) {
  const items: CartItem[] = [];
  const merged = new Map<string, string>();
  for (const item of input) {
    const quantity = readQuantity(item.quantity);
    const previous = items.find((entry) => item.productId && entry.productId === item.productId && readQuantity(entry.quantity) !== null);
    if (previous && quantity !== null && Number.isSafeInteger(Number(previous.quantity) + quantity)) {
      previous.quantity = String(Number(previous.quantity) + quantity);
      merged.set(item.key, previous.key);
    } else items.push({ ...item });
  }
  return { items, merged };
}

export function SaleEditor({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const { state, createSale } = useDemo();
  const formId = useId();
  const [attemptId] = useState(uid);
  const [customerId, setCustomerId] = useState(state.customers[0]?.id || "");
  const [items, setItems] = useState<CartItem[]>(() => [{ key: uid(), quantity: "1",
    productId: state.products.find((product) => !product.serialized && !product.pricePending && product.stock > product.reserved)?.id || "" }]);
  const [auxiliary, setAuxiliary] = useState<Auxiliary | null>(null);
  const [error, setError] = useState("");
  const [focus, setFocus] = useState<{ key: string; control: "product" | "quantity" | "add" } | null>(null);
  const customerInput = useRef<HTMLSelectElement>(null);
  const submitted = useRef(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const target = focus ? document.getElementById(focus.control === "add" ? `${formId}-add` : `${formId}-${focus.key}-${focus.control}`) : customerInput.current;
      target?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [focus, formId]);

  const updateCart = (next: CartItem[], changedKey: string) => {
    const compacted = compactCart(next);
    setItems(compacted.items);
    const target = compacted.merged.get(changedKey);
    if (target) setFocus({ key: target, control: "quantity" });
  };
  const changeProduct = (key: string, productId: string) =>
    updateCart(items.map((item) => item.key === key ? { ...item, productId } : item), key);
  const products = new Map(state.products.map((product) => [product.id, product]));
  const rows = items.map((item) => {
    const product = products.get(item.productId);
    const quantity = readQuantity(item.quantity);
    const available = product ? product.stock - product.reserved : 0;
    const amount = product && !product.pricePending && quantity !== null ? product.price * quantity : null;
    return { item, product, quantity, available, amount: amount !== null && Number.isSafeInteger(amount) ? amount : null };
  });
  const quantities = new Map<string, number>();
  let validQuantities = true;
  for (const row of rows) {
    if (!row.product || row.quantity === null) { validQuantities = false; continue; }
    const quantity = (quantities.get(row.product.id) || 0) + row.quantity;
    if (!Number.isSafeInteger(quantity) || quantity > row.available) validQuantities = false;
    quantities.set(row.product.id, quantity);
  }
  const sum = rows.reduce((value, row) => value + (row.amount ?? 0), 0);
  const total = rows.length && rows.every((row) => row.amount !== null) && Number.isSafeInteger(sum) ? sum : null;
  const canConfirm = total !== null && validQuantities && state.customers.some((customer) => customer.id === customerId) &&
    rows.every((row) => row.product && !row.product.serialized && !row.product.pricePending);
  const activeItem = items.find((item) => item.key === auxiliary?.key);
  const activeProduct = activeItem ? products.get(activeItem.productId) : undefined;

  return <>
    <form className="sale-editor" onSubmit={(event) => {
      event.preventDefault();
      if (submitted.current || !canConfirm || total === null) return;
      try {
        submitted.current = true;
        createSale({ id: attemptId, number: 0, customerId, date: TODAY, status: "confirmed", total,
          items: rows.map((row) => ({ productId: row.product!.id, quantity: row.quantity!, unitPrice: row.product!.price })) });
        onSaved();
      } catch (failure) {
        submitted.current = false;
        setError(failure instanceof Error ? failure.message : "Não foi possível confirmar o pedido. Tente novamente.");
      }
    }}>
      <div className="contextual-field">
        <Field label="Cliente *"><select ref={customerInput} name="customerId" required value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
          {!customerId && <option value="">Selecione um cliente</option>}
          {state.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
        </select></Field>
        <button type="button" className="button button-small button-secondary contextual-create" onClick={() => setAuxiliary({ kind: "customer" })}><Plus size={14} /> Cadastrar cliente</button>
      </div>
      <div className="sale-cart-items">
        {rows.map(({ item, product, quantity, available, amount }, index) => <div key={item.key} role="group" aria-label={`Item ${index + 1}`} data-cart-item className="sale-cart-item">
          <div className="sale-cart-heading"><strong>Item {index + 1}</strong><button type="button" className="button button-small button-secondary" aria-label={`Remover item ${index + 1}`}
            onClick={() => {
              const remaining = items.filter((entry) => entry.key !== item.key);
              setItems(remaining);
              const next = remaining[Math.min(index, remaining.length - 1)];
              setFocus(next ? { key: next.key, control: "product" } : { key: "", control: "add" });
            }}><Trash2 size={14} /> Remover</button></div>
          <div className="contextual-field">
            <Field label="Produto *"><select id={`${formId}-${item.key}-product`} name="productId" required value={item.productId} onChange={(event) => changeProduct(item.key, event.target.value)}>
              <option value="">Selecione um produto</option>
              {state.products.map((entry) => <option key={entry.id} value={entry.id}>{entry.sku} · {entry.name} · {entry.stock - entry.reserved} disponíveis{entry.serialized ? " · Controle por série" : ""}{entry.pricePending ? " · Preço pendente" : ""}</option>)}
            </select></Field>
            <button type="button" className="button button-small button-secondary contextual-create" onClick={() => setAuxiliary({ kind: "product", key: item.key })}><Plus size={14} /> Cadastrar produto</button>
          </div>
          {product?.pricePending && <div className="notice notice-warning contextual-notice"><div><p>Preço de venda pendente. Defina o preço para continuar com este pedido.</p>
            <button type="button" className="button button-small button-secondary" onClick={() => setAuxiliary({ kind: "pricing", key: item.key })}>Definir preço</button></div></div>}
          {product?.serialized ? <div className="notice notice-warning contextual-notice">Este produto controla número de série. A conferência individual ainda não está disponível para a venda demonstrativa.</div>
            : product && available < (quantity ?? 1) && <div className="notice notice-warning contextual-notice"><div><strong>Saldo disponível em estoque: {available} {product.unit}.</strong>
              <p>Confira o recebimento e registre uma entrada antes de confirmar esta quantidade. O cadastro do produto não adiciona estoque.</p>
              <button type="button" className="button button-small button-secondary" onClick={() => setAuxiliary({ kind: "stock", key: item.key })}><Plus size={14} /> Registrar entrada</button></div></div>}
          <div className="sale-line-values">
            <Field label="Quantidade *"><input id={`${formId}-${item.key}-quantity`} name="quantity" type="number" min="1" step="1" max={Math.max(0, available)} required value={item.quantity}
              onChange={(event) => updateCart(items.map((entry) => entry.key === item.key ? { ...entry, quantity: event.target.value } : entry), item.key)} /></Field>
            <div><span>Preço unitário</span><strong>{product ? product.pricePending ? "Preço pendente" : money(product.price) : "Selecione o produto"}</strong></div>
            <div><span>Subtotal</span><strong>{amount === null ? "A calcular" : money(amount)}</strong></div>
          </div>
        </div>)}
        {!rows.length && <div className="notice notice-info">Adicione um produto para continuar com este pedido.</div>}
      </div>
      <button id={`${formId}-add`} type="button" className="button button-secondary sale-add-item" onClick={() => {
        const key = uid(); setItems((previous) => [...previous, { key, productId: "", quantity: "1" }]); setFocus({ key, control: "product" });
      }}><Plus size={16} /> Adicionar produto</button>
      <div className="amount-highlight"><span>Total do pedido · {rows.length} {rows.length === 1 ? "produto" : "produtos"}</span>
        <strong>{total !== null ? money(total) : rows.some((row) => row.product?.pricePending) ? "Preço pendente" : "Complete os itens"}</strong></div>
      <FormError message={error} /><FormActions onClose={onCancel} label="Confirmar e reservar" disabled={!canConfirm} />
    </form>
    {auxiliary?.kind === "customer" && <ContextualDialog title="Novo cliente" description="Cadastre o cliente para continuar esta venda." onClose={() => setAuxiliary(null)}>
      <CustomerEditor onSaved={(saved) => { setCustomerId(saved.id); setAuxiliary(null); }} onCancel={() => setAuxiliary(null)} />
    </ContextualDialog>}
    {auxiliary?.kind === "product" && activeItem && <ContextualDialog title="Novo produto" description="Cadastro não altera a quantidade em estoque nem confirma a venda." onClose={() => setAuxiliary(null)}>
      <ProductEditor onSaved={(saved) => { changeProduct(activeItem.key, saved.id); setAuxiliary(null); }} onCancel={() => setAuxiliary(null)} />
    </ContextualDialog>}
    {auxiliary?.kind === "pricing" && activeProduct && <ContextualDialog title="Definir preço do produto" description="Altere o cadastro sem perder os dados desta venda." onClose={() => setAuxiliary(null)}>
      <ProductEditor product={activeProduct} focusPrice onSaved={() => setAuxiliary(null)} onCancel={() => setAuxiliary(null)} />
    </ContextualDialog>}
    {auxiliary?.kind === "stock" && activeProduct && <ContextualDialog title="Registrar entrada manual" description={activeProduct.name} onClose={() => setAuxiliary(null)}>
      <StockEntryEditor product={activeProduct} onSaved={() => setAuxiliary(null)} onCancel={() => setAuxiliary(null)} />
    </ContextualDialog>}
  </>;
}
