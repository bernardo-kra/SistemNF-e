import assert from "node:assert/strict";
import childProcess, { type ChildProcess, type ForkOptions } from "node:child_process";
import { once } from "node:events";
import { afterEach, mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import { unsignedDpsXml } from "./nfse-dps-fixture.ts";

// Acceptance scenarios fixed before the isolated executor. No database or real PFX.
const load = () => import("../src/nfse-dps-isolation.ts");
const nativeFork = childProcess.fork;
const children = new Set<ChildProcess>();
let lastChild: ChildProcess;
let requested: ForkOptions;
let requestedArguments: readonly string[];

function input() {
  return {
    xml: unsignedDpsXml,
    issuerCnpj: "11222333000181",
    profile: "experimental-rsa-sha256-c14n-v1",
    at: new Date("2026-11-04T12:00:00Z"),
    credentials: { pfx: Buffer.from("generic-invalid-pfx"), passphrase: "generic-private-password" },
  };
}

function fixture(mode: string) {
  mock.method(childProcess, "fork", (_entry: unknown, args: string[], options: ForkOptions) => {
    requested = options;
    requestedArguments = args;
    lastChild = nativeFork(fileURLToPath(new URL("./fixtures/nfse-signing-process.mjs", import.meta.url)), [mode], {
      ...options,
      execArgv: [],
      stdio: ["ignore", "ignore", "ignore", "ipc", "pipe"],
    });
    children.add(lastChild);
    lastChild.once("close", () => children.delete(lastChild));
    return lastChild;
  });
}

function safeError(code: string) {
  return (error: any) => {
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    assert.equal(error.cause, undefined);
    assert.doesNotMatch(JSON.stringify(error), /generic-private-password|GENERIC_PRIVATE_PASSWORD|<DPS|11222333/);
    return true;
  };
}

afterEach(async () => {
  mock.restoreAll();
  for (const child of children) {
    const closed = once(child, "close");
    child.kill("SIGKILL");
    await closed;
  }
});

test("NFSI01 invalid size/options and pre-aborted signal fail before spawning", async () => {
  const { signDpsIsolated } = await load();
  const spy = mock.method(childProcess, "fork", () => { throw Error("must not spawn"); });
  const aborted = AbortSignal.abort();
  await assert.rejects(signDpsIsolated(input(), { signal: aborted }), safeError("SIGNING_ABORTED"));
  for (const timeoutMs of [0, -1, 1.5, 60001, NaN]) {
    await assert.rejects(signDpsIsolated(input(), { timeoutMs }), safeError("INVALID_SIGNING_TASK"));
  }
  for (const data of [
    { ...input(), xml: "x".repeat(160 * 1024 + 1) },
    { ...input(), credentials: { ...input().credentials, pfx: Buffer.alloc(1024 * 1024 + 1) } },
    { ...input(), credentials: { ...input().credentials, passphrase: "x".repeat(1025) } },
    { ...input(), profile: "official" },
    { ...input(), at: new Date(NaN) },
  ]) await assert.rejects(signDpsIsolated(data), safeError("INVALID_SIGNING_TASK"));
  assert.equal(spy.mock.callCount(), 0);
});

test("NFSI02 CPU-bound child is killed at deadline, parent stays responsive, no queue/retry", async () => {
  const { signDpsIsolated } = await load();
  fixture("busy");
  let beats = 0, closed = false;
  const heartbeat = setInterval(() => beats++, 25);
  try {
    const started = performance.now();
    const task = signDpsIsolated(input(), { timeoutMs: 1800 });
    const rejection = assert.rejects(task, safeError("SIGNING_TIMEOUT"));
    lastChild.once("close", () => { closed = true; });
    await once(lastChild.stdio[4]!, "data");
    await assert.rejects(signDpsIsolated(input()), safeError("SIGNING_BUSY"));
    await rejection;
    assert.equal(closed, true, "promise must settle only after close");
    assert.ok(beats >= 4, "parent event loop must keep running during CPU work");
    assert.ok(performance.now() - started < 5000);
    assert.throws(() => process.kill(lastChild.pid!, 0));
  } finally { clearInterval(heartbeat); }
});

test("NFSI03 cancellation during CPU work waits for child termination and releases capacity", async () => {
  const { signDpsIsolated } = await load();
  fixture("busy");
  const controller = new AbortController();
  const task = signDpsIsolated(input(), { timeoutMs: 5000, signal: controller.signal });
  const rejection = assert.rejects(task, safeError("SIGNING_ABORTED"));
  await once(lastChild.stdio[4]!, "data");
  controller.abort("generic-private-password");
  await rejection;
  assert.throws(() => process.kill(lastChild.pid!, 0));
  mock.restoreAll();
  fixture("failure");
  await assert.rejects(signDpsIsolated(input()), safeError("SIGNING_FAILED"));
});

test("NFSI04 IPC malformation, private errors, crash and disconnected hang are controlled", async () => {
  const { signDpsIsolated } = await load();
  for (const mode of ["malformed", "private-error", "crash", "disconnect"]) {
    mock.restoreAll();
    fixture(mode);
    await assert.rejects(signDpsIsolated(input(), { timeoutMs: 1200 }), safeError("SIGNING_PROCESS_FAILED"));
    assert.throws(() => process.kill(lastChild.pid!, 0));
  }
});

test("NFSI05 fork has fixed entrypoint, minimal environment, ignored output and no credentials in arguments", async () => {
  const { signDpsIsolated } = await load();
  fixture("failure");
  const before = Buffer.from(input().credentials.pfx);
  const data = input();
  await assert.rejects(signDpsIsolated(data), safeError("SIGNING_FAILED"));
  assert.deepEqual(data.credentials.pfx, before);
  assert.deepEqual(requested.stdio, ["ignore", "ignore", "ignore", "ipc"]);
  assert.deepEqual(requestedArguments, []);
  assert.equal(requested.serialization, "advanced");
  assert.equal(requested.windowsHide, true);
  assert.ok(Object.keys(requested.env!).every(key => key === "SystemRoot"));
  assert.doesNotMatch(JSON.stringify({ args: requestedArguments, options: requested }), /generic-private-password|DATABASE_URL|--env-file|--inspect|NODE_OPTIONS/);
});

test("NFSI06 spawn failure is sanitized and does not keep the signing slot occupied", async () => {
  const { signDpsIsolated } = await load();
  mock.method(childProcess, "fork", () => { throw Error("generic-private-password"); });
  await assert.rejects(signDpsIsolated(input()), safeError("SIGNING_PROCESS_FAILED"));
  mock.restoreAll();
  fixture("failure");
  await assert.rejects(signDpsIsolated(input()), safeError("SIGNING_FAILED"));
});

test("NFSI09 success requires clean exit, duplicate messages and IPC send errors cannot release a live child", async () => {
  const { signDpsIsolated } = await load();
  for (const [mode, code] of [["success-hang", "SIGNING_TIMEOUT"], ["success-crash", "SIGNING_PROCESS_FAILED"], ["duplicate", "SIGNING_PROCESS_FAILED"]]) {
    mock.restoreAll();
    fixture(mode);
    await assert.rejects(signDpsIsolated(input(), { timeoutMs: 1200 }), safeError(code));
    assert.throws(() => process.kill(lastChild.pid!, 0));
  }
  mock.restoreAll();
  const spy = mock.method(childProcess, "fork", (_entry: unknown, _args: string[], options: ForkOptions) => {
    lastChild = nativeFork(fileURLToPath(new URL("./fixtures/nfse-signing-process.mjs", import.meta.url)), ["failure"], { ...options, execArgv: [] });
    children.add(lastChild);
    lastChild.once("close", () => children.delete(lastChild));
    lastChild.send = (() => { throw Error("generic-private-password"); }) as any;
    return lastChild;
  });
  await assert.rejects(signDpsIsolated(input()), safeError("SIGNING_PROCESS_FAILED"));
  assert.equal(spy.mock.callCount(), 1);
  assert.throws(() => process.kill(lastChild.pid!, 0));
});

test("A1I04 inspection and signing share the bounded slot and closed input contract", async () => {
  const { signDpsIsolated, inspectA1Isolated } = await load();
  fixture("busy");
  const task = signDpsIsolated(input(), { timeoutMs: 1200 });
  const rejected = assert.rejects(task, safeError("SIGNING_TIMEOUT"));
  try {
    await once(lastChild.stdio[4]!, "data");
    const { credentials, issuerCnpj, at } = input();
    await assert.rejects(inspectA1Isolated({ credentials, issuerCnpj, at }), safeError("SIGNING_BUSY"));
    await assert.rejects(inspectA1Isolated({ credentials, issuerCnpj, at, operation: "decrypt" } as any), safeError("INVALID_SIGNING_TASK"));
  } finally { await rejected; }
});
