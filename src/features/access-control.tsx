"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Field, Modal, PageHeader } from "@/components/ui";
import { accessBase, accessDate, accessRequest, AccessError, type AccessAudit, type AccessIdentity, type AccessMember, type AccessOptions, type AccessPage, type AccessRole } from "@/lib/access-api";
import { useWorkspace } from "./workspace-session";
import styles from "./access-control.module.css";

const roles = { owner: "Gestor", operator: "Atendimento", viewer: "Consulta" };
const message = (error: unknown) => error instanceof AccessError ? error.message : "Não foi possível concluir a operação. Tente novamente.";

export function AccessControl() {
  const { phase, identity, tenant, refresh: loadIdentity, handleError } = useWorkspace();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const [options, setOptions] = useState<AccessOptions | null>(null);
  const [members, setMembers] = useState<AccessPage<AccessMember> | null>(null);
  const [audit, setAudit] = useState<AccessPage<AccessAudit> | null>(null);
  const [editor, setEditor] = useState<AccessMember | "new" | null>(null);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("name");
  const [dateField, setDateField] = useState("created");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offset, setOffset] = useState(0);
  const [auditOffset, setAuditOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const opener = useRef<HTMLButtonElement | null>(null);
  const activeCompany = identity?.tenants.find((item) => item.id === tenant);
  const canManage = activeCompany?.permissions.includes("team.manage") === true && !accessDenied;

  const clearData = useCallback(() => {
    setMembers(null); setAudit(null); setOptions(null); setEditor(null); setNotice("");
    setQuery(""); setDebounced(""); setStatus("all"); setSort("name"); setDateField("created"); setFrom(""); setTo(""); setOffset(0); setAuditOffset(0);
  }, []);
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => { const timer = setTimeout(() => setDebounced(query), 300); return () => clearTimeout(timer); }, [query]);

  const dataFailure = useCallback((failure: unknown) => {
    if (failure instanceof AccessError && failure.status === 401) { generation.current++; clearData(); handleError(failure); return; }
    if (failure instanceof AccessError && failure.status === 403) { generation.current++; clearData(); setAccessDenied(true); }
    setError(message(failure));
  }, [handleError, clearData]);

  useEffect(() => {
    setOptions(null); setAudit(null); setEditor(null);
    if (!tenant || !canManage || phase !== "ready") return;
    const controller = new AbortController(), tag = generation.current;
    void accessRequest<AccessOptions & { tenantId: string }>(`${accessBase(tenant)}/access-options`, { signal: controller.signal })
      .then((data) => { if (tag === generation.current && !controller.signal.aborted) { if (data.tenantId !== tenant) throw new AccessError(503); setOptions(data); } })
      .catch((failure) => { if (!controller.signal.aborted && tag === generation.current) dataFailure(failure); });
    return () => controller.abort();
  }, [tenant, canManage, phase, dataFailure]);

  useEffect(() => {
    setMembers(null);
    if (!tenant || !canManage || phase !== "ready") return;
    const controller = new AbortController(), tag = generation.current;
    const params = new URLSearchParams({ q: debounced, status, sort, dateField, limit: "25", offset: String(offset) });
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    void accessRequest<AccessPage<AccessMember>>(`${accessBase(tenant)}/members?${params}`, { signal: controller.signal })
      .then((data) => { if (tag === generation.current && !controller.signal.aborted) { if (data.tenantId !== tenant || !Array.isArray(data.items)) throw new AccessError(503); setMembers(data); } })
      .catch((failure) => { if (!controller.signal.aborted && tag === generation.current) dataFailure(failure); });
    return () => controller.abort();
  }, [tenant, canManage, phase, debounced, status, sort, dateField, from, to, offset, revision, dataFailure]);

  useEffect(() => {
    setAudit(null);
    if (!tenant || !canManage || phase !== "ready") return;
    const controller = new AbortController(), tag = generation.current;
    void accessRequest<AccessPage<AccessAudit>>(`${accessBase(tenant)}/access-audit?limit=25&offset=${auditOffset}`, { signal: controller.signal })
      .then((data) => { if (tag === generation.current && !controller.signal.aborted) { if (data.tenantId !== tenant || !Array.isArray(data.items)) throw new AccessError(503); setAudit(data); } })
      .catch((failure) => { if (!controller.signal.aborted && tag === generation.current) dataFailure(failure); });
    return () => controller.abort();
  }, [tenant, canManage, phase, revision, auditOffset, dataFailure]);

  const closeEditor = () => { setEditor(null); requestAnimationFrame(() => opener.current?.focus()); };
  const openEditor = (event: React.MouseEvent<HTMLButtonElement>, member: AccessMember | "new") => { opener.current = event.currentTarget; setEditor(member); setNotice(""); };

  const identify = (id: string) => members?.items.find((item) => item.id === id)?.name ?? (identity?.user.id === id ? identity.user.name : `Conta ${id}`);
  return <><PageHeader eyebrow="GESTÃO DA EQUIPE" title="Equipe e acessos" description="Contas individuais, permissões e histórico da equipe." />
        {error && <div className={styles.error} role="alert">{error} <button type="button" className="button button-secondary" onClick={() => void loadIdentity()}>Atualizar acessos</button></div>}
        {notice && <p className={styles.notice} role="status">{notice}</p>}
        {!identity?.tenants.length && <p className={styles.empty}>Sua conta não possui vínculo ativo com uma empresa.</p>}
        {!tenant && Boolean(identity?.tenants.length) && <p className={styles.empty}>Escolha a empresa para consultar os acessos.</p>}
        {tenant && !canManage && <p className={styles.notice}>Seu perfil não permite administrar a equipe.</p>}
        {tenant && canManage && <>
          <section className={styles.panel} aria-label="Funcionários">
            <div className={styles.panelHeader}><div><h2>Funcionários de {activeCompany?.name}</h2><p>Escolha um perfil e personalize apenas o que for necessário.</p></div>{options && <button className="button button-primary" onClick={(event) => openEditor(event, "new")}>Novo funcionário</button>}</div>
            <div className={styles.filters}>
              <Field label="Buscar funcionário"><input maxLength={100} value={query} placeholder="Nome ou e-mail" onChange={(event) => { setQuery(event.target.value); setOffset(0); }} /></Field>
              <Field label="Status"><select aria-label="Status" value={status} onChange={(event) => { setStatus(event.target.value); setOffset(0); }}><option value="all">Todos</option><option value="active">Ativos</option><option value="inactive">Inativos</option></select></Field>
              <Field label="Ordenar por"><select aria-label="Ordenar por" value={sort} onChange={(event) => { setSort(event.target.value); setOffset(0); }}><option value="name">Nome</option><option value="created">Últimos cadastros</option><option value="updated">Últimas alterações</option></select></Field>
              <button className="button button-secondary" onClick={() => { setQuery(""); setDebounced(""); setStatus("all"); setSort("name"); setFrom(""); setTo(""); setOffset(0); }}>Limpar filtros</button>
            </div>
            <details className={styles.dates}><summary>Filtrar por período</summary><div className={styles.dateFields}>
              <Field label="Data do vínculo"><select aria-label="Data do vínculo" value={dateField} onChange={(event) => { setDateField(event.target.value); setOffset(0); }}><option value="created">Criado em</option><option value="updated">Alterado em</option></select></Field>
              <Field label="De"><input type="date" value={from} max={to || undefined} onChange={(event) => { setFrom(event.target.value); setOffset(0); }} /></Field>
              <Field label="Até"><input type="date" value={to} min={from || undefined} onChange={(event) => { setTo(event.target.value); setOffset(0); }} /></Field>
            </div></details>
            {!members ? <p className={styles.empty} role="status">{error ? "Consulta não concluída." : "Carregando funcionários…"}</p> : members.items.length === 0 ? <p className={styles.empty}>Nenhum funcionário encontrado com esses filtros.</p> : <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Funcionário</th><th>Perfil</th><th>Situação</th><th>Última alteração</th><th>Ações</th></tr></thead><tbody>{members.items.map((item) => <tr key={item.id}>
              <td><strong>{item.name}</strong><small>{item.email}</small></td><td>{roles[item.role]}{Object.keys(item.overrides).length > 0 && <small>Permissões personalizadas</small>}</td><td><span className={item.active ? styles.active : styles.inactive}>{item.active ? "Ativo" : "Inativo"}</span></td><td>{accessDate(item.updatedAt)}<small>Cadastro: {accessDate(item.createdAt)}</small></td><td><button aria-label={`Editar acessos de ${item.name}`} disabled={!options} onClick={(event) => openEditor(event, item)}>Editar acessos</button></td>
            </tr>)}</tbody></table></div>}
            {members && <div className={styles.footer}><span>{members.total} funcionários encontrados</span><div><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>Anterior</button><button disabled={offset + 25 >= members.total} onClick={() => setOffset(offset + 25)}>Próxima</button></div></div>}
          </section>
          <section className={styles.panel} aria-label="Histórico de acessos"><div className={styles.panelHeader}><div><h2>Histórico de acessos</h2><p>Quem alterou os vínculos e quando. Horários de Brasília.</p></div></div>
            {!audit ? <p className={styles.empty}>{error ? "Consulta não concluída." : "Carregando histórico…"}</p> : audit.items.length === 0 ? <p className={styles.empty}>Nenhuma alteração de acesso registrada.</p> : <ol className={styles.audit}>{audit.items.map((event) => <li key={event.id}><strong>{identify(event.actorId)}</strong> {event.action === "membership.created" ? "cadastrou" : "alterou os acessos de"} <strong>{identify(event.targetId)}</strong><small>{accessDate(event.at)} · Versão {event.version} · {event.fields.map((field) => ({ role: "perfil", active: "situação", overrides: "permissões" }[field] ?? field)).join(", ")}</small></li>)}</ol>}
            {audit && <div className={styles.footer}><span>{audit.total} alterações registradas</span><div><button disabled={auditOffset === 0} onClick={() => setAuditOffset(Math.max(0, auditOffset - 25))}>Mais recentes</button><button disabled={auditOffset + 25 >= audit.total} onClick={() => setAuditOffset(auditOffset + 25)}>Mais antigas</button></div></div>}
          </section>
        </>}
      {editor && options && <MemberEditor key={`${tenant}:${editor === "new" ? "new" : editor.id}`} tenant={tenant} member={editor === "new" ? null : editor} options={options} onClose={closeEditor} onUnauthorized={dataFailure} onSaved={() => { closeEditor(); setError(""); setNotice("Acessos salvos."); setRevision((value) => value + 1); }} />}
  </>;
}

