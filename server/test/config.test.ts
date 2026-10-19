import assert from "node:assert/strict";
import test from "node:test";
import { readConfig } from "../src/config.ts";

const valid = () => ({
  NODE_ENV: "test",
  API_HOST: "127.0.0.1",
  API_PORT: "4000",
  API_BASE_URL: "http://127.0.0.1:4000",
  FRONTEND_ORIGIN: "http://127.0.0.1:3000",
  BETTER_AUTH_SECRET: "qa-only-secret-longer-than-thirty-two-characters",
  CONTROL_DATABASE_URL: "postgresql://qa:private@127.0.0.1:5432/control",
  TENANT_DATABASE_URLS: JSON.stringify({ a: "postgresql://qa_a:private@127.0.0.1:5432/tenant_a" }),
});

test("CFG-01 configuração explícita preserva mapa interno sem inventar credenciais", () => {
  const config = readConfig(valid());
  assert.equal(config.nodeEnv, "test");
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 4000);
  assert.equal(config.baseUrl, "http://127.0.0.1:4000");
  assert.equal(config.frontendOrigin, "http://127.0.0.1:3000");
  assert.equal(config.tenantDatabaseUrls.a, "postgresql://qa_a:private@127.0.0.1:5432/tenant_a");
});

test("CFG-02 segredos obrigatórios e erros não incluem valores secretos", () => {
  for (const key of ["BETTER_AUTH_SECRET", "CONTROL_DATABASE_URL", "TENANT_DATABASE_URLS"] as const) {
    const env = valid();
    delete (env as Partial<typeof env>)[key];
    assert.throws(() => readConfig(env), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /postgresql:\/\/|private|qa-only-secret/);
      return true;
    });
  }
  assert.throws(() => readConfig({ ...valid(), BETTER_AUTH_SECRET: "short" }));
});

test("CFG-03 origens wildcard e produção sem HTTPS são recusadas", () => {
  for (const frontend of ["*", "http://*.example.test", "null", "http://example.test/path"]) {
    assert.throws(() => readConfig({ ...valid(), FRONTEND_ORIGIN: frontend }));
  }
  assert.throws(() => readConfig({ ...valid(), NODE_ENV: "production" }));
  const production = readConfig({ ...valid(), NODE_ENV: "production", API_BASE_URL: "https://api.example.test", FRONTEND_ORIGIN: "https://app.example.test" });
  assert.equal(production.nodeEnv, "production");
});

test("CFG-04 limites e URLs inválidas falham antes de abrir conexões", () => {
  for (const port of ["0", "-1", "65536", "4000oops"]) assert.throws(() => readConfig({ ...valid(), API_PORT: port }));
  for (const map of ["[]", "null", "{}", "broken", JSON.stringify({ a: "file:///private/db" }), JSON.stringify({ "not-a-key": "postgresql://u:p@127.0.0.1/db" }), JSON.stringify(Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`t${i}`, "postgresql://u:p@127.0.0.1/db"])))]) {
    assert.throws(() => readConfig({ ...valid(), TENANT_DATABASE_URLS: map }));
  }
  assert.throws(() => readConfig({ ...valid(), CONTROL_DATABASE_URL: "http://127.0.0.1/private" }));
});
