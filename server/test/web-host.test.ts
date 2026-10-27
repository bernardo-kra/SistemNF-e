import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";

// Contrato definido antes da implementação: export estático e API na mesma origem.
test("HOST01 serve HTML, assets e navegação direta sem substituir rotas da API", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sistem-host-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "operacao"));
  await mkdir(join(root, "_next", "static"), { recursive: true });
  await writeFile(join(root, "index.html"), "<!doctype html><title>Sistem</title>");
  await writeFile(join(root, "operacao", "index.html"), "<!doctype html><title>Operação</title>");
  await writeFile(join(root, "_next", "static", "app.js"), "window.sistem=true;");
  await writeFile(join(root, ".env"), "PRIVATE_MARKER");
  const { registerFrontend } = await import("../src/web-host.js");
  const app = Fastify({ logger: false });
  t.after(() => app.close());
  app.get("/api/v1/me", async (_, reply) => reply.code(401).send({ error: "UNAUTHENTICATED" }));
  await registerFrontend(app, root);
  await app.ready();
  for (const path of ["/", "/operacao/", "/operacao/?q=teste"]) {
    const response = await app.inject(path);
    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"]!, /text\/html/);
    assert.match(response.headers["cache-control"]!, /no-cache|no-store/);
  }
  assert.equal((await app.inject("/operacao")).statusCode, 301);
  const asset = await app.inject("/_next/static/app.js");
  assert.equal(asset.statusCode, 200);
  assert.match(asset.headers["content-type"]!, /javascript/);
  assert.equal((await app.inject("/api/v1/me")).statusCode, 401);
  for (const path of ["/.env", "/%2eenv", "/server/.env", "/nao-existe/", "/_next/static/ausente.js"]) {
    const response = await app.inject(path);
    assert.ok(response.statusCode >= 400);
    assert.ok(!response.body.includes("PRIVATE_MARKER"));
  }
});

test("HOST02 não aceita iniciar sem um export contendo index.html", async () => {
  const { registerFrontend } = await import("../src/web-host.js");
  const app = Fastify({ logger: false });
  try { await assert.rejects(registerFrontend(app, join(tmpdir(), "sistem-build-ausente"))); }
  finally { await app.close(); }
});

test("HOST03 start local escuta apenas loopback; Render usa PORT e origem pública", async () => {
  const { webEnvironment } = await import("../src/web-host.js");
  assert.deepEqual(webEnvironment({}), { host: "127.0.0.1", port: 4000, publicUrl: "http://127.0.0.1:4000", nodeEnv: "development" });
  assert.deepEqual(webEnvironment({ PORT: "10000", RENDER_EXTERNAL_URL: "https://sistem-test.onrender.com" }), {
    host: "0.0.0.0", port: 10000, publicUrl: "https://sistem-test.onrender.com", nodeEnv: "production",
  });
  assert.throws(() => webEnvironment({ PORT: "invalid" }));
});
