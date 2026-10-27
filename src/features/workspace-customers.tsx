"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Field, Modal, PageHeader } from "@/components/ui";
import { accessBase, accessDate, accessRequest, AccessError } from "@/lib/access-api";
import { useWorkspace } from "./workspace-session";
import styles from "./access-control.module.css";

type Customer = { id: string; name: string; email: string; phone: string; type: string; active: boolean; version: number; createdAt: string; updatedAt: string };
export function WorkspaceCustomers() {
  const { identity, tenant, handleError } = useWorkspace(), rights = identity!.tenants.find((entry) => entry.id === tenant)!.permissions;
  const [page, setPage] = useState<{ items: Customer[]; total: number } | null>(null), [query, setQuery] = useState(""), [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0), [revision, setRevision] = useState(0), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<Customer | "new" | null>(null), opener = useRef<HTMLElement | null>(null);
  const fail = useCallback((failure: unknown) => { if (failure instanceof AccessError && [401,403].includes(failure.status)) handleError(failure); else setError(failure instanceof Error ? failure.message : "Não foi possível consultar os clientes."); }, [handleError]);
  useEffect(() => { const timer = setTimeout(() => setSearch(query), 300); return () => clearTimeout(timer); }, [query]);
  useEffect(() => {
    const controller = new AbortController(); setPage(null); setError("");
    void accessRequest<{ tenantId: string; items: Customer[]; total: number }>(`${accessBase(tenant)}/customers?q=${encodeURIComponent(search)}&limit=25&offset=${offset}`, { signal: controller.signal }).then((data) => {
      if (controller.signal.aborted) return; if (data.tenantId !== tenant || !Array.isArray(data.items)) throw new AccessError(503); setPage(data);
    }).catch((failure) => { if (!controller.signal.aborted) fail(failure); });
    return () => controller.abort();
  }, [tenant, search, offset, revision, fail]);
  useEffect(() => { if (new URLSearchParams(window.location.search).has("novo") && rights.includes("customers.create")) setEditing("new"); }, []);
  const close = () => { setEditing(null); requestAnimationFrame(() => opener.current?.focus()); };
  return <><PageHeader eyebrow="RELACIONAMENTOS" title="Clientes" description="Contatos compartilhados pela empresa, com cadastro e alteração registrados." action={rights.includes("customers.create") ? <button className="button button-primary" onClick={(event) => { opener.current = event.currentTarget; setEditing("new"); }}>Novo cliente</button> : undefined} />
    {error && <p role="alert" className={styles.error}>{error}</p>}{notice && <p role="status" className={styles.notice}>{notice}</p>}
    <section className={styles.panel}><div className={styles.filters}><Field label="Buscar cliente"><input maxLength={100} value={query} onChange={(event) => { setQuery(event.target.value); setOffset(0); }} placeholder="Nome, e-mail ou telefone" /></Field></div>
      {!page ? <p role="status" className={styles.empty}>{error ? "Consulta não concluída." : "Carregando clientes…"}</p> : !page.items.length ? <p className={styles.empty}>Nenhum cliente encontrado.</p> : <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Cliente</th><th>Contato</th><th>Situação</th><th>Última alteração</th><th>Ações</th></tr></thead><tbody>{page.items.map((customer) => <tr key={customer.id}><td><strong>{customer.name}</strong><small>{customer.type}</small></td><td>{customer.email || "—"}<small>{customer.phone}</small></td><td>{customer.active ? "Ativo" : "Inativo"}</td><td>{accessDate(customer.updatedAt)}<small>Cadastro: {accessDate(customer.createdAt)}</small></td><td>{rights.includes("customers.update") && <button aria-label={`Editar cliente ${customer.name}`} onClick={(event) => { opener.current = event.currentTarget; setEditing(customer); }}>Editar cliente</button>}</td></tr>)}</tbody></table></div>}
      {page && <div className={styles.footer}><span>{page.total} clientes</span><div><button disabled={!offset} onClick={() => setOffset(Math.max(0,offset-25))}>Anterior</button><button disabled={offset+25>=page.total} onClick={() => setOffset(offset+25)}>Próxima</button></div></div>}
    </section>{editing && <CustomerEditor key={editing === "new" ? "new" : editing.id} tenant={tenant} initial={editing === "new" ? null : editing} canArchive={rights.includes("customers.archive")} onClose={close} onUnauthorized={handleError} onSaved={() => { close(); setNotice("Cliente salvo."); setRevision((n) => n+1); }} />}</>;
}
function CustomerEditor({ tenant, initial, canArchive, onClose, onSaved, onUnauthorized }: { tenant: string; initial: Customer | null; canArchive: boolean; onClose: () => void; onSaved: () => void; onUnauthorized: (error: unknown) => void }) {
  const [draft, setDraft] = useState({ name: initial?.name ?? "", email: initial?.email ?? "", phone: initial?.phone ?? "", type: initial?.type ?? "Pessoa física", active: initial?.active ?? true });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const alive = useRef(true), flight = useRef(false), attempt = useRef<{ content: string; id: string } | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const close = () => { if (!flight.current) onClose(); };
  return <Modal title={initial ? "Editar cliente" : "Novo cliente"} onClose={close} onCancel={(event) => { if (flight.current) event.preventDefault(); else close(); }}><form onSubmit={async (event) => {
    event.preventDefault(); if (flight.current) return; flight.current = true; setBusy(true); setError("");
    try {
      const data = { name: draft.name, email: draft.email, phone: draft.phone, type: draft.type };
      const content = JSON.stringify(data); if (attempt.current?.content !== content) attempt.current = { content, id: crypto.randomUUID() };
      const body = initial ? { ...data, version: initial.version, ...(canArchive && initial.active !== draft.active ? { active: draft.active } : {}) } : { ...data, requestId: attempt.current!.id };
      const saved = await accessRequest<{ tenantId: string }>(`${accessBase(tenant)}/customers${initial ? `/${initial.id}` : ""}`, { method: initial ? "PATCH" : "POST", body });
      if (saved.tenantId !== tenant) throw new AccessError(503); if (alive.current) onSaved();
    } catch (failure) { if (alive.current) { if (failure instanceof AccessError && [401,403].includes(failure.status)) onUnauthorized(failure); else setError(failure instanceof Error ? failure.message : "Não foi possível salvar."); } }
    finally { flight.current = false; if (alive.current) setBusy(false); }
  }}><fieldset disabled={busy} className={styles.form} style={{ border: 0, padding: 0 }}>{error && <p role="alert" className={styles.error}>{error}</p>}
    <Field label="Nome"><input required maxLength={120} autoFocus value={draft.name} onChange={(event) => setDraft((d) => ({ ...d, name: event.target.value }))} /></Field>
    <Field label="E-mail"><input type="email" maxLength={254} value={draft.email} onChange={(event) => setDraft((d) => ({ ...d, email: event.target.value }))} /></Field>
    <Field label="Telefone"><input maxLength={32} value={draft.phone} onChange={(event) => setDraft((d) => ({ ...d, phone: event.target.value }))} /></Field>
    <Field label="Tipo"><select value={draft.type} onChange={(event) => setDraft((d) => ({ ...d, type: event.target.value }))}><option>Pessoa física</option><option>Empresa</option></select></Field>
    {initial && canArchive && <label><input type="checkbox" checked={draft.active} onChange={(event) => setDraft((d) => ({ ...d, active: event.target.checked }))} />Cliente ativo</label>}
    <div className="form-actions"><button type="button" className="button button-secondary" onClick={close}>Cancelar</button><button type="submit" className="button button-primary">{busy ? "Salvando…" : "Salvar cliente"}</button></div>
  </fieldset></form></Modal>;
}
