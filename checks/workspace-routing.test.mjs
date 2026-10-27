import assert from "node:assert/strict";
import { test } from "node:test";

test("retorno do login aceita apenas módulos internos e mantém o destino", async () => {
  const { workspaceReturnPath } = await import("../shared/workspace-routes.mjs");
  assert.equal(workspaceReturnPath("/vendas/?novo=1"), "/vendas/?novo=1");
  assert.equal(workspaceReturnPath("/operacao/"), "/produtos/");
  for (const input of [undefined, "https://evil.test", "//evil.test", "/\\evil.test", "/%2f%2fevil.test", "/entrar/?next=/entrar/", "/demo/", "/api/auth/sign-out"]) {
    assert.equal(workspaceReturnPath(input), "/");
  }
});

test("links demonstrativos conservam prefixo, consultas e navegação de saída", async () => {
  const { demoHref } = await import("../shared/workspace-routes.mjs");
  assert.equal(demoHref("/ordens/?os=abc", "/demo/"), "/demo/ordens/?os=abc");
  assert.equal(demoHref("/", "/demo/produtos/"), "/demo/");
  assert.equal(demoHref("/demo/produtos/", "/demo/"), "/demo/produtos/");
  assert.equal(demoHref("/entrar/", "/demo/"), "/entrar/");
  assert.equal(demoHref("/produtos/", "/financeiro/"), "/produtos/");
  assert.equal(demoHref("https://example.test", "/demo/"), "https://example.test");
});
