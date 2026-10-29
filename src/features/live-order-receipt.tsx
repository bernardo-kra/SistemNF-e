"use client";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { accessBase, accessRequest, AccessError } from "@/lib/access-api";
import { checkedBranding, downloadBrandAsset, type OrderDocument } from "@/lib/branding-api";
import { useWorkspace } from "./workspace-session";
import { BrandPaper } from "./company-branding";
import styles from "./company-branding.module.css";

export function LiveOrderReceipt({ tenant, orderId, onClose }: { tenant: string; orderId: string; onClose: () => void }) {
  const { handleError } = useWorkspace(), dialog = useRef<HTMLDialogElement>(null), title = useId();
  const [document, setDocument] = useState<OrderDocument | null>(null), [images, setImages] = useState<{ logo?: string; background?: string }>({}), [phase, setPhase] = useState<"loading" | "ready" | "error">("loading"), [error, setError] = useState(""), [revision, setRevision] = useState(0);
  useEffect(() => {
    const previous = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null;
    dialog.current?.showModal(); return () => { if (dialog.current?.open) dialog.current.close(); if (previous?.isConnected) queueMicrotask(() => previous.focus()); };
  }, []);
  useEffect(() => {
    const controller = new AbortController(), urls: string[] = []; setPhase("loading"); setError(""); setDocument(null); setImages({});
    void (async () => {
      let assetPhase = false;
      try {
        const result = await accessRequest<OrderDocument>(`${accessBase(tenant)}/orders/${encodeURIComponent(orderId)}/receipt`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (result.tenantId !== tenant || result.order?.id !== orderId || typeof result.companyName !== "string") throw new AccessError(503);
        const branding = checkedBranding(result.branding); setDocument(result); assetPhase = true;
        const loaded: { logo?: string; background?: string } = {};
        await Promise.all((["logo", "background"] as const).map(async (kind) => {
          if (!branding[kind]) return;
          const url = await downloadBrandAsset(tenant, kind, branding.version, controller.signal); urls.push(url);
          if (controller.signal.aborted) { URL.revokeObjectURL(url); return; } loaded[kind] = url;
        }));
        if (!controller.signal.aborted) { setImages(loaded); setPhase("ready"); }
      } catch (failure) {
        if (controller.signal.aborted) return;
        urls.forEach((url) => URL.revokeObjectURL(url)); setPhase("error"); setError(assetPhase ? "Não foi possível carregar as imagens do comprovante." : "Não foi possível carregar o comprovante.");
        if (failure instanceof AccessError && [401, 403].includes(failure.status)) handleError(failure);
      }
    })();
    return () => { controller.abort(); urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [tenant, orderId, revision, handleError]);
  return createPortal(<div className="receipt-layer"><dialog ref={dialog} className="receipt-dialog" aria-labelledby={title} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="receipt-toolbar"><h2 id={title}>Comprovante da OS</h2><button type="button" className="button button-primary" disabled={phase !== "ready"} onClick={() => { try { window.print(); } catch { setError("Não foi possível abrir a impressão."); } }}>Imprimir comprovante</button><button type="button" className="button button-secondary" onClick={onClose}>Fechar comprovante</button></div>
    {phase === "loading" && <p className={styles.documentStatus} role="status">Carregando comprovante e imagens…</p>}{error && <div className={styles.documentStatus}><p role="alert">{error}</p><button type="button" className="button button-secondary" onClick={() => setRevision((n) => n + 1)}>Tentar novamente</button></div>}
    {phase === "ready" && document && <BrandPaper companyName={document.companyName} logoSrc={images.logo} backgroundSrc={images.background} backgroundOpacity={document.branding.backgroundOpacity} order={document.order} generatedAt={document.generatedAt} />}
  </dialog></div>, window.document.body);
}
