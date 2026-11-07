"use client";

import { useEffect, useRef, useState } from "react";
import { Field } from "@/components/ui";
import { accessBase, accessRequest, AccessError } from "@/lib/access-api";
import styles from "./connected-fiscal.module.css";

type Certificate = { version: number; validTo: string; readyForSubmission: false };
type Status = { tenantId: string; storageConfigured: boolean; certificate: Certificate | null };

export function FiscalCertificate({ tenant, profileVersion, hasCnpj, canManage, onAccessError, onReloadProfile }: {
  tenant: string; profileVersion: number; hasCnpj: boolean; canManage: boolean; onAccessError: (error: unknown) => void; onReloadProfile: () => Promise<void>;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState<"certificate" | "profile" | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const intent = useRef<string | null>(null); // No payload/password fingerprint or cache.
  const alive = useRef(true);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const accessError = useRef(onAccessError);
  accessError.current = onAccessError;
  const path = `${accessBase(tenant)}/fiscal/certificate`;

  function clear() {
    generation.current++;
    intent.current = null;
    setFile(null);
    setPassword("");
    if (input.current) input.current.value = "";
  }
  function failure(reason: unknown) {
    if (!alive.current) return;
    if (reason instanceof AccessError && [401, 403].includes(reason.status)) {
      clear();
      accessError.current(reason);
    }
    if (reason instanceof AccessError && reason.status === 409) {
      const profileChanged = reason.code === "A1_PROFILE_CONFLICT";
      if (profileChanged) clear();
      setConflict(profileChanged ? "profile" : "certificate");
      setError(profileChanged ? "A configuração fiscal mudou. Recarregue os dados e selecione o certificado correspondente ao CNPJ confirmado." : "O certificado foi alterado por outra solicitação. Atualize os dados antes de confirmar uma substituição.");
      return;
    }
    setError(reason instanceof AccessError && reason.status === 429
      ? "Há um envio em andamento ou muitas tentativas. Aguarde e tente novamente."
      : reason instanceof AccessError && reason.status === 400
        ? "Confira o arquivo A1 e sua senha. O certificado precisa corresponder ao CNPJ salvo."
        : "Não foi possível acessar o certificado. Tente novamente ou confira a configuração do servidor.");
  }

  useEffect(() => {
    alive.current = true;
    const abort = new AbortController();
    controller.current = abort;
    // Let immediate unmounts (including Strict Mode's lifecycle check) cancel before sending a request.
    const timer = setTimeout(() => {
      void accessRequest<Status>(path, { signal: abort.signal }).then(value => {
        if (!alive.current || abort.signal.aborted) return;
        if (value.tenantId !== tenant || typeof value.storageConfigured !== "boolean") throw new AccessError(503);
        setStatus(value);
      }).catch(reason => { if (!abort.signal.aborted) failure(reason); });
    }, 0);
    return () => {
      clearTimeout(timer);
      alive.current = false;
      generation.current++;
      intent.current = null;
      abort.abort();
      if (input.current) input.current.value = "";
    };
  }, [path, tenant]); // Only public status is loaded; private material never goes into a shared cache.

  async function refreshConflict() {
    if (busy || !conflict) return;
    setBusy(true);
    try {
      if (conflict === "profile") {
        clear();
        await onReloadProfile();
      } else {
        const current = await accessRequest<Status>(path, { signal: controller.current?.signal });
        if (!alive.current) return;
        if (current.tenantId !== tenant || typeof current.storageConfigured !== "boolean") throw new AccessError(503);
        setStatus(current);
        intent.current = null;
      }
      if (alive.current) { setConflict(null); setError(""); }
    } catch (reason) { if (alive.current) failure(reason); }
    finally { if (alive.current) setBusy(false); }
  }

  async function save() {
    if (busy || conflict || !file || !status || !hasCnpj || !canManage) return;
    if (!file.size || file.size > 1048576 || password.length > 1024) {
      setError("Selecione um arquivo A1 de até 1 MiB e confira a senha.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    const tag = generation.current;
    let bytes: Uint8Array | undefined;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
      if (!alive.current || tag !== generation.current) return;
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      const pfxBase64 = btoa(binary);
      bytes.fill(0);
      intent.current ??= crypto.randomUUID();
      const saved = await accessRequest<Status>(path, { method: "PATCH", signal: controller.current?.signal,
        body: { requestId: intent.current, version: status.certificate?.version ?? 0, profileVersion, pfxBase64, passphrase: password } });
      if (!alive.current || tag !== generation.current) return;
      if (saved.tenantId !== tenant || saved.storageConfigured !== true || !saved.certificate) throw new AccessError(503);
      setStatus(saved);
      clear();
      setNotice("Certificado salvo. A emissão oficial continua pendente.");
    } catch (reason) {
      if (alive.current && tag === generation.current) failure(reason);
    } finally {
      bytes?.fill(0);
      if (alive.current) setBusy(false);
    }
  }

  return <section className={styles.certificate} aria-label="Certificado A1">
    <h2>Certificado A1</h2>
    <p className={styles.note}>O CNPJ já salvo na empresa será conferido com o certificado. Cadastrar o A1 não habilita a emissão oficial.</p>
    {error && <p role="alert" className="notice notice-warning">{error}</p>}
    {conflict && <button type="button" className="button button-secondary" disabled={busy} onClick={() => void refreshConflict()}>{conflict === "profile" ? "Recarregar configuração fiscal" : "Atualizar dados do certificado"}</button>}
    {notice && <p role="status" className="notice">{notice}</p>}
    {!status ? <p role="status">Carregando certificado…</p> : <>
      <p className={styles.note}>{status.certificate
        ? `Certificado cadastrado. Validade: ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(status.certificate.validTo))}.`
        : "Nenhum certificado cadastrado."}</p>
      {!status.storageConfigured ? <p className={styles.note}>O administrador precisa habilitar o armazenamento protegido no servidor.</p> : canManage && <>
        {!hasCnpj && <p className={styles.note}>Salve o CNPJ confirmado na configuração fiscal antes de cadastrar o certificado.</p>}
        <form onSubmit={event => { event.preventDefault(); void save(); }}>
          <div className={styles.grid}>
            <Field label="Arquivo do certificado A1"><input ref={input} type="file" accept=".pfx,.p12" disabled={busy || !hasCnpj} onChange={event => { intent.current = null; setFile(event.target.files?.[0] ?? null); setNotice(""); setError(""); }} /></Field>
            <Field label="Senha do certificado"><input type="password" autoComplete="off" maxLength={1024} value={password} disabled={busy || !hasCnpj} onChange={event => { intent.current = null; setPassword(event.target.value); setNotice(""); }} /></Field>
          </div>
          <div className={styles.actions}>
            <button className="button button-primary" disabled={busy || Boolean(conflict) || !hasCnpj || !file}>Salvar certificado</button>
            <button type="button" className="button button-secondary" disabled={busy} onClick={() => { clear(); setError(""); setNotice(""); }}>Limpar arquivo e senha</button>
          </div>
        </form>
      </>}
    </>}
  </section>;
}
