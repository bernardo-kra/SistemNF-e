"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Field } from "@/components/ui";
import { accessBase, accessRequest, AccessError } from "@/lib/access-api";
import { money } from "@/lib/domain";
import styles from "./customer-picker.module.css";

export type ProductChoice = {
  id: string; name: string; sku: string; version: number; salePriceCents: number | null;
  active?: boolean; serialized?: boolean; gtin?: string; stock?: { available?: number };
};
type Results = { tenantId: string; items: ProductChoice[]; total: number };

// Shares the customer picker's layout; results are local to this field, never the cart cache.
export function ProductPicker({ tenant, index, value, onChange, onUnauthorized }: {
  tenant: string; index: number; value: ProductChoice | null; onChange: (product: ProductChoice | null) => void; onUnauthorized: (error: unknown) => void;
}) {
  const id = useId(), root = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState<string | null>(null), [open, setOpen] = useState(false), [options, setOptions] = useState<ProductChoice[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading"), [active, setActive] = useState(-1), [retry, setRetry] = useState(0), [more, setMore] = useState(false);
  const generation = useRef(0), flight = useRef<AbortController | null>(null), unauthorized = useRef(onUnauthorized);
  useEffect(() => { unauthorized.current = onUnauthorized; }, [onUnauthorized]);
  useEffect(() => { if (value) { setQuery(null); setOpen(false); } }, [value?.id, value?.name]);
  const term = (query ?? value?.name ?? "").slice(0, 100), selected = Boolean(value && query === null);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(), current = ++generation.current;
    flight.current = controller; setPhase("loading"); setOptions([]); setActive(-1); setMore(false);
    const timer = setTimeout(() => {
      void accessRequest<Results>(`${accessBase(tenant)}/operations/products?status=active&limit=20&q=${encodeURIComponent(term)}`, { signal: controller.signal }).then((result) => {
        if (controller.signal.aborted || current !== generation.current) return;
        if (result.tenantId !== tenant || !Array.isArray(result.items) || result.items.some((row) => typeof row.id !== "string" || typeof row.name !== "string" || typeof row.sku !== "string" || !Number.isSafeInteger(row.version) || (row.salePriceCents !== null && (!Number.isSafeInteger(row.salePriceCents) || row.salePriceCents < 0)))) throw new AccessError(503);
        setOptions(result.items.filter((row) => row.active !== false)); setMore(result.total > 20); setPhase("ready");
      }).catch((error) => {
        if (controller.signal.aborted || current !== generation.current) return;
        setOptions([]); setPhase("error");
        if (error instanceof AccessError && [401, 403].includes(error.status)) unauthorized.current(error);
      });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [tenant, term, open, retry]);
  useEffect(() => { input.current?.setCustomValidity(selected ? "" : "Escolha o produto nos resultados."); }, [selected, query]);
  useEffect(() => {
    if (open && active >= 0) root.current?.querySelectorAll<HTMLElement>('[role="option"]')[active]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, open, options]);
  function choose(product: ProductChoice) {
    generation.current++; flight.current?.abort(); setQuery(null); setOpen(false); setOptions([]); setActive(-1); onChange(product); input.current?.focus();
  }
  function description(product: ProductChoice) {
    return [product.sku, product.gtin, product.salePriceCents === null ? "Preço pendente" : money(product.salePriceCents), product.stock?.available == null ? "Saldo não informado" : `${product.stock.available} disponíveis`, product.serialized ? "Controle por série" : ""].filter(Boolean).join(" · ");
  }
  return <div ref={root} className={styles.picker} onBlur={(event) => { if (!root.current?.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <Field label={`Produto ${index}`}><input ref={input} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={open ? `${id}-results` : undefined}
      aria-activedescendant={open && active >= 0 && options[active] ? `${id}-option-${active}` : undefined} aria-describedby={`${id}-help`} required maxLength={100} autoComplete="off"
      placeholder="Nome, SKU ou código" value={query ?? value?.name ?? ""} onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
      onChange={(event) => { generation.current++; flight.current?.abort(); setOptions([]); setPhase("loading"); setActive(-1); setQuery(event.target.value); setOpen(true); onChange(null); }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); setOpen(true);
          if (options.length) setActive((old) => event.key === "ArrowDown" ? (old + 1) % options.length : old <= 0 ? options.length - 1 : old - 1);
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault(); event.stopPropagation();
          const choice = phase === "ready" && open ? options[active >= 0 ? active : !selected && options.length === 1 ? 0 : -1] : undefined;
          if (choice) choose(choice); else setOpen(!selected);
        }
      }} /></Field>
    <small id={`${id}-help`} className={styles.help}>{selected && value ? description(value) : "Digite e escolha o produto nos resultados."}</small>
    {open && <div className={styles.suggestions}>
      {phase === "loading" && <p role="status">Buscando produtos…</p>}
      {phase === "error" && <><p role="alert">Não foi possível buscar produtos.</p><button type="button" className="button button-secondary" onClick={() => setRetry((old) => old + 1)}>Tentar buscar produtos novamente</button></>}
      <ul id={`${id}-results`} role="listbox" aria-label={`Resultados de produtos ${index}`} aria-busy={phase === "loading"}>
        {phase === "ready" && options.map((product, optionIndex) => <li key={product.id} id={`${id}-option-${optionIndex}`} role="option" aria-selected={optionIndex === active} className={optionIndex === active ? styles.highlighted : ""}
          onPointerDown={(event) => event.preventDefault()} onClick={() => choose(product)}><strong>{product.name}</strong><small>{description(product)}</small></li>)}
      </ul>
      {phase === "ready" && options.length === 0 && <p role="status">Nenhum produto ativo encontrado.</p>}
      {phase === "ready" && more && <p>Há mais resultados. Refine o nome, SKU ou código.</p>}
    </div>}
  </div>;
}
