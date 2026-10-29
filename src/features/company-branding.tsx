"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Field } from "@/components/ui";
import { accessRequest, AccessError } from "@/lib/access-api";
import { brandingAssetUrl, brandingBase, checkedBranding, decodedImage, readBranding, type Branding, type ReceiptOrder } from "@/lib/branding-api";
import { money, stages, type Stage } from "@/lib/domain";
import { useWorkspace } from "./workspace-session";
import { Building2 } from "lucide-react";
import styles from "./company-branding.module.css";

type BrandContext = { branding: Branding | null; phase: "loading" | "ready" | "error"; error: string; refresh: () => void; acceptSaved: (branding: Branding) => void };
const Context = createContext<BrandContext | null>(null);
export function CompanyBrandingProvider({ tenant, children }: { tenant: string; children: ReactNode }) {
  const { handleError } = useWorkspace();
  const [branding, setBranding] = useState<Branding | null>(null), [phase, setPhase] = useState<BrandContext["phase"]>("loading"), [revision, setRevision] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const controller = new AbortController(), tag = ++generation.current; setBranding(null); setPhase("loading");
    if (!tenant) return () => controller.abort();
    // Defer one turn so StrictMode's trial mount can cancel without a duplicate request.
    const timer = setTimeout(() => { void readBranding(tenant, controller.signal).then((value) => { if (!controller.signal.aborted && tag === generation.current) { setBranding(value); setPhase("ready"); } }).catch((error) => {
      if (controller.signal.aborted || tag !== generation.current) return;
      setPhase("error"); if (error instanceof AccessError && [401, 403].includes(error.status)) handleError(error);
    }); }, 0);
    return () => { clearTimeout(timer); controller.abort(); generation.current++; };
  }, [tenant, revision, handleError]);
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  const acceptSaved = useCallback((value: Branding) => { generation.current++; setBranding(checkedBranding(value)); setPhase("ready"); }, []);
  return <Context.Provider value={{ branding, phase, error: phase === "error" ? "Não foi possível carregar a personalização." : "", refresh, acceptSaved }}>{children}</Context.Provider>;
}
export function useCompanyBranding() { const value = useContext(Context); if (!value) throw new Error("Personalização fora do contexto da empresa."); return value; }
export function CompanyLogo({ companyName }: { companyName: string }) {
  const { tenant } = useWorkspace(), { branding, phase } = useCompanyBranding();
  const [failed, setFailed] = useState(false); useEffect(() => setFailed(false), [tenant, branding?.version]);
  return phase === "ready" && branding?.logo && !failed ? <img className={styles.companyLogo} src={brandingAssetUrl(tenant, "logo", branding.version)} alt={`Logotipo de ${companyName}`} onError={() => setFailed(true)} /> : <Building2 size={20} aria-hidden="true" />;
}

