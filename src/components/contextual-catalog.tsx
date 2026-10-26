"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Mail } from "lucide-react";
import { useDemo, uid } from "@/lib/demo-store";
import type { Customer, Product, Technician } from "@/lib/domain";
import { AddressFields, readAddress } from "./fiscal-fields";
import { ProductProfit } from "./product-profit";
import { Field, FormActions, FormError, Modal } from "./ui";

type EditorProps<T> = { onSaved: (record: T) => void; onCancel: () => void };
const errorText = (error: unknown) => error instanceof Error ? error.message : "Confira os dados e tente novamente.";

/** A separate DOM form keeps the parent's uncontrolled draft and native validation intact. */
export function ContextualDialog({ title, description, onClose, children }: {
  title: string; description?: string; onClose: () => void; children: ReactNode;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const fallback = useRef<HTMLElement | null>(null);
  useEffect(() => {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const parent = trigger.current?.closest("dialog");
    const cartItem = trigger.current?.closest("[data-cart-item]");
    fallback.current = cartItem?.querySelector<HTMLElement>('select[name="productId"]')
      ?? parent?.querySelector<HTMLElement>('select[name="productId"]')
      ?? parent?.querySelector<HTMLElement>('select:not([disabled]), input:not([disabled]), textarea:not([disabled])') ?? null;
    setHost(document.body);
    return () => {
      const previous = trigger.current;
      const field = fallback.current;
      queueMicrotask(() => {
        if (previous?.isConnected) previous.focus();
        else if (field?.isConnected) field.focus();
      });
    };
  }, []);
  if (!host) return null;
  return createPortal(
    <Modal title={title} description={description} onClose={onClose}
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose(); }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
        if (event.key !== "Tab") return;
        const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], summary, [tabindex]:not([tabindex="-1"])',
        )].filter((element) => element.getClientRects().length > 0 && element.tabIndex >= 0);
        const first = focusable[0], last = focusable.at(-1);
        if (!first || !last) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || !focusable.includes(document.activeElement as HTMLElement))) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus();
        }
      }}>
      {children}
    </Modal>, host,
  );
}

export function CategoryField({ defaultValue = "Acessórios" }: { defaultValue?: string }) {
  const { state } = useDemo();
  const listId = useId();
  const values = [...new Set(["Acessórios", "Armazenamento", "Componentes", "Periféricos", "Computadores",
    ...state.products.map((product) => product.category), defaultValue])].filter(Boolean);
  return <Field label="Categoria">
    <input name="category" defaultValue={defaultValue} list={listId} maxLength={80}
      placeholder="Escolha ou digite uma nova categoria" />
    <datalist id={listId}>{values.map((value) => <option key={value} value={value} />)}</datalist>
  </Field>;
}

export function CustomerEditor({ customer, onSaved, onCancel }: EditorProps<Customer> & { customer?: Customer }) {
  const { saveCustomer } = useDemo();
  const [initial] = useState<Customer>(() => customer ?? { id: uid(), name: "", email: "", phone: "", type: "Pessoa física" });
  const [error, setError] = useState("");
  const submitted = useRef(false);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); event.stopPropagation();
    if (submitted.current) return;
    const data = new FormData(event.currentTarget);
    try {
      submitted.current = true;
      const next: Customer = { ...initial,
        name: String(data.get("name") || "").trim(), email: String(data.get("email") || "").trim(),
        phone: String(data.get("phone") || "").trim(), type: String(data.get("type")) as Customer["type"],
        document: String(data.get("document") || "").trim(), fiscalAddress: readAddress(data) };
      saveCustomer(next); onSaved(next);
    } catch (failure) { submitted.current = false; setError(errorText(failure)); }
  };
  return <form onSubmit={submit}>
    <div className="form-grid">
      <Field label="Nome / razão social *" className="full"><input name="name" required maxLength={100} defaultValue={initial.name} autoFocus /></Field>
      <Field label="Tipo de cliente"><select name="type" defaultValue={initial.type}><option>Pessoa física</option><option>Empresa</option></select></Field>
      <Field label="Telefone"><input name="phone" type="tel" maxLength={25} defaultValue={initial.phone} /></Field>
      <Field label="E-mail" className="full"><input name="email" type="email" maxLength={120} defaultValue={initial.email} /></Field>
    </div>
    <details className="fiscal-form-details">
      <summary>Dados fiscais e endereço · opcionais no cadastro</summary>
      <p>A preparação fiscal aponta quando estes dados forem necessários para a simulação. Não consultamos situação cadastral.</p>
      <div className="form-grid">
        <Field label="CPF / CNPJ" className="full"><input name="document" defaultValue={initial.document || ""} maxLength={18}
          placeholder="CNPJ também aceita letras" autoCapitalize="characters" /></Field>
        <AddressFields address={initial.fiscalAddress} />
      </div>
    </details>
    <div className="form-note"><Mail size={16} />Nenhuma mensagem será enviada por este protótipo.</div>
    <FormError message={error} /><FormActions onClose={onCancel} label="Salvar cliente" />
  </form>;
}

