import assert from "node:assert/strict";
import { test } from "node:test";

test("origem da API usa o mesmo HTTPS hospedado e preserva desenvolvimento em duas portas", async () => {
  const { resolveApiOrigin } = await import("../shared/api-origin.mjs");
  assert.equal(resolveApiOrigin(undefined, "https://sistem-test.onrender.com/operacao/"), "https://sistem-test.onrender.com");
  assert.equal(resolveApiOrigin(undefined, "http://127.0.0.1:3000/operacao/"), "http://127.0.0.1:4000");
  assert.equal(resolveApiOrigin("https://api.example.test", "https://app.example.test/"), "https://api.example.test");
  for (const value of ["http://externo.test", "https://a.test/path", "https://u:p@a.test", "https://a.test/?x=1"]) {
    assert.throws(() => resolveApiOrigin(value, "https://app.example.test/"));
  }
  assert.throws(() => resolveApiOrigin(undefined, "http://externo.test/"));
});
