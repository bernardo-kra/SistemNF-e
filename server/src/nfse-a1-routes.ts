import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ApiConfig } from "./config.js";
import type { Permission } from "./permissions.js";
import { allowedKeys, inputRecord, requireUuid } from "./customers.js";
import { ApiError, invalidInput } from "./errors.js";
import { readA1Certificate, saveA1Certificate } from "./nfse-a1-custody.js";
import { clearA1Keyring, loadA1KeyringFile } from "./nfse-a1-keyfile.js";
import { withDpsTransaction, type DpsJournalAccess } from "./nfse-dps-journal.js";

type Authorize = (request: FastifyRequest, tenantId: unknown, permission: Permission) => Promise<DpsJournalAccess>;
type Upload = { request: FastifyRequest; controller: AbortController; timer: NodeJS.Timeout; processing: boolean };
const busy = () => new ApiError(429, "A1_UPLOAD_LIMIT", "Aguarde antes de enviar o certificado novamente.");

/** Only server configuration selects the keyfile. No route can read/write it or export credentials. */
export function registerA1CertificateRoutes(app: FastifyInstance, config: ApiConfig, authorize: Authorize) {
  const keys = config.a1KeyringFile ? loadA1KeyringFile(config.a1KeyringFile) : undefined;
  let upload: Upload | undefined;
  const attempts = new Map<string, { at: number; count: number }>();
  const release = (request: FastifyRequest) => {
    if (upload?.request !== request) return;
    clearTimeout(upload.timer);
    upload = undefined;
  };
  const cancel = (request: FastifyRequest) => {
    if (upload?.request !== request) return;
    upload.controller.abort();
    if (!upload.processing) release(request);
  };
  const dispose = () => {
    if (upload) {
      upload.controller.abort();
      clearTimeout(upload.timer);
    }
    clearA1Keyring(keys);
    attempts.clear();
  };
  try {
    for (const origin of [config.baseUrl, config.frontendOrigin]) {
      const url = new URL(origin);
      if (url.protocol !== "https:" && !(config.nodeEnv !== "production" && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error("Transporte protegido do A1 inválido.");
    }
    app.addHook("onClose", async () => dispose());
    const path = "/api/v1/tenants/:tenantId/fiscal/certificate";
    app.get<{ Params: { tenantId: string } }>(path, async request => {
      const access = await authorize(request, request.params.tenantId, "fiscal.read");
      allowedKeys(inputRecord(request.query), []);
      return { tenantId: access.tenantId, storageConfigured: Boolean(keys), certificate: await readA1Certificate(access) };
    });
    app.patch<{ Params: { tenantId: string } }>(path, {
      bodyLimit: 1450000,
      onRequest: async (request, reply) => {
        const access = await authorize(request, request.params.tenantId, "fiscal.certificates.manage");
        allowedKeys(inputRecord(request.query), []);
        if (!keys) throw new ApiError(503, "A1_STORAGE_UNAVAILABLE", "O armazenamento protegido do certificado ainda não foi configurado.");
        const now = Date.now();
        for (const [id, value] of attempts) if (now - value.at >= 60000) attempts.delete(id);
        const id = JSON.stringify([access.tenantId, access.actorId]);
        const attempt = attempts.get(id) ?? { at: now, count: 0 };
        if (upload || attempt.count >= 10 || (!attempts.has(id) && attempts.size >= 1000)) throw busy();
        attempt.count++;
        attempts.set(id, attempt);
        const controller = new AbortController();
        const timer = setTimeout(() => { cancel(request); request.raw.destroy(); }, 20000);
        timer.unref();
        upload = { request, controller, timer, processing: false };
        reply.raw.once("close", () => { if (!reply.raw.writableFinished) cancel(request); });
      },
      onRequestAbort: async request => cancel(request),
      onTimeout: async request => cancel(request),
      onError: async request => { if (upload?.request === request && !upload.processing) release(request); },
      onResponse: async request => { if (upload?.request === request && !upload.processing) release(request); },
    }, async request => {
      const task = upload;
      if (!task || task.request !== request || !keys) throw busy();
      task.processing = true;
      let pfx: Buffer | undefined;
      let body: Record<string, unknown> | undefined;
      try {
        body = inputRecord(request.body);
        // Recheck current membership after receiving the body; never rely on a stale upload grant.
        const access = await authorize(request, request.params.tenantId, "fiscal.certificates.manage");
        allowedKeys(body, ["requestId", "version", "profileVersion", "pfxBase64", "passphrase"]);
        const requestId = requireUuid(body.requestId);
        if (!Number.isSafeInteger(body.version) || Number(body.version) < 0 || Number(body.version) > 2147483646
          || !Number.isSafeInteger(body.profileVersion) || Number(body.profileVersion) < 1 || Number(body.profileVersion) > 2147483647
          || typeof body.pfxBase64 !== "string" || !body.pfxBase64 || body.pfxBase64.length > 1398104 || body.pfxBase64.length % 4
          || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.pfxBase64)
          || typeof body.passphrase !== "string" || body.passphrase.length > 1024) throw invalidInput();
        pfx = Buffer.from(body.pfxBase64, "base64");
        if (!pfx.length || pfx.length > 1048576 || pfx.toString("base64") !== body.pfxBase64) throw invalidInput();
        const passphrase = body.passphrase;
        body.pfxBase64 = "";
        body.passphrase = "";
        const profileVersion = body.profileVersion;
        const issuerCnpj = await withDpsTransaction(access, false, async client => {
          const result = await client.query("SELECT body->>'cnpj' AS cnpj FROM fiscal_record_versions WHERE tenant_id=$1 AND kind='profile' AND entity_id=$1 AND version=$2", [access.tenantId, profileVersion]);
          if (typeof result.rows[0]?.cnpj !== "string") throw new ApiError(409, "A1_PROFILE_CONFLICT", "Salve o CNPJ confirmado na configuração fiscal antes do certificado.");
          return result.rows[0].cnpj as string;
        });
        const certificate = await saveA1Certificate(access, keys, { requestId, version: body.version, profileVersion: body.profileVersion, issuerCnpj, credentials: { pfx, passphrase } }, { signal: task.controller.signal });
        return { tenantId: access.tenantId, storageConfigured: true, certificate };
      } finally {
        pfx?.fill(0);
        if (body) {
          body.pfxBase64 = "";
          body.passphrase = "";
        }
        release(request);
      }
    });
    return dispose;
  } catch (error) {
    dispose();
    throw error;
  }
}
