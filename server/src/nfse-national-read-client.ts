import { Agent, request, type RequestOptions } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import { createSecureContext } from "node:tls";

type Json = Record<string, unknown>;
type Credentials = { pfx: Buffer; passphrase: string };
type Options = { requester?: typeof request; timeoutMs?: number };
const base = "https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional";
const maxResponseBytes = 1024 * 1024;

export class NfseNationalReadError extends Error {
  constructor(readonly code: string, readonly status?: number) {
    super(code); this.name = "NfseNationalReadError";
  }
}

// Internal read-only preparation. This does not sign DPS, issue invoices or validate ICP-Brasil,
// certificate ownership, validity dates, municipal membership or a taxpayer's authorization.
export class NfseNationalReadClient {
  #agent: Agent;
  #requester: typeof request;
  #timeoutMs: number;
  #closed = false;
  #active = new Set<() => void>();
  constructor(credentials: Credentials, options: Options = {}) {
    if (!options || typeof options !== "object" || Object.keys(options).some(k => !["requester", "timeoutMs"].includes(k)) || (options.requester !== undefined && typeof options.requester !== "function")) throw new NfseNationalReadError("INVALID_CONFIGURATION");
    const timeoutMs = options.timeoutMs ?? 15000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) throw new NfseNationalReadError("INVALID_CONFIGURATION");
    if (!credentials || !Buffer.isBuffer(credentials.pfx) || !credentials.pfx.length) throw new NfseNationalReadError("CERTIFICATE_REQUIRED");
    if (credentials.pfx.length > 1024 * 1024 || typeof credentials.passphrase !== "string" || credentials.passphrase.length > 1024) throw new NfseNationalReadError("INVALID_CERTIFICATE");
    const copy = Buffer.from(credentials.pfx);
    try {
      const secureContext = createSecureContext({ pfx: copy, passphrase: credentials.passphrase, minVersion: "TLSv1.2" });
      this.#agent = new Agent({ secureContext, rejectUnauthorized: true, minVersion: "TLSv1.2", maxCachedSessions: 0, keepAlive: false });
    } catch { throw new NfseNationalReadError("INVALID_CERTIFICATE"); }
    finally { copy.fill(0); }
    this.#requester = options.requester ?? request; this.#timeoutMs = timeoutMs;
  }
  async getMunicipalAgreement(code: string): Promise<Json> {
    if (this.#closed) throw new NfseNationalReadError("OFFICIAL_CLIENT_CLOSED");
    if (typeof code !== "string" || !/^\d{7}$/.test(code)) throw new NfseNationalReadError("INVALID_MUNICIPALITY");
    const url = new URL(`${base}/parametros_municipais/${code}/convenio`);
    return new Promise((resolve, reject) => {
      let req: ClientRequest | undefined, res: IncomingMessage | undefined, settled = false, bytes = 0;
      const chunks: Buffer[] = [];
      const finish = (error?: NfseNationalReadError, data?: Json) => {
        if (settled) return;
        settled = true; clearTimeout(deadline); this.#active.delete(cancel);
        if (error) {
          reject(error);
          try { res?.destroy(); req?.destroy(); } catch { /* No native error or fiscal body escapes. */ }
        } else resolve(data!);
      };
      const cancel = () => finish(new NfseNationalReadError("OFFICIAL_CLIENT_CLOSED"));
      const deadline = setTimeout(() => finish(new NfseNationalReadError("OFFICIAL_REQUEST_TIMEOUT")), this.#timeoutMs);
      this.#active.add(cancel);
      const settings: RequestOptions = { method: "GET", agent: this.#agent, rejectUnauthorized: true, minVersion: "TLSv1.2", headers: { Accept: "application/json", "Cache-Control": "no-store" } };
      try {
        req = this.#requester(url, settings, response => {
          res = response;
          res.on("error", () => finish(new NfseNationalReadError("OFFICIAL_SERVICE_UNAVAILABLE")));
          res.on("aborted", () => finish(new NfseNationalReadError("INVALID_OFFICIAL_RESPONSE")));
          if (settled) { res.destroy(); return; }
          const status = res.statusCode;
          if (status === undefined || status < 200 || status >= 300) { finish(new NfseNationalReadError("OFFICIAL_SERVICE_REJECTED", status)); return; }
          if (typeof res.headers["content-type"] !== "string" || !/^application\/(?:[a-z.+-]+\+)?json(?:\s*;|$)/i.test(res.headers["content-type"])) { finish(new NfseNationalReadError("INVALID_OFFICIAL_RESPONSE")); return; }
          res.on("data", (chunk: Buffer) => {
            if (settled) return;
            bytes += chunk.length;
            if (bytes > maxResponseBytes) { finish(new NfseNationalReadError("OFFICIAL_RESPONSE_TOO_LARGE")); return; }
            chunks.push(Buffer.from(chunk));
          });
          res.on("end", () => {
            if (settled) return;
            try {
              if (!res?.complete) throw new Error();
              const data: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
              if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
              finish(undefined, data as Json);
            } catch { finish(new NfseNationalReadError("INVALID_OFFICIAL_RESPONSE")); }
          });
        });
        req.on("error", () => finish(new NfseNationalReadError("OFFICIAL_SERVICE_UNAVAILABLE")));
        req.end();
      } catch { finish(new NfseNationalReadError("OFFICIAL_SERVICE_UNAVAILABLE")); }
    });
  }
  close() {
    if (this.#closed) return;
    this.#closed = true;
    for (const cancel of [...this.#active]) cancel();
    this.#agent.destroy();
  }
}
