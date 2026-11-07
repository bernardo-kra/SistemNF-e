import { inspectA1Offline, signDpsOffline } from "./nfse-dps-signature.js";

type Task = { operation: "sign" | "inspect"; input: Parameters<typeof signDpsOffline>[0] | Parameters<typeof inspectA1Offline>[0] };

// Fixed entrypoint, one message per child. Credentials are never read from disk/env/argv.
if (!process.send) process.exit(1);
process.once("disconnect", () => process.exit(1));
process.once("message", (task: Task) => {
  let reply: { ok: true; result: ReturnType<typeof signDpsOffline> | ReturnType<typeof inspectA1Offline> } | { ok: false };
  try {
    if (!task || typeof task !== "object" || Object.keys(task).length !== 2 || !("input" in task)) throw Error();
    if (task.operation === "sign") reply = { ok: true, result: signDpsOffline(task.input as Parameters<typeof signDpsOffline>[0]) };
    else if (task.operation === "inspect") reply = { ok: true, result: inspectA1Offline(task.input) };
    else throw Error();
  } catch {
    // No error object, library message or caller-controlled code crosses IPC.
    // Domain diagnostics can be added later through an explicitly reviewed closed catalog.
    reply = { ok: false };
  } finally {
    if (Buffer.isBuffer(task?.input?.credentials?.pfx)) task.input.credentials.pfx.fill(0);
  }
  process.send!(reply, error => process.exit(error ? 1 : 0));
});
