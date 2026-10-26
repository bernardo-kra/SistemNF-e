import assert from "node:assert/strict";
import test from "node:test";
import { readBootstrapOwner } from "../src/bootstrap.ts";

const valid = () => ({ SISTEM_OWNER_NAME: "  Pessoa QA  ", SISTEM_OWNER_EMAIL: "  QA.Owner@Example.Test  ",
  SISTEM_OWNER_PASSWORD: "  QA-bootstrap-password-2026!  ", SISTEM_COMPANY_NAME: "  Loja QA local  " });

test("BOOT-01 gestor é explícito, nomes/email são normalizados e senha conserva seus caracteres", () => {
  const env = valid(), owner = readBootstrapOwner(env);
  assert.equal(owner.name, "Pessoa QA"); assert.equal(owner.email, "qa.owner@example.test"); assert.equal(owner.companyName, "Loja QA local");
  assert.ok(owner.password === env.SISTEM_OWNER_PASSWORD, "password must be preserved without exposing its value");
});

test("BOOT-02 ausência ou dados inválidos recusam provisionamento sem ecoar credenciais", () => {
  const base = valid();
  const invalid = [
    ...Object.keys(base).map((key) => { const env: Record<string, string> = { ...base }; delete env[key]; return env; }),
    { ...base, SISTEM_OWNER_NAME: " " }, { ...base, SISTEM_COMPANY_NAME: " " },
    { ...base, SISTEM_OWNER_NAME: "N".repeat(121) }, { ...base, SISTEM_COMPANY_NAME: "N".repeat(121) },
    { ...base, SISTEM_OWNER_EMAIL: "not-an-email" }, { ...base, SISTEM_OWNER_EMAIL: "x".repeat(255) },
    { ...base, SISTEM_OWNER_PASSWORD: "short" }, { ...base, SISTEM_OWNER_PASSWORD: " ".repeat(20) },
  ];
  for (const env of invalid) assert.throws(() => readBootstrapOwner(env), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes(base.SISTEM_OWNER_PASSWORD) && !error.message.includes(base.SISTEM_OWNER_EMAIL), "validation errors must not echo supplied credentials");
    return true;
  });
});

test("BOOT-03 limites válidos de nome e senha são aceitos sem valores padrão", () => {
  const env = { ...valid(), SISTEM_OWNER_NAME: "N".repeat(120), SISTEM_COMPANY_NAME: "E".repeat(120), SISTEM_OWNER_PASSWORD: "A-valid-QA12" };
  const owner = readBootstrapOwner(env);
  assert.equal(owner.name.length, 120); assert.equal(owner.companyName.length, 120);
  assert.ok(owner.password === env.SISTEM_OWNER_PASSWORD, "explicit minimum-length password must be preserved");
});
