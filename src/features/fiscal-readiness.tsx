"use client";
import { useEffect, useRef, useState } from "react";
import { accessBase, accessRequest, AccessError } from "@/lib/access-api";
import type { NfseReadiness } from "../../shared/nfse-readiness";

export function FiscalReadiness({ tenant, onAccessError }: { tenant: string; onAccessError: (error: unknown) => void }) {
  const [data, setData] = useState<NfseReadiness | null>(null), [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  const handleError = useRef(onAccessError); handleError.current = onAccessError;
  useEffect(() => {
    const controller = new AbortController(); setData(null); setFailed(false);
    void accessRequest<NfseReadiness>(`${accessBase(tenant)}/fiscal/readiness`, { signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      if (value.tenantId !== tenant || value.environment !== "production-restricted" || value.readyForSubmission !== false
        || !value.setup || !["profileComplete", "certificateRegistered", "certificateCurrentForIssuer", "storageConfigured"].every(key => typeof value.setup[key as keyof typeof value.setup] === "boolean")) throw new AccessError(503);
      setData(value);
    }).catch(error => {
      if (controller.signal.aborted) return;
      setFailed(true);
      if (error instanceof AccessError && [401,403].includes(error.status)) handleError.current(error);
    });
    return () => controller.abort();
  }, [tenant, retry]);
  return <section aria-label="Prontidão para emissão">
    <h2>Prontidão para emissão</h2><p><strong>Envio oficial ainda indisponível</strong></p>
    <p>Ambiente de testes. Preparar um rascunho não autoriza uma nota fiscal.</p>
    {failed ? <p role="alert">Não foi possível conferir as pendências de emissão.</p> : !data ? <p role="status">Conferindo cadastro e certificado…</p> : <ul>
      <li>{data.setup.profileComplete ? "Cadastro fiscal preenchido; sujeito à validação oficial" : "Cadastro fiscal incompleto"}</li>
      <li>{!data.setup.certificateRegistered ? "Certificado A1 ainda não cadastrado" : data.setup.certificateCurrentForIssuer ? "A1 cadastrado e vigente para este emitente; confiança oficial ainda não verificada" : "Confira o emitente e a validade do certificado A1"}</li>
      {!data.setup.storageConfigured && <li>Armazenamento protegido do A1 ainda não ativado no servidor</li>}
      <li>Conexão e validação oficial em homologação ainda pendentes</li>
    </ul>}
    <button type="button" className="button button-secondary" disabled={!data && !failed} onClick={() => setRetry(value => value + 1)}>Verificar emissão novamente</button>
  </section>;
}
