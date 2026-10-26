import { basename } from "node:path";

// Preserve outcomes and Node's exit status while keeping assertion bodies/cookies/URLs out of shared logs.
export default async function* report(events) {
  for await (const { type, data } of events) {
    if (type === "test:pass" || type === "test:fail") {
      const error = data.details?.error;
      const cause = error?.cause ?? error;
      const safeCode = (value) => typeof value === "string" && /^[A-Z_0-9]{1,60}$/.test(value) ? value : undefined;
      const scalar = (value) => typeof value === "boolean" || (Number.isInteger(value) && value >= 0 && value <= 65535) ? value : undefined;
      const location = typeof cause?.stack === "string" ? cause.stack.split("\n").find((line) => /^\s+at /.test(line) && /(?:test|src|scripts)[\\/].*:\d+:\d+/.test(line))?.trim() : undefined;
      yield JSON.stringify({ event: type, name: data.name, file: data.file ? basename(data.file) : undefined,
        durationMs: data.details?.duration_ms, skipped: Boolean(data.skip), code: safeCode(cause?.code),
        failureType: error?.failureType, expected: scalar(cause?.expected), actual: scalar(cause?.actual), location }) + "\n";
    } else if (type === "test:summary") {
      yield JSON.stringify({ event: type, success: data.success, counts: data.counts, durationMs: data.duration_ms }) + "\n";
    }
  }
}
