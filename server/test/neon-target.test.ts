import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool } from "pg";

test("NEON04 primeiro gestor recusa banco QA e outro endpoint antes de conectar", async () => {
  const { validateNeonOwnerTarget } = await import("../scripts/neon-target.js");
  const host = "ep-example.us-east-2.aws.neon.tech";
  const admin = `postgresql://admin:qa-only@${host}/neondb?sslmode=require`;
  const runtime = `postgresql://runtime:qa-only@${host}/sistem_test_control?sslmode=verify-full`;
  const result = validateNeonOwnerTarget(admin, runtime, host, "sistem_test_control");
  assert.equal(result.pathname, "/sistem_test_control");
  assert.equal(result.searchParams.get("sslmode"), "verify-full");
  assert.throws(() => validateNeonOwnerTarget(admin, runtime.replace("sistem_test_control", "sistem_test_qa_control"), host, "sistem_test_control"));
  assert.throws(() => validateNeonOwnerTarget(admin, runtime.replace(host, "ep-other.us-east-2.aws.neon.tech"), host, "sistem_test_control"));
});

test("NEON05 criação do gestor exige marcador do banco de controle esperado", async () => {
  const { verifyNeonControlMarker } = await import("../scripts/neon-target.js");
  const pool = (scope?: string) => ({ query: async () => ({ rows: scope ? [{ scope }] : [] }) }) as unknown as Pool;
  await verifyNeonControlMarker(pool("sistem_test:control"), "sistem_test");
  await assert.rejects(verifyNeonControlMarker(pool("sistem_test_qa:control"), "sistem_test"));
  await assert.rejects(verifyNeonControlMarker(pool(), "sistem_test"));
});
