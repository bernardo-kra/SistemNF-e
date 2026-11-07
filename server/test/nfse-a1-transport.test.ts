import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import test, { mock } from "node:test";
import Fastify from "fastify";
import { registerA1CertificateRoutes } from "../src/nfse-a1-routes.ts";

test("CERTT01 non-object bodies release the transport slot before the next validation", async () => {
  // Transport-only regression; authorization/DB/crypto are exercised by nfse-a1-http.test.ts.
  const root = resolve(import.meta.dirname, "../.local/tests");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, "a1-transport-"));
  const path = join(directory, "generic.json");
  await writeFile(path, JSON.stringify({ activeKeyId: "generic", keys: { generic: randomBytes(32).toString("base64") } }), { mode: 0o600 });
  const app = Fastify();
  try {
    const unused = { query() { throw Error("Transport rejection must not reach DB"); } } as never;
    registerA1CertificateRoutes(app, { nodeEnv: "test", baseUrl: "http://127.0.0.1:4000", frontendOrigin: "http://127.0.0.1:3000", a1KeyringFile: path, host: "127.0.0.1", port: 4000, authSecret: "unused", controlDatabaseUrl: "unused", tenantDatabaseUrls: {} }, async () => ({ pool: unused, tenantId: "10000000-0000-4000-8000-000000000001", actorId: "generic" }));
    const request = { method: "PATCH" as const, url: "/api/v1/tenants/10000000-0000-4000-8000-000000000001/fiscal/certificate" };
    assert.equal((await app.inject({ ...request, payload: [] })).statusCode, 400);
    assert.equal((await app.inject({ ...request, payload: {} })).statusCode, 400);
  } finally {
    await app.close();
    const target = resolve(directory);
    if (!target.startsWith(root + sep + "a1-transport-")) throw Error("Invalid generic transport cleanup");
    await rm(target, { recursive: true, force: true });
  }
});

test("CERTT02 key buffers are cleared on registration failure and normal app close", async () => {
  const root = resolve(import.meta.dirname, "../.local/tests");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, "a1-transport-"));
  const path = join(directory, "generic.json"), master = randomBytes(32);
  await writeFile(path, JSON.stringify({ activeKeyId: "generic", keys: { generic: master.toString("base64") } }), { mode: 0o600 });
  const app = Fastify();
  let erased = 0;
  const fill = Buffer.prototype.fill;
  mock.method(Buffer.prototype, "fill", function (this: Buffer, ...args: Parameters<typeof fill>) {
    if (args[0] === 0 && this.length === master.length && this.equals(master)) erased++;
    return Reflect.apply(fill, this, args);
  });
  try {
    const config = { nodeEnv: "test" as const, baseUrl: "http://127.0.0.1:4000", frontendOrigin: "http://127.0.0.1:3000", a1KeyringFile: path, host: "127.0.0.1", port: 4000, authSecret: "unused", controlDatabaseUrl: "unused", tenantDatabaseUrls: {} };
    const unused = async () => { throw Error("Unused authorization in lifecycle test"); };
    assert.throws(() => registerA1CertificateRoutes(app, { ...config, nodeEnv: "production" }, unused));
    assert.equal(erased, 1);
    registerA1CertificateRoutes(app, config, unused);
    await app.close();
    assert.equal(erased, 2);
  } finally {
    mock.restoreAll();
    master.fill(0);
    await app.close();
    const target = resolve(directory);
    if (!target.startsWith(root + sep + "a1-transport-")) throw Error("Invalid generic transport cleanup");
    await rm(target, { recursive: true, force: true });
  }
});
