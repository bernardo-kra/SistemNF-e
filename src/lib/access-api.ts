import { resolveApiOrigin } from "../../shared/api-origin.mjs";

export type AccessRole = "owner" | "operator" | "viewer";
export type AccessCompany = { id: string; name: string; role: AccessRole; permissions: string[] };
export type AccessIdentity = { user: { id: string; name: string; email: string }; tenants: AccessCompany[]; platformAdmin?: boolean };
export type AccessMember = { id: string; name: string; email: string; role: AccessRole; active: boolean; version: number; permissions: string[]; overrides: Record<string, boolean>; createdAt: string | null; updatedAt: string | null };
export type AccessOptions = { roles: { id: AccessRole; label: string; permissions: string[] }[]; permissions: { id: string; label: string }[]; operationalPermissions?: { id: string; label: string }[] };
export type AccessAudit = { id: string; actorId: string; targetId: string; action: string; version: number; fields: string[]; at: string };
export type AccessPage<T> = { tenantId: string; items: T[]; total: number; limit: number; offset: number };

export class AccessError extends Error {
  constructor(readonly status: number, readonly code = "") {
    super(status === 401 ? "Entre novamente para continuar." : status === 403 ? "Você não tem permissão para realizar esta ação." : code === "LAST_OWNER" ? "Mantenha pelo menos um gestor ativo na empresa." : status === 409 ? "O registro foi alterado ou a tentativa conflita com outro cadastro. Recarregue os dados antes de alterar a solicitação." : status === 400 ? "Confira os campos e as permissões informadas." : status === 429 ? "Aguarde um minuto antes de tentar entrar novamente." : "Não foi possível conectar ao serviço. Tente novamente.");
  }
}

function apiOrigin(): string {
  try {
    return resolveApiOrigin(process.env.NEXT_PUBLIC_API_URL, window.location.href);
  } catch { throw new AccessError(503); }
}

export async function accessRequest<T>(path: string, options: { method?: "GET" | "POST" | "PATCH"; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const timeout = AbortSignal.timeout(15_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(`${apiOrigin()}${path}`, { method: options.method ?? "GET", credentials: "include", cache: "no-store", signal,
      ...(options.body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(options.body) }) });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new AccessError(503);
  }
  if (!response.ok) {
    let code = "";
    try { const body = await response.json(); if (body?.error?.code === "LAST_OWNER") code = "LAST_OWNER"; } catch { /* Only controlled public error codes are displayed. */ }
    throw new AccessError(response.status, code);
  }
  try { return await response.json() as T; } catch { throw new AccessError(503); }
}

export const accessBase = (tenant: string) => `/api/v1/tenants/${encodeURIComponent(tenant)}`;
export const accessDate = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium", timeZone: "America/Sao_Paulo" }).format(new Date(value)) : "Não informado";