function fileData(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 1024 * 1024 || file.size === 0) return Promise.reject(new Error("Envie uma imagem PNG, JPG ou WebP de até 1 MB."));
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Não foi possível ler a imagem.")); reader.onerror = () => reject(new Error("Não foi possível ler a imagem.")); reader.readAsDataURL(file); });
}
export function BrandingSettings({ tenant, companyName, canManage }: { tenant: string; companyName: string; canManage: boolean }) {
  const state = useCompanyBranding();
  return <section className={styles.section}><h2>Personalização da loja</h2><p>Logo no sistema e imagem de fundo no comprovante da ordem de serviço.</p>
    {state.phase === "loading" ? <p role="status">Carregando personalização…</p> : state.phase === "error" || !state.branding ? <><p role="alert" className={styles.error}>{state.error || "Não foi possível carregar a personalização."}</p><button type="button" className="button button-secondary" onClick={state.refresh}>Tentar novamente</button></> :
      canManage ? <BrandingForm key={tenant} tenant={tenant} companyName={companyName} branding={state.branding} onSaved={state.acceptSaved} onReload={state.refresh} /> : <><p>A personalização é administrada pelo gestor da empresa.</p><BrandPaper companyName={companyName} logoSrc={state.branding.logo ? brandingAssetUrl(tenant, "logo", state.branding.version) : undefined} backgroundSrc={state.branding.background ? brandingAssetUrl(tenant, "background", state.branding.version) : undefined} backgroundOpacity={state.branding.backgroundOpacity} preview /></>}
  </section>;
}
function BrandingForm({ tenant, companyName, branding, onSaved, onReload }: { tenant: string; companyName: string; branding: Branding; onSaved: (value: Branding) => void; onReload: () => void }) {
  const { handleError } = useWorkspace();
  const [logo, setLogo] = useState<string | null | undefined>(), [background, setBackground] = useState<string | null | undefined>(), [opacity, setOpacity] = useState(branding.backgroundOpacity);
  const [busy, setBusy] = useState(false), [reading, setReading] = useState(0), [error, setError] = useState(""), [success, setSuccess] = useState(false), [conflict, setConflict] = useState(false);
  const alive = useRef(true), pending = useRef(false), attempt = useRef<{ content: string; id: string } | null>(null), uploads = useRef({ logo: 0, background: 0 });
  const logoInput = useRef<HTMLInputElement>(null), backgroundInput = useRef<HTMLInputElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setLogo(undefined); setBackground(undefined); setOpacity(branding.backgroundOpacity); if (logoInput.current) logoInput.current.value = ""; if (backgroundInput.current) backgroundInput.current.value = ""; }, [branding.version, branding.backgroundOpacity]);
  const dirty = logo !== undefined || background !== undefined || opacity !== branding.backgroundOpacity;
  const source = (kind: "logo" | "background", draft: string | null | undefined) => draft === undefined ? branding[kind] ? brandingAssetUrl(tenant, kind, branding.version) : undefined : draft ?? undefined;
  async function choose(kind: "logo" | "background", file?: File) {
    if (!file) return; const tag = ++uploads.current[kind]; setReading((n) => n + 1); setError(""); setSuccess(false);
    try { const data = await fileData(file); await decodedImage(data); if (!alive.current || tag !== uploads.current[kind]) return; (kind === "logo" ? setLogo : setBackground)(data); }
    catch (failure) { if (alive.current && tag === uploads.current[kind]) setError(failure instanceof Error ? failure.message : "Não foi possível ler a imagem."); }
    finally { if (alive.current) setReading((n) => n - 1); }
  }
  return <form className={styles.form} onSubmit={async (event) => {
    event.preventDefault(); if (!dirty || pending.current || reading || conflict) return; pending.current = true; setBusy(true); setError(""); setSuccess(false);
    try {
      const data = { version: branding.version, backgroundOpacity: opacity, ...(logo === undefined ? {} : { logo }), ...(background === undefined ? {} : { background }) }, content = JSON.stringify(data);
      if (attempt.current?.content !== content) attempt.current = { content, id: crypto.randomUUID() };
      const result = await accessRequest<{ tenantId: string; branding: Branding }>(brandingBase(tenant), { method: "PATCH", body: { requestId: attempt.current!.id, ...data } });
      if (!alive.current) return; if (result.tenantId !== tenant) throw new AccessError(503);
      const saved = checkedBranding(result.branding); onSaved(saved);
      // A confirmed no-op can keep the version: it must still finish this edit.
      setLogo(undefined); setBackground(undefined); setOpacity(saved.backgroundOpacity); setConflict(false);
      if (logoInput.current) logoInput.current.value = "";
      if (backgroundInput.current) backgroundInput.current.value = "";
      setSuccess(true);
    } catch (failure) { if (alive.current) { if (failure instanceof AccessError && [401, 403].includes(failure.status)) handleError(failure); else { setConflict(failure instanceof AccessError && failure.status === 409); setError(failure instanceof Error ? failure.message : "Não foi possível salvar a personalização."); } } }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }}>
    {error && <p role="alert" className={styles.error}>{error}</p>}{success && <p role="status" className={styles.success}>Personalização salva.</p>}
    {conflict && <><p>Recarregar descarta os ajustes desta prévia e mostra a versão atual.</p><button type="button" className="button button-secondary" onClick={onReload}>Recarregar personalização</button></>}
    <fieldset className={styles.fields} disabled={busy}>
      <div className={styles.upload}><Field label="Logotipo da loja"><input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void choose("logo", event.target.files?.[0])} /></Field><span className={styles.help}>PNG, JPG ou WebP, até 1 MB.</span><button type="button" className="button button-secondary" disabled={!source("logo", logo)} onClick={() => { uploads.current.logo++; setLogo(null); if (logoInput.current) logoInput.current.value = ""; setSuccess(false); }}>Remover logotipo</button></div>
      <div className={styles.upload}><Field label="Imagem de fundo da OS"><input ref={backgroundInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void choose("background", event.target.files?.[0])} /></Field><span className={styles.help}>PNG, JPG ou WebP, até 1 MB.</span><button type="button" className="button button-secondary" disabled={!source("background", background)} onClick={() => { uploads.current.background++; setBackground(null); if (backgroundInput.current) backgroundInput.current.value = ""; setSuccess(false); }}>Remover fundo</button></div>
      <div><Field label="Intensidade do fundo (%)"><input type="number" min={0} max={20} step={1} required value={opacity} onChange={(event) => { setOpacity(Number(event.target.value)); setSuccess(false); }} /></Field><p className={styles.help}>Use de 0 a 20% para preservar a leitura dos dados.</p></div>
    </fieldset>
    <BrandPaper companyName={companyName} logoSrc={source("logo", logo)} backgroundSrc={source("background", background)} backgroundOpacity={opacity} preview />
    <div className="form-actions"><button type="submit" className="button button-primary" disabled={busy || reading > 0 || !dirty || conflict || !Number.isInteger(opacity) || opacity < 0 || opacity > 20}>{busy ? "Salvando…" : "Salvar personalização"}</button></div>
  </form>;
}

