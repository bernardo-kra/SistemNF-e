import childProcess, { type ChildProcess } from "node:child_process";
import type { inspectA1Offline, signDpsOffline } from "./nfse-dps-signature.js";

type SigningInput = Parameters<typeof signDpsOffline>[0];
type SignedDps = ReturnType<typeof signDpsOffline>;
type IsolatedDps = SignedDps & { executionIsolated: true };
type InspectionInput = Parameters<typeof inspectA1Offline>[0];
type InspectedA1 = ReturnType<typeof inspectA1Offline>;
type Operation = "sign" | "inspect";
type Task = { operation: Operation; input: SigningInput | InspectionInput };
type Options = { timeoutMs?: number; signal?: AbortSignal };
type ErrorCode = "INVALID_SIGNING_TASK" | "SIGNING_BUSY" | "SIGNING_ABORTED"
  | "SIGNING_TIMEOUT" | "SIGNING_PROCESS_FAILED" | "SIGNING_FAILED";

export class DpsSigningTaskError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
    this.name = "DpsSigningTaskError";
  }
}

// One child per supervisor; callers must retry explicitly. No pool or hidden queue.
let signing = false;
const profile = "experimental-rsa-sha256-c14n-v1";

function validateTask(input: SigningInput | InspectionInput, options: Options, operation: Operation) {
  const keys = operation === "sign" ? ["xml", "credentials", "issuerCnpj", "at", "profile"] : ["credentials", "issuerCnpj", "at"];
  const signed = input as SigningInput;
  if (!input || typeof input !== "object"
    || Object.keys(input).some(key => !keys.includes(key))
    || (operation === "sign" && (signed.profile !== profile || typeof signed.xml !== "string" || !signed.xml || Buffer.byteLength(signed.xml) > 160 * 1024))
    || typeof input.issuerCnpj !== "string" || !/^[A-Z0-9]{12}\d{2}$/.test(input.issuerCnpj)
    || !(input.at instanceof Date) || !Number.isFinite(input.at.getTime())
    || !input.credentials || !Buffer.isBuffer(input.credentials.pfx)
    || !input.credentials.pfx.length || input.credentials.pfx.length > 1024 * 1024
    || typeof input.credentials.passphrase !== "string" || input.credentials.passphrase.length > 1024
    || Object.keys(input.credentials).some(key => !["pfx", "passphrase"].includes(key))
    || !options || typeof options !== "object"
    || Object.keys(options).some(key => !["timeoutMs", "signal"].includes(key))
    || (options.signal !== undefined && !(options.signal instanceof AbortSignal))) {
    throw new DpsSigningTaskError("INVALID_SIGNING_TASK");
  }
  const timeoutMs = options.timeoutMs ?? 15000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) {
    throw new DpsSigningTaskError("INVALID_SIGNING_TASK");
  }
  return timeoutMs;
}

function inspectedResult(value: unknown): (InspectedA1 & { executionIsolated: true }) | undefined {
  if (!value || typeof value !== "object") return;
  const result = value as InspectedA1;
  if (typeof result.issuerCnpj !== "string" || !/^[A-Z0-9]{12}\d{2}$/.test(result.issuerCnpj)
    || typeof result.certificateFingerprint256 !== "string" || !/^[a-f0-9]{64}$/.test(result.certificateFingerprint256)
    || typeof result.validFrom !== "string" || !Number.isFinite(Date.parse(result.validFrom))
    || typeof result.validTo !== "string" || !Number.isFinite(Date.parse(result.validTo)) || result.validTo <= result.validFrom
    || !Number.isSafeInteger(result.keyBits) || result.keyBits < 2048 || result.keyBits > 8192
    || result.readyForSubmission !== false || result.officialProfileConfirmed !== false
    || result.trustChainVerified !== false || result.revocationChecked !== false) return;
  return {
    issuerCnpj: result.issuerCnpj, certificateFingerprint256: result.certificateFingerprint256,
    validFrom: result.validFrom, validTo: result.validTo, keyBits: result.keyBits,
    readyForSubmission: false, officialProfileConfirmed: false, trustChainVerified: false, revocationChecked: false,
    executionIsolated: true,
  };
}