export function LoginForm({ error, onSigned }: { error: string; onSigned: () => Promise<void> }) {
  const [email, setEmail] = useState(""), [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState("");
  return <section className={styles.loginEmbedded}><h2>Entrar no Sistem</h2><p>Use o e-mail e a senha da sua conta.</p><p>O acesso é liberado pela administração. Para obter uma conta, fale com o responsável da sua empresa.</p><form className={styles.form} onSubmit={async (event) => {
    event.preventDefault(); if (busy) return; setBusy(true); setFailure("");
    try { await accessRequest("/api/auth/sign-in/email", { method: "POST", body: { email, password } }); setPassword(""); await onSigned(); }
    catch (issue) { setFailure(message(issue)); }
    finally { setBusy(false); }
  }}>
    {(failure || error) && <p role="alert" className={styles.error}>{failure || error}</p>}
    <Field label="E-mail"><input type="email" autoComplete="username" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
    <Field label="Senha"><input type="password" autoComplete="current-password" required maxLength={1024} value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
    <button type="submit" className="button button-primary" disabled={busy}>{busy ? "Entrando…" : "Entrar"}</button>
  </form></section>;
}

function MemberEditor({ tenant, member, options, onClose, onSaved, onUnauthorized }: { tenant: string; member: AccessMember | null; options: AccessOptions; onClose: () => void; onSaved: () => void; onUnauthorized: (error: unknown) => void }) {
  const [name, setName] = useState(""), [email, setEmail] = useState(""), [password, setPassword] = useState("");
  const [role, setRole] = useState<AccessRole>(member?.role ?? "operator"), [active, setActive] = useState(member?.active ?? true);
  const [overrides, setOverrides] = useState<Record<string, boolean>>(member?.overrides ?? {});
  const [version, setVersion] = useState(member?.version ?? 1);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [conflict, setConflict] = useState(false);
  const attempt = useRef<{ id: string; content: string } | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const defaults = options.roles.find((item) => item.id === role)?.permissions ?? [];
  const enabled = (id: string) => overrides[id] ?? defaults.includes(id);
  function toggle(id: string, checked: boolean) {
    const next = { ...overrides, [id]: checked };
    if (id === "customers.read" && !checked) for (const field of ["customers.create", "customers.update", "customers.archive"]) next[field] = false;
    if (checked && id !== "customers.read") next["customers.read"] = true;
    if (id === "customers.update" && !checked) next["customers.archive"] = false;
    if (id === "customers.archive" && checked) next["customers.update"] = true;
    const dependencies: Record<string, string[]> = {
      "customers.create": ["customers.read"], "customers.update": ["customers.read"], "customers.archive": ["customers.read", "customers.update"],
      "products.create": ["products.read"], "products.update": ["products.read"], "products.archive": ["products.read", "products.update"], "products.cost.read": ["products.read"],
      "stock.read": ["products.read"], "stock.receive": ["stock.read"], "sales.read": ["products.read", "customers.read"], "sales.create": ["sales.read", "stock.read"], "sales.deliver": ["sales.read", "stock.read"],
      "orders.read": ["customers.read"], "orders.create": ["orders.read"], "orders.update": ["orders.read"], "orders.advance": ["orders.read"], "orders.deliver": ["orders.read"],
      "purchases.read": ["products.read", "products.cost.read"], "purchases.import": ["purchases.read"], "purchases.receive": ["purchases.read", "stock.receive"],
      "finance.agreements.create": ["finance.read", "customers.read"], "finance.receive": ["finance.read", "customers.read"], "finance.accounts.manage": ["finance.read"], "finance.cash.manage": ["finance.read"],
    };
    const enable = (permission: string) => { next[permission] = true; for (const dependency of dependencies[permission] ?? []) enable(dependency); };
    if (checked) enable(id);
    const all = [...options.permissions, ...(options.operationalPermissions ?? [])];
    for (let iteration = 0; iteration < all.length; iteration++) for (const permission of all) if ((next[permission.id] ?? defaults.includes(permission.id)) && dependencies[permission.id]?.some((dependency) => !(next[dependency] ?? defaults.includes(dependency)))) next[permission.id] = false;
    for (const key of Object.keys(next)) if (next[key] === defaults.includes(key)) delete next[key];
    setOverrides(next);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError(""); setConflict(false);
    try {
      if (member) await accessRequest(`${accessBase(tenant)}/members/${encodeURIComponent(member.id)}`, { method: "PATCH", body: { version, role, active, overrides } });
      else {
        const body = { name: name.trim(), email: email.trim().toLowerCase(), role, overrides };
        const content = JSON.stringify(body);
        if (!attempt.current || attempt.current.content !== content) attempt.current = { id: crypto.randomUUID(), content };
        await accessRequest(`${accessBase(tenant)}/members`, { method: "POST", body: { ...body, password, requestId: attempt.current.id } });
      }
      if (mounted.current) { setPassword(""); onSaved(); }
    } catch (issue) {
      if (!mounted.current) return;
      if (issue instanceof AccessError && [401, 403].includes(issue.status)) onUnauthorized(issue);
      else { setError(message(issue)); setConflict(Boolean(member && issue instanceof AccessError && issue.status === 409 && issue.code !== "LAST_OWNER")); }
    } finally { if (mounted.current) setBusy(false); }
  }
  async function reload() {
    if (!member || busy) return; setBusy(true);
    try {
      const result = await accessRequest<{ tenantId: string; member: AccessMember }>(`${accessBase(tenant)}/members/${encodeURIComponent(member.id)}`);
      if (!mounted.current) return;
      const current = result.member;
      if (result.tenantId !== tenant || current?.id !== member.id) throw new AccessError(409);
      setRole(current.role); setActive(current.active); setOverrides(current.overrides); setVersion(current.version); setConflict(false); setError("");
    } catch (issue) { if (mounted.current) { if (issue instanceof AccessError && [401, 403].includes(issue.status)) onUnauthorized(issue); else setError(message(issue)); } }
    finally { if (mounted.current) setBusy(false); }
  }
  return <Modal title={member ? `Acessos de ${member.name}` : "Novo funcionário"} description={member ? "Alterar o vínculo preserva a identidade e o histórico da conta." : "Informe a conta e escolha um perfil. Nenhum convite será enviado."} onClose={() => { if (!busy) onClose(); }} onCancel={(event) => { if (busy) event.preventDefault(); else onClose(); }} onKeyDown={(event) => {
    if (event.key !== "Tab") return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,a[href],[tabindex="0"]')].filter((item) => item.getClientRects().length > 0);
    const first = controls[0], last = controls[controls.length - 1];
    if (!first || !last) { event.preventDefault(); return; }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }}>
    <form className={styles.form} onSubmit={(event) => void save(event)}><fieldset className={styles.fields} disabled={busy}>
      {error && <div className={styles.error} role="alert">{error}{conflict && <button type="button" className="button button-secondary" disabled={busy} onClick={() => void reload()}>Recarregar cadastro</button>}</div>}
      {!member && <><Field label="Nome"><input required autoComplete="name" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></Field><Field label="E-mail"><input required type="email" autoComplete="off" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></Field><Field label="Senha inicial"><input required type="password" autoComplete="new-password" minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} /></Field></>}
      {member && <p className={styles.note}>{member.email}</p>}
      <Field label="Perfil"><select aria-label="Perfil" value={role} onChange={(event) => { setRole(event.target.value as AccessRole); setOverrides({}); }}>{options.roles.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field>
      {role === "owner" ? <p className={styles.notice}>Gestores têm todos os direitos dos recursos conectados e administram a equipe. A empresa precisa de pelo menos um gestor ativo.</p> : <><details><summary>Personalizar permissões de clientes</summary><fieldset><legend>Permissões de clientes</legend><div className={styles.checks}>{options.permissions.map((permission) => <label key={permission.id}><input type="checkbox" checked={enabled(permission.id)} onChange={(event) => toggle(permission.id, event.target.checked)} />{permission.label}</label>)}</div></fieldset></details>
        {Boolean(options.operationalPermissions?.length) && <><button type="button" className="button button-secondary" onClick={() => {
          const common = new Set(["products.read", "stock.read", "sales.read", "sales.create", "sales.deliver", "orders.read", "orders.create", "orders.update", "orders.advance", "orders.deliver", "audit.read"]);
          setOverrides((old) => ({ ...old, "customers.read": true, ...Object.fromEntries(options.operationalPermissions!.map((permission) => [permission.id, common.has(permission.id)])) }));
        }}>Aplicar rotina de balcão</button><details><summary>Permissões da operação</summary><fieldset><legend>Direitos por módulo</legend><p className={styles.note}>A configuração de balcão mantém custos e compras restritos. Dependências de consulta são ajustadas automaticamente.</p><div className={styles.checks}>{options.operationalPermissions!.map((permission) => <label key={permission.id}><input type="checkbox" checked={enabled(permission.id)} onChange={(event) => toggle(permission.id, event.target.checked)} />{permission.label}</label>)}</div></fieldset></details></>}
      </>}
      {member && <div className={styles.checks}><label><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />Acesso ativo</label></div>}
      <div className="form-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={onClose}>Cancelar</button><button type="submit" className="button button-primary" disabled={busy}>{busy ? "Salvando…" : member ? "Salvar acessos" : "Salvar funcionário"}</button></div>
    </fieldset></form>
  </Modal>;
}
