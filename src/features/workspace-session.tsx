"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { accessRequest, AccessError, type AccessIdentity } from "@/lib/access-api";

type Session = {
  phase: "loading" | "login" | "ready" | "error";
  identity: AccessIdentity | null; tenant: string; epoch: number; error: string; signingOut: boolean;
  refresh: () => Promise<void>; selectCompany: (id: string) => void; signOut: () => Promise<void>; handleError: (error: unknown) => void;
};
const Context = createContext<Session | null>(null);
export function WorkspaceSession({ children }: { children: ReactNode }) {
  const path = usePathname(), demo = path === "/demo" || path.startsWith("/demo/");
  const [phase, setPhase] = useState<Session["phase"]>("loading"), [identity, setIdentity] = useState<AccessIdentity | null>(null);
  const [tenant, setTenant] = useState(""), [epoch, setEpoch] = useState(0), [error, setError] = useState(""), [signingOut, setSigningOut] = useState(false);
  const generation = useRef(0), selected = useRef(""), currentUser = useRef(""), logoutFlight = useRef(false);
  const inFlight = useRef<Promise<void> | null>(null), controller = useRef<AbortController | null>(null);
  const expire = useCallback(() => {
    generation.current++; controller.current?.abort(); inFlight.current = null;
    selected.current = ""; currentUser.current = ""; setTenant(""); setIdentity(null); setEpoch((n) => n + 1); setError(""); setPhase("login");
  }, []);
  const refresh = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    const tag = ++generation.current, request = new AbortController(); controller.current = request;
    setPhase("loading"); setIdentity(null); setError(""); setEpoch((n) => n + 1);
    const job = (async () => {
      try {
        const data = await accessRequest<AccessIdentity>("/api/v1/me", { signal: request.signal });
        if (tag !== generation.current || request.signal.aborted) return;
        if (!data.user?.id || !Array.isArray(data.tenants)) throw new AccessError(503);
        if (currentUser.current !== data.user.id) selected.current = "";
        currentUser.current = data.user.id;
        const next = data.tenants.some((company) => company.id === selected.current) ? selected.current : data.tenants.length === 1 ? data.tenants[0].id : "";
        selected.current = next; setTenant(next); setIdentity(data); setPhase("ready");
      } catch (failure) {
        if (tag !== generation.current || request.signal.aborted) return;
        selected.current = ""; setTenant(""); setIdentity(null);
        setPhase(failure instanceof AccessError && failure.status === 401 ? "login" : "error");
        setError(failure instanceof AccessError && failure.status === 401 ? "" : failure instanceof Error ? failure.message : "Não foi possível conectar ao serviço.");
      } finally { if (tag === generation.current) inFlight.current = null; }
    })();
    inFlight.current = job; return job;
  }, []);
  useEffect(() => {
    if (demo) { expire(); return; }
    // O agendamento evita dois pedidos de identidade no ensaio de montagem do StrictMode.
    const timer = setTimeout(() => { void refresh(); }, 0);
    return () => { clearTimeout(timer); generation.current++; controller.current?.abort(); inFlight.current = null; };
  }, [demo, expire, refresh]);
  const handleError = useCallback((failure: unknown) => {
    if (failure instanceof AccessError && failure.status === 401) { expire(); return; }
    if (failure instanceof AccessError && failure.status === 403) {
      generation.current++; controller.current?.abort(); inFlight.current = null; setEpoch((n) => n + 1); setIdentity(null); setPhase("error");
    }
    setError(failure instanceof Error ? failure.message : "Não foi possível concluir a operação.");
  }, [expire]);
  const selectCompany = (id: string) => {
    if (id && !identity?.tenants.some((company) => company.id === id)) return;
    selected.current = id; setTenant(id); setEpoch((n) => n + 1); setError("");
  };
  const signOut = useCallback(async () => {
    if (logoutFlight.current) return; logoutFlight.current = true; setSigningOut(true); setError("");
    try { await accessRequest("/api/auth/sign-out", { method: "POST", body: {} }); expire(); }
    catch (failure) { handleError(failure); }
    finally { logoutFlight.current = false; setSigningOut(false); }
  }, [expire, handleError]);
  return <Context.Provider value={{ phase, identity, tenant, epoch, error, signingOut, refresh, selectCompany, signOut, handleError }}>{children}</Context.Provider>;
}
export function useWorkspace() {
  const value = useContext(Context); if (!value) throw new Error("Contexto da empresa ausente."); return value;
}