// The child is internal code, but a partial/invalid IPC message must never count as success.
function signedResult(value: unknown): IsolatedDps | undefined {
  if (!value || typeof value !== "object") return;
  const result = value as SignedDps;
  if (result.state !== "signed_offline" || result.profile !== profile
    || result.environment !== "production-restricted"
    || result.structurallyValid !== true || result.cryptographicSignatureValid !== true
    || result.readyForSubmission !== false || result.officialProfileConfirmed !== false
    || result.trustChainVerified !== false || result.revocationChecked !== false
    || typeof result.id !== "string" || !/^DPS[A-Z0-9]{42}$/.test(result.id)
    || typeof result.xml !== "string" || Buffer.byteLength(result.xml) > 160 * 1024
    || typeof result.verifiedInfDpsXml !== "string" || Buffer.byteLength(result.verifiedInfDpsXml) > 160 * 1024
    || typeof result.certificateFingerprint256 !== "string" || !/^[a-f0-9]{64}$/.test(result.certificateFingerprint256)
    || !Array.isArray(result.pendingChecks) || result.pendingChecks.length > 20
    || result.pendingChecks.some(code => typeof code !== "string" || !/^[A-Z_]{1,80}$/.test(code))) return;
  return {
    id: result.id,
    state: result.state,
    profile: result.profile,
    environment: result.environment,
    structurallyValid: true,
    cryptographicSignatureValid: true,
    officialProfileConfirmed: false,
    trustChainVerified: false,
    revocationChecked: false,
    readyForSubmission: false,
    xml: result.xml,
    verifiedInfDpsXml: result.verifiedInfDpsXml,
    certificateFingerprint256: result.certificateFingerprint256,
    pendingChecks: [...result.pendingChecks],
    executionIsolated: true,
  };
}

/** Internal offline execution only, with a deadline enforced by the living parent.
 * Not a filesystem/network sandbox or certificate custody. No HTTP/upload integration.
 * The synchronous primitive remains available for controlled offline cryptographic tests.
 */
export function signDpsIsolated(input: SigningInput, options: Options = {}): Promise<IsolatedDps> {
  return runIsolated(input, options, "sign", signedResult);
}

export function inspectA1Isolated(input: InspectionInput, options: Options = {}) {
  return runIsolated(input, options, "inspect", inspectedResult);
}

// Shared lifecycle for two closed operations; no caller-selected executable or handler.
async function runIsolated<T>(input: SigningInput | InspectionInput, options: Options, operation: Operation, project: (value: unknown) => T | undefined): Promise<T> {
  const timeoutMs = validateTask(input, options, operation);
  if (options.signal?.aborted) throw new DpsSigningTaskError("SIGNING_ABORTED");
  if (signing) throw new DpsSigningTaskError("SIGNING_BUSY");
  signing = true;
  let pfx: Buffer | undefined;
  try {
    pfx = Buffer.from(input.credentials.pfx);
    const snapshot = { ...input, at: new Date(input.at), credentials: { pfx, passphrase: input.credentials.passphrase } };
    return await execute({ operation, input: snapshot }, timeoutMs, project, options.signal);
  } finally {
    pfx?.fill(0); // Best effort; IPC, forge and JS strings can have additional copies.
    signing = false;
  }
}

function execute<T>(task: Task, timeoutMs: number, project: (value: unknown) => T | undefined, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const deadline = performance.now() + timeoutMs;
    let child: ChildProcess;
    try {
      const source = import.meta.url.endsWith(".ts");
      child = childProcess.fork(new URL(`./nfse-dps-signing-child.${source ? "ts" : "js"}`, import.meta.url), [], {
        execPath: process.execPath,
        execArgv: ["--max-old-space-size=128", ...(source ? ["--import", import.meta.resolve("tsx")] : [])],
        cwd: import.meta.dirname,
        env: process.platform === "win32" && process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {},
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        windowsHide: true,
        serialization: "advanced",
      });
    } catch {
      reject(new DpsSigningTaskError("SIGNING_PROCESS_FAILED"));
      return;
    }

    let result: T | undefined;
    let failure: ErrorCode | undefined;
    let received = false;
    function stop(code: ErrorCode) {
      failure ??= code;
      child.kill("SIGKILL");
    }
    const timer = setTimeout(() => stop("SIGNING_TIMEOUT"), Math.max(0, deadline - performance.now()));
    const abort = () => stop("SIGNING_ABORTED");
    signal?.addEventListener("abort", abort, { once: true });
    child.on("error", () => stop("SIGNING_PROCESS_FAILED"));
    child.on("message", (message: unknown) => {
      if (failure) return;
      if (received || !message || typeof message !== "object") return stop("SIGNING_PROCESS_FAILED");
      received = true;
      const reply = message as { ok?: unknown; result?: unknown };
      if (reply.ok === false && Object.keys(reply).length === 1) return stop("SIGNING_FAILED");
      if (reply.ok !== true || Object.keys(reply).length !== 2 || !(result = project(reply.result))) {
        stop("SIGNING_PROCESS_FAILED");
      }
    });
    child.on("disconnect", () => {
      if (!received && !failure) stop("SIGNING_PROCESS_FAILED");
    });
    child.once("close", code => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (!failure && code === 0 && result) resolve(result);
      else reject(new DpsSigningTaskError(failure ?? "SIGNING_PROCESS_FAILED"));
    });
    if (signal?.aborted) return abort();
    try {
      child.send(task, error => { if (error) stop("SIGNING_PROCESS_FAILED"); });
    } catch {
      stop("SIGNING_PROCESS_FAILED");
    }
  });
}
