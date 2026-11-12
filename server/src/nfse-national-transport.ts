import { Agent, request, type RequestOptions } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import { createSecureContext } from "node:tls";

type Json = Record<string, unknown>;
export type Credentials = { pfx: Buffer; passphrase: string };
export type Options = { requester?: typeof request; timeoutMs?: number };
const base = "https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional";
const maxResponseBytes = 1024 * 1024;

export class NfseNationalTransportError extends Error {
  constructor(readonly code: string, readonly status?: number, readonly requestMayHaveBeenProcessed = false) {
    super(code); this.name = "NfseNationalTransportError";
  }
}

// Closed homologation transport only. Raw responses are never fiscal authorization.
export class NfseNationalTransport {
  #agent: Agent;
  #requester: typeof request;
  #timeoutMs: number;
  #closed = false;
  #active = new Set<() => void>();
  constructor(credentials: Credentials, options: Options = {}) {
    if (!options || typeof options !== "object" || Object.keys(options).some(k => !["requester", "timeoutMs"].includes(k)) || (options.requester !== undefined && typeof options.requester !== "function")) throw new NfseNationalTransportError("INVALID_CONFIGURATION");
    const timeoutMs = options.timeoutMs ?? 15000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) throw new NfseNationalTransportError("INVALID_CONFIGURATION");
    if (!credentials || !Buffer.isBuffer(credentials.pfx) || !credentials.pfx.length) throw new NfseNationalTransportError("CERTIFICATE_REQUIRED");
    if (credentials.pfx.length > 1024 * 1024 || typeof credentials.passphrase !== "string" || credentials.passphrase.length > 1024) throw new NfseNationalTransportError("INVALID_CERTIFICATE");
    const copy = Buffer.from(credentials.pfx);
    try {
      const secureContext = createSecureContext({ pfx: copy, passphrase: credentials.passphrase, minVersion: "TLSv1.2" });
      this.#agent = new Agent({ secureContext, rejectUnauthorized: true, minVersion: "TLSv1.2", maxCachedSessions: 0, keepAlive: false });
    } catch { throw new NfseNationalTransportError("INVALID_CERTIFICATE"); }
    finally { copy.fill(0); }
    this.#requester = options.requester ?? request; this.#timeoutMs = timeoutMs;
  }
  async exchange(method: "GET" | "POST", path: string, payload?: Buffer): Promise<{ httpStatus: number; payload: Json; authorizationConfirmed: false; contractConfirmed: false }> {
    if (this.#closed) throw new NfseNationalTransportError("OFFICIAL_CLIENT_CLOSED");
    if ((method !== "GET" && method !== "POST") || typeof path !== "string") throw new NfseNationalTransportError("INVALID_OFFICIAL_REQUEST");
    const readPath = /^\/parametros_municipais\/\d{7}\/convenio$/.test(path) || /^\/dps\/DPS\d{7}[12][A-Z0-9]{12}\d{22}$/.test(path) || /^\/nfse\/\d{6}[A-Z0-9]{14}\d{30}$/.test(path);
    if ((method === "GET" && (!readPath || payload !== undefined)) || (method === "POST" && (path !== "/nfse" || !Buffer.isBuffer(payload) || payload.length > 240 * 1024))) throw new NfseNationalTransportError("INVALID_OFFICIAL_REQUEST");
    const url = new URL(base + path);
    return new Promise((resolve, reject) => {
      let req: ClientRequest | undefined, res: IncomingMessage | undefined, settled = false, bytes = 0;
      const chunks: Buffer[] = [];
      const finish = (error?: NfseNationalTransportError, data?: Json) => {
        if (settled) return;
        settled = true; clearTimeout(deadline); this.#active.delete(cancel);
        if (error) {
          reject(new NfseNationalTransportError(error.code, error.status, method === "POST"));
          try { res?.destroy(); req?.destroy(); } catch { /* No native error or fiscal body escapes. */ }
        } else resolve({ httpStatus: res!.statusCode!, payload: data!, authorizationConfirmed: false, contractConfirmed: false });
      };
      const cancel = () => finish(new NfseNationalTransportError("OFFICIAL_CLIENT_CLOSED"));
      const deadline = setTimeout(() => finish(new NfseNationalTransportError("OFFICIAL_REQUEST_TIMEOUT")), this.#timeoutMs);
      this.#active.add(cancel);
      const settings: RequestOptions = { method, agent: this.#agent, rejectUnauthorized: true, minVersion: "TLSv1.2", headers: { Accept: "application/json", "Cache-Control": "no-store" } };
      if (payload) Object.assign(settings.headers!, { "Content-Type": "application/json", "Content-Length": payload.length });
      try {
        req = this.#requester(url, settings, response => {
          res = response;
          res.on("error", () => finish(new NfseNationalTransportError("OFFICIAL_SERVICE_UNAVAILABLE")));
          res.on("aborted", () => finish(new NfseNationalTransportError("INVALID_OFFICIAL_RESPONSE")));
          if (settled) { res.destroy(); return; }
          const status = res.statusCode;
          if (status === undefined || ((status < 200 || status >= 300) && !(method === "POST" && [400, 422].includes(status)))) { finish(new NfseNationalTransportError("OFFICIAL_SERVICE_REJECTED", status)); return; }
          if (typeof res.headers["content-type"] !== "string" || !/^application\/(?:[a-z.+-]+\+)?json(?:\s*;|$)/i.test(res.headers["content-type"])) { finish(new NfseNationalTransportError("INVALID_OFFICIAL_RESPONSE")); return; }
          res.on("data", (chunk: Buffer) => {
            if (settled) return;
            bytes += chunk.length;
            if (bytes > maxResponseBytes) { finish(new NfseNationalTransportError("OFFICIAL_RESPONSE_TOO_LARGE")); return; }
            chunks.push(Buffer.from(chunk));
          });
          res.on("end", () => {
            if (settled) return;
            try {
              if (!res?.complete) throw new Error();
              const data: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
              if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
              finish(undefined, data as Json);
            } catch { finish(new NfseNationalTransportError("INVALID_OFFICIAL_RESPONSE")); }
          });
        });
        req.on("error", () => finish(new NfseNationalTransportError("OFFICIAL_SERVICE_UNAVAILABLE")));
        req.end(payload);
      } catch { finish(new NfseNationalTransportError("OFFICIAL_SERVICE_UNAVAILABLE")); }
    });
  }
  close() {
    if (this.#closed) return;
    this.#closed = true;
    for (const cancel of [...this.#active]) cancel();
    this.#agent.destroy();
  }
}