export function BrandPaper({ companyName, logoSrc, backgroundSrc, backgroundOpacity, order, generatedAt, preview = false }: { companyName: string; logoSrc?: string; backgroundSrc?: string; backgroundOpacity: number; order?: ReceiptOrder; generatedAt?: string; preview?: boolean }) {
  const displayDate = (value: string) => { const date = new Date(value.length === 10 ? `${value}T12:00:00Z` : value); return Number.isFinite(+date) ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(date) : "Não informado"; };
  return <section className={`receipt-paper ${styles.paper} ${preview ? styles.preview : ""}`} role="region" aria-label={preview ? "Prévia da ordem de serviço" : "Comprovante da ordem de serviço"}>
    {backgroundSrc && <img className={styles.watermark} style={{ opacity: Math.max(0, Math.min(20, backgroundOpacity)) / 100 }} src={backgroundSrc} alt="" aria-hidden="true" data-testid="order-watermark" />}
    <div className={styles.content}><header className="receipt-heading"><div>{logoSrc && <img className={styles.logo} src={logoSrc} alt="Logotipo da loja" />}<strong>{companyName}</strong><p>Assistência técnica</p></div><div><h2>{order ? `OS #${order.number}` : "Ordem de serviço"}</h2><p>{order ? stages[order.stage as Stage]?.label ?? order.stage : "Prévia do comprovante"}</p></div></header>
      <dl className="receipt-fields"><div><dt>Cliente</dt><dd>{order?.customerName ?? "Dados do atendimento"}</dd></div><div><dt>Contato</dt><dd>{order?.customerPhone || "Informado na OS"}</dd></div><div><dt>Equipamento / modelo</dt><dd>{order?.equipment ?? "Equipamento registrado"}</dd></div><div><dt>Técnico responsável</dt><dd>{order?.technicianName ?? "Responsável registrado"}</dd></div>{order && <><div><dt>Recebido em</dt><dd>{displayDate(order.createdAt)}</dd></div><div><dt>Previsão</dt><dd>{displayDate(order.due)}</dd></div></>}</dl>
      <div className="receipt-section"><h3>Solicitação do cliente</h3><p>{order?.issue ?? "O serviço solicitado será exibido aqui."}</p></div>
      {(order?.diagnosis || preview) && <div className="receipt-section"><h3>Diagnóstico / serviço proposto</h3><p>{order?.diagnosis || "O diagnóstico registrado será exibido aqui."}</p></div>}
      <div className="receipt-section"><h3>{order?.approved ? "Valor do serviço aprovado" : "Valor do serviço / aprovação pendente"}</h3><p>{order ? money(order.laborCents) : "Valor registrado na OS"}</p><p className={styles.help}>Peças e materiais não estão incluídos neste comprovante.</p></div>
      {order && <div className={styles.reference}>Referência da OS: {order.id}</div>}
      <footer className={styles.paperFooter}><p>Comprovante de atendimento. Não é documento fiscal nem comprovante de pagamento.</p>{generatedAt && <p>Comprovante gerado em {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(generatedAt))}. A situação atual permanece disponível no sistema.</p>}<p>A retirada depende da conferência do cliente ou pessoa autorizada e do equipamento.</p></footer>
    </div>
  </section>;
}