export function ProductEditor({ product, onSaved, onCancel, focusPrice = false }: EditorProps<Product> & { product?: Product; focusPrice?: boolean }) {
  const { saveProduct } = useDemo();
  const [initial] = useState<Product>(() => product ?? { id: uid(), sku: "", name: "", category: "Acessórios", unit: "UN",
    cost: 0, price: 0, stock: 0, reserved: 0, minimum: 2, serialized: false, ncm: "" });
  const [cost, setCost] = useState<number | null>(initial.cost);
  const [price, setPrice] = useState<number | null>(initial.pricePending ? null : initial.price);
  const [error, setError] = useState("");
  const submitted = useRef(false);
  const salePriceInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!focusPrice) return;
    // showModal runs after React mounts its children and can reset autofocus.
    const frame = requestAnimationFrame(() => salePriceInput.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [focusPrice]);
  const centsFromInput = (input: HTMLInputElement) =>
    input.value !== "" && input.validity.valid ? Math.round(input.valueAsNumber * 100) : null;
  return <form onSubmit={(event) => {
    event.preventDefault(); event.stopPropagation();
    if (submitted.current) return;
    const data = new FormData(event.currentTarget);
    try {
      submitted.current = true;
      const next: Product = { ...initial, name: String(data.get("name") || "").trim(), sku: String(data.get("sku") || "").trim(),
        category: String(data.get("category") || "").trim(), price: Math.round(Number(data.get("price")) * 100), pricePending: false,
        cost: Math.round(Number(data.get("cost")) * 100), ncm: String(data.get("ncm") || "").trim(), serialized: data.get("serialized") === "on" };
      saveProduct(next); onSaved(next);
    } catch (failure) { submitted.current = false; setError(errorText(failure)); }
  }}>
    <div className="form-grid">
      <Field label="Nome do produto *" className="full"><input name="name" required maxLength={100} defaultValue={initial.name} autoFocus={!focusPrice} /></Field>
      <Field label="SKU / código interno *"><input name="sku" required maxLength={30} defaultValue={initial.sku} /></Field>
      <CategoryField defaultValue={initial.category} />
      <Field label="Preço de compra (R$) *"><input name="cost" type="number" min="0" max="9999999" step="0.01" required defaultValue={initial.cost / 100} onChange={(event) => setCost(centsFromInput(event.currentTarget))} /></Field>
      <Field label="Preço de venda (R$) *"><input ref={salePriceInput} name="price" type="number" min="0" max="9999999" step="0.01" required defaultValue={initial.pricePending ? "" : initial.price / 100} autoFocus={focusPrice} onChange={(event) => setPrice(centsFromInput(event.currentTarget))} /></Field>
      <div className="product-pricing-summary full">
        <span>Lucro estimado por unidade</span>
        <ProductProfit cost={cost} price={price} announce />
        <p>Estimativa antes de impostos, taxas e outras despesas. A compra usa o valor de referência do cadastro; a margem é calculada sobre a venda.</p>
      </div>
      <Field label="NCM"><input name="ncm" defaultValue={initial.ncm} placeholder="Completar após revisão fiscal" maxLength={8} pattern="[0-9]{8}|" /></Field>
      <label className="checkbox-field"><input type="checkbox" name="serialized" defaultChecked={initial.serialized} />Controlar por número de série</label>
    </div>
    <FormError message={error} /><FormActions onClose={onCancel} label="Salvar produto" />
  </form>;
}

export function TechnicianEditor({ onSaved, onCancel }: EditorProps<Technician>) {
  const { saveTechnician } = useDemo();
  const [id] = useState(uid);
  const [error, setError] = useState("");
  const submitted = useRef(false);
  return <form onSubmit={(event) => {
    event.preventDefault(); event.stopPropagation();
    if (submitted.current) return;
    const data = new FormData(event.currentTarget);
    try {
      submitted.current = true;
      onSaved(saveTechnician({ id, name: String(data.get("name") || "") }));
    } catch (failure) { submitted.current = false; setError(errorText(failure)); }
  }}>
    <p className="contextual-note">Cadastre o responsável pelo serviço. Este cadastro operacional não cria usuário, senha ou acesso ao sistema.</p>
    <Field label="Nome do técnico *"><input name="name" required maxLength={100} autoFocus /></Field>
    <FormError message={error} /><FormActions onClose={onCancel} label="Salvar técnico" />
  </form>;
}

export function StockEntryEditor({ product, onSaved, onCancel }: { product: Product; onSaved: () => void; onCancel: () => void }) {
  const { receiveStock } = useDemo();
  const [error, setError] = useState("");
  const submitted = useRef(false);
  return <form onSubmit={(event) => {
    event.preventDefault(); event.stopPropagation();
    if (submitted.current) return;
    const data = new FormData(event.currentTarget);
    try {
      submitted.current = true;
      receiveStock(product.id, Number(data.get("quantity")), String(data.get("reason") || "")); onSaved();
    } catch (failure) { submitted.current = false; setError(errorText(failure)); }
  }}>
    <div className="notice notice-info">A quantidade será somada ao estoque físico. Esta entrada demonstrativa não gera nota fiscal ou conta a pagar e não confirma a venda.</div>
    <Field label="Quantidade recebida *"><input name="quantity" type="number" min="1" max="100000" step="1" required defaultValue={1} autoFocus /></Field>
    <Field label="Motivo / referência *"><input name="reason" required maxLength={160} placeholder="Ex.: conferência da compra recebida" /></Field>
    <FormError message={error} /><FormActions onClose={onCancel} label="Confirmar entrada" />
  </form>;
}
