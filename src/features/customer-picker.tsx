"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Field } from "@/components/ui";
import { accessBase, accessRequest, AccessError } from "@/lib/access-api";
import styles from "./customer-picker.module.css";

export type CustomerChoice = { id: string; name: string; phone?: string; email?: string; type?: string; active?: boolean };
type Results = { tenantId: string; items: CustomerChoice[]; total: number };

export function CustomerPicker({ tenant, value, onChange, onUnauthorized, onCreate }: {
  tenant: string; value: CustomerChoice | null; onChange: (customer: CustomerChoice | null) => void; onUnauthorized: (error: unknown) => void; onCreate?: () => void;
}) {
  const id = useId(), root = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState<string | null>(null), [open, setOpen] = useState(false), [options, setOptions] = useState<CustomerChoice[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading"), [active, setActive] = useState(-1), [retry, setRetry] = useState(0), [more, setMore] = useState(false);
  const generation = useRef(0), flight = useRef<AbortController | null>(null), unauthorized = useRef(onUnauthorized);
  useEffect(() => { unauthorized.current = onUnauthorized; }, [onUnauthorized]);
  // A contextual registration can select a new customer without another lookup.
  useEffect(() => { if (value) { setQuery(null); setOpen(false); } }, [value?.id, value?.name]);
  const term = (query ?? value?.name ?? "").slice(0, 100), selected = Boolean(value && query === null);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(), current = ++generation.current;
    flight.current = controller; setPhase("loading"); setOptions([]); setActive(-1); setMore(false);
    const timer = setTimeout(() => {
      void accessRequest<Results>(`${accessBase(tenant)}/customers?limit=20&q=${encodeURIComponent(term)}`, { signal: controller.signal }).then((result) => {
        if (controller.signal.aborted || current !== generation.current) return;
        if (result.tenantId !== tenant || !Array.isArray(result.items) || result.items.some((row) => typeof row.id !== "string" || typeof row.name !== "string")) throw new AccessError(503);
        setOptions(result.items.filter((row) => row.active !== false)); setMore(result.total > 20); setPhase("ready");
      }).catch((error) => {
        if (controller.signal.aborted || current !== generation.current) return;
        setOptions([]); setPhase("error");
        if (error instanceof AccessError && [401, 403].includes(error.status)) unauthorized.current(error);
      });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [tenant, term, open, retry]);
  useEffect(() => { input.current?.setCustomValidity(selected ? "" : "Escolha o cliente nos resultados."); }, [selected, query]);
  useEffect(() => {
    if (open && active >= 0) root.current?.querySelectorAll<HTMLElement>('[role="option"]')[active]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, open, options]);
  function choose(customer: CustomerChoice) {
    generation.current++; flight.current?.abort(); setQuery(null); setOpen(false); setOptions([]); setActive(-1); onChange(customer); input.current?.focus();
  }
  const helper = selected ? ["Cliente selecionado", value?.phone, value?.email].filter(Boolean).join(" · ") : "Digite e escolha o cliente nos resultados.";
  return <div ref={root} className={styles.picker} onBlur={(event) => { if (!root.current?.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <Field label="Cliente"><input ref={input} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={open ? `${id}-results` : undefined}
      aria-activedescendant={open && active >= 0 && options[active] ? `${id}-option-${active}` : undefined} aria-describedby={`${id}-help`} required maxLength={100} autoComplete="off"
      placeholder="Nome, telefone ou e-mail" value={query ?? value?.name ?? ""} onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
      onChange={(event) => { generation.current++; flight.current?.abort(); setOptions([]); setPhase("loading"); setActive(-1); setQuery(event.target.value); setOpen(true); onChange(null); }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); setOpen(true);
          if (options.length) setActive((old) => event.key === "ArrowDown" ? (old + 1) % options.length : (old <= 0 ? options.length - 1 : old - 1));
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault(); event.stopPropagation();
          const choice = phase === "ready" && open ? options[active >= 0 ? active : !selected && options.length === 1 ? 0 : -1] : undefined;
          if (choice) choose(choice); else setOpen(!selected);
        }
      }} /></Field>
    <small id={`${id}-help`} className={styles.help}>{helper}</small>
    {open && <div className={styles.suggestions}>
      {phase === "loading" && <p role="status">Buscando clientes…</p>}
      {phase === "error" && <><p role="alert">Não foi possível buscar clientes.</p><button type="button" className="button button-secondary" onClick={() => setRetry((old) => old + 1)}>Tentar buscar clientes novamente</button></>}
      <ul id={`${id}-results`} role="listbox" aria-label="Resultados de clientes" aria-busy={phase === "loading"}>
        {phase === "ready" && options.map((customer, index) => <li key={customer.id} id={`${id}-option-${index}`} role="option" aria-selected={index === active} className={index === active ? styles.highlighted : ""}
          onPointerDown={(event) => event.preventDefault()} onClick={() => choose(customer)}>
          <strong>{customer.name}</strong><small>{[customer.phone, customer.email, customer.type].filter(Boolean).join(" · ")}</small>
        </li>)}
      </ul>
      {phase === "ready" && options.length === 0 && <p role="status">Nenhum cliente ativo encontrado.</p>}
      {phase === "ready" && more && <p>Há mais resultados. Refine o nome, telefone ou e-mail.</p>}
    </div>}
    {onCreate && <button type="button" className="button button-secondary" onClick={() => { setOpen(false); onCreate(); }}>Cadastrar cliente aqui</button>}
  </div>;
}
