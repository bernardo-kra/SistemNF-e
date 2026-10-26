import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { migrateControl, migrateTenant } from "../src/migrations.ts";
import { ORIGIN, PASSWORD, TENANT_A, TENANT_B, assertError, authHeaders, createCustomer, createFixture, login, tenantPath, type Fixture, type TestApp, type TestUser } from "./helpers.ts";

let fixture: Fixture;
before(async () => { fixture = await createFixture(); });
after(async () => { if (fixture) await fixture.close(); });

// PostgreSQL é a autoridade dos instantes. A investigação local observou 5/100 eventos
// 1 ms adiante de Date.now(), mas nenhum fora dos limites do próprio banco.
async function databaseTimeMs() {
  const result = await fixture.a.migrationPool.query("SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint::text AS epoch_ms");
  const value = Number(result.rows[0].epoch_ms);
  assert.ok(Number.isSafeInteger(value), "database clock must return a valid epoch millisecond");
  return value;
}

async function scenario(run: (app: TestApp, user: TestUser, cookie: string) => Promise<void>, role = "owner", both = false) {
  const app = await fixture.app();
  try {
    const user = await fixture.user(role, both);
    const { cookie } = await login(app, user);
    await run(app, user, cookie);
  } finally { await app.close(); }
}

test("BE-01a login protege cookie e não devolve token; senha inválida não autentica", async () => {
  const app = await fixture.app();
  try {
    const user = await fixture.user();
    const { response } = await login(app, user);
    const setCookie = String(response.headers["set-cookie"]);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.match(setCookie, /Path=\//i);
    assert.doesNotMatch(response.body, /"(?:token|sessionToken|password|passwordHash)"\s*:/);
    const invalid = await app.instance.inject({ method: "POST", url: "/api/auth/sign-in/email", headers: { origin: ORIGIN }, payload: { email: user.email, password: "incorrect-QA-secret" } });
    assertError(invalid, 401);
    assert.ok(!invalid.headers["set-cookie"]);
  } finally { await app.close(); }
});

test("BE-01b origem ausente ou indevida bloqueia login, logout e cadastro", async () => {
  await scenario(async (app, user, cookie) => {
    for (const origin of [undefined, "https://untrusted.example.test", "null"]) {
      const headers = { cookie, ...(origin === undefined ? {} : { origin }) };
      for (const [url, payload] of [
        ["/api/auth/sign-in/email", { email: user.email, password: PASSWORD }],
        ["/api/auth/sign-out", {}],
        [tenantPath(), { name: "Não pode gravar", type: "Pessoa física" }],
      ] as const) {
        assertError(await app.instance.inject({ method: "POST", url, headers, payload }), 403);
      }
    }
    const stillValid = await app.instance.inject({ method: "GET", url: "/api/v1/me", headers: { cookie } });
    assert.equal(stillValid.statusCode, 200, "rejected logout must not revoke an authorized session");
  });
});

test("BE-01c signup e demais endpoints de autenticação não são públicos", async () => {
  const app = await fixture.app();
  try {
    const email = `uninvited-${randomUUID()}@example.test`;
    const signup = await app.instance.inject({ method: "POST", url: "/api/auth/sign-up/email", headers: { origin: ORIGIN }, payload: { email, password: PASSWORD, name: "Não provisionado" } });
    assertError(signup, 404);
    for (const url of ["/api/auth/get-session", "/api/auth/list-sessions"]) {
      assertError(await app.instance.inject({ method: "GET", url }), 404);
    }
    const created = await fixture.control.migrationPool.query('SELECT count(*)::int AS count FROM "user" WHERE email=$1', [email]);
    assert.equal(created.rows[0].count, 0);
  } finally { await app.close(); }
});

test("BE-01d produção HTTPS usa cookie Secure e login limita tentativas por IP real", async () => {
  const app = await fixture.app({ nodeEnv: "production", baseUrl: "https://api.example.test", frontendOrigin: "https://app.example.test" });
  try {
    const user = await fixture.user();
    const response = await app.instance.inject({ method: "POST", url: "/api/auth/sign-in/email", headers: { origin: "https://app.example.test" }, payload: { email: user.email, password: user.password } });
    assert.equal(response.statusCode, 200, response.body);
    assert.match(String(response.headers["set-cookie"]), /;\s*Secure(?:;|$)/i);
  } finally { await app.close(); }
  const limited = await fixture.app();
  try {
    const user = await fixture.user();
    for (let index = 0; index < 5; index += 1) {
      const response = await limited.instance.inject({ method: "POST", url: "/api/auth/sign-in/email", remoteAddress: "127.0.0.8", headers: { origin: ORIGIN, "x-forwarded-for": `203.0.113.${index + 1}` }, payload: { email: user.email, password: "incorrect-password" } });
      assertError(response, 401);
    }
    const blocked = await limited.instance.inject({ method: "POST", url: "/api/auth/sign-in/email", remoteAddress: "127.0.0.8", headers: { origin: ORIGIN, "x-forwarded-for": "203.0.113.99" }, payload: { email: user.email, password: user.password } });
    assertError(blocked, 429);
    assert.ok(!blocked.headers["set-cookie"]);
    const otherIp = await limited.instance.inject({ method: "POST", url: "/api/auth/sign-in/email", remoteAddress: "127.0.0.9", headers: { origin: ORIGIN }, payload: { email: user.email, password: user.password } });
    assert.equal(otherIp.statusCode, 200, otherIp.body);
  } finally { await limited.close(); }
});

test("BE-02a logout revoga imediatamente o cookie antigo", async () => {
  await scenario(async (app, _user, cookie) => {
    const logout = await app.instance.inject({ method: "POST", url: "/api/auth/sign-out", headers: authHeaders(cookie), payload: {} });
    assert.equal(logout.statusCode, 200, logout.body);
    assertError(await app.instance.inject({ method: "GET", url: "/api/v1/me", headers: { cookie } }), 401);
    assertError(await app.instance.inject({ method: "GET", url: tenantPath(), headers: { cookie } }), 401);
  });
});

test("BE-02b sessão expirada e cookie inválido deixam de autorizar", async () => {
  await scenario(async (app, user, cookie) => {
    await fixture.control.migrationPool.query('UPDATE "session" SET "expiresAt"=$1 WHERE "userId"=$2', [new Date("2000-01-01T00:00:00Z"), user.id]);
    assertError(await app.instance.inject({ method: "GET", url: "/api/v1/me", headers: { cookie } }), 401);
    assertError(await app.instance.inject({ method: "GET", url: tenantPath(), headers: { cookie: cookie + "tampered" } }), 401);
    assertError(await app.instance.inject({ method: "GET", url: tenantPath() }), 401);
  });
});

test("BE-02c DTO de identidade deriva vínculos ativos e não expõe conexão ou sessão", async () => {
  await scenario(async (app, user, cookie) => {
    const response = await app.instance.inject({ method: "GET", url: "/api/v1/me", headers: { cookie } });
    assert.equal(response.statusCode, 200, response.body);
    const me = response.json();
    assert.deepEqual(Object.keys(me).sort(), ["tenants", "user"]);
    assert.deepEqual(Object.keys(me.user).sort(), ["email", "id", "name"]);
    assert.equal(me.user.id, user.id);
    assert.equal(me.user.email, user.email);
    assert.equal(me.tenants.length, 1);
    assert.equal(me.tenants[0].id, TENANT_A);
    assert.equal(me.tenants[0].role, "owner");
    assert.ok(Array.isArray(me.tenants[0].permissions));
    assert.equal(response.headers["cache-control"], "no-store");
    assert.doesNotMatch(response.body, /postgresql:|database_key|runtimeUrl|authSecret|"token"|"session"/i);
  });
});

test("BE-03 vínculo só em A não lê, edita ou cria em B mesmo com header e ID válidos", async () => {
  const ownerBoth = await fixture.user("owner", true);
  const setup = await fixture.app();
  let customerB: any;
  try { customerB = await createCustomer(setup, (await login(setup, ownerBoth)).cookie, TENANT_B, { name: "Exclusivo banco B" }); }
  finally { await setup.close(); }
  const beforeB = (await fixture.b.migrationPool.query("SELECT count(*)::int AS count FROM customers")).rows[0].count;
  await scenario(async (app, _user, cookie) => {
    const headers = { ...authHeaders(cookie), "x-tenant-id": TENANT_A, "x-database-url": fixture.config.tenantDatabaseUrls.a };
    for (const request of [
      { method: "GET" as const, url: tenantPath(TENANT_B) },
      { method: "GET" as const, url: `${tenantPath(TENANT_B)}/${customerB.id}` },
      { method: "POST" as const, url: tenantPath(TENANT_B), payload: { name: "Invasão", type: "Pessoa física" } },
      { method: "PATCH" as const, url: `${tenantPath(TENANT_B)}/${customerB.id}`, payload: { version: customerB.version, name: "Invasão" } },
    ]) assertError(await app.instance.inject({ ...request, headers }), 403);
    assertError(await app.instance.inject({ method: "GET", url: `${tenantPath()}/${customerB.id}`, headers: { cookie } }), 404);
  });
  const afterB = await fixture.b.migrationPool.query("SELECT name FROM customers WHERE id=$1", [customerB.id]);
  assert.equal(afterB.rows[0].name, "Exclusivo banco B");
  assert.equal((await fixture.b.migrationPool.query("SELECT count(*)::int AS count FROM customers")).rows[0].count, beforeB);
});

test("BE-04a empresas A/B intercaladas conservam contexto explícito e resultados separados", async () => {
  await scenario(async (app, _user, cookie) => {
    const name = `Intercalado ${randomUUID()}`;
    const a = await createCustomer(app, cookie, TENANT_A, { name: `${name} A` });
    const b = await createCustomer(app, cookie, TENANT_B, { name: `${name} B` });
    const responses = await Promise.all(Array.from({ length: 8 }, (_, index) => {
      const tenant = index % 2 ? TENANT_A : TENANT_B;
      return app.instance.inject({ method: "GET", url: `${tenantPath(tenant)}?q=${encodeURIComponent(name)}`, headers: { cookie, "x-tenant-id": index % 2 ? TENANT_B : TENANT_A } });
    }));
    responses.forEach((response, index) => {
      assert.equal(response.statusCode, 200, response.body);
      const body = response.json();
      const expected = index % 2 ? a : b;
      assert.equal(body.tenantId, index % 2 ? TENANT_A : TENANT_B);
      assert.deepEqual(body.items.map((item: any) => item.id), [expected.id]);
    });
  }, "owner", true);
});

test("BE-04b revogação de vínculo e empresa inativa negam próxima requisição", async () => {
  await scenario(async (app, user, cookie) => {
    await fixture.control.migrationPool.query("UPDATE memberships SET active=false WHERE user_id=$1 AND tenant_id=$2", [user.id, TENANT_A]);
    assertError(await app.instance.inject({ method: "GET", url: tenantPath(), headers: { cookie } }), 403);
    let me = await app.instance.inject({ method: "GET", url: "/api/v1/me", headers: { cookie } });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().tenants.length, 0);
    await fixture.control.migrationPool.query("UPDATE memberships SET active=true WHERE user_id=$1 AND tenant_id=$2", [user.id, TENANT_A]);
    await fixture.control.migrationPool.query("UPDATE tenants SET active=false WHERE id=$1", [TENANT_A]);
    try {
      assertError(await app.instance.inject({ method: "GET", url: tenantPath(), headers: { cookie } }), 403);
      me = await app.instance.inject({ method: "GET", url: "/api/v1/me", headers: { cookie } });
      assert.equal(me.json().tenants.length, 0);
    } finally { await fixture.control.migrationPool.query("UPDATE tenants SET active=true WHERE id=$1", [TENANT_A]); }
  });
});

test("BE-04c viewer lê mas não grava; operator autorizado cria e atualiza", async () => {
  let customer: any;
  await scenario(async (app, _user, cookie) => {
    customer = await createCustomer(app, cookie);
    const response = await app.instance.inject({ method: "PATCH", url: `${tenantPath()}/${customer.id}`, headers: authHeaders(cookie), payload: { version: 1, phone: "12345678" } });
    assert.equal(response.statusCode, 200, response.body);
    customer = response.json().customer;
  }, "operator");
  await scenario(async (app, _user, cookie) => {
    assert.equal((await app.instance.inject({ method: "GET", url: `${tenantPath()}/${customer.id}`, headers: { cookie } })).statusCode, 200);
    assertError(await app.instance.inject({ method: "POST", url: tenantPath(), headers: authHeaders(cookie), payload: { name: "Negado", type: "Empresa" } }), 403);
    assertError(await app.instance.inject({ method: "PATCH", url: `${tenantPath()}/${customer.id}`, headers: authHeaders(cookie), payload: { version: customer.version, name: "Negado" } }), 403);
  }, "viewer");
});

test("BE-05a cadastro completo apara campos, gera ID/versão, edição e inativação preservam registro", async () => {
  await scenario(async (app, _user, cookie) => {
    const customer = await createCustomer(app, cookie, TENANT_A, { name: "  Cliente persistente  ", email: "  qa@example.test  ", phone: " 11999990000 ", type: "Empresa" });
    assert.deepEqual(Object.keys(customer).sort(), ["active", "createdAt", "email", "id", "name", "phone", "type", "updatedAt", "version"]);
    assert.match(customer.id, /^[0-9a-f]{8}-[0-9a-f-]{27}$/i);
    assert.equal(customer.name, "Cliente persistente");
    assert.equal(customer.email, "qa@example.test");
    assert.equal(customer.phone, "11999990000");
    assert.equal(customer.active, true);
    assert.equal(customer.version, 1);
    assert.ok(Number.isFinite(Date.parse(customer.createdAt)));
    const edited = await app.instance.inject({ method: "PATCH", url: `${tenantPath()}/${customer.id}`, headers: authHeaders(cookie), payload: { version: 1, name: "Cliente alterado", active: false, email: "" } });
    assert.equal(edited.statusCode, 200, edited.body);
    assert.equal(edited.json().customer.version, 2);
    assert.equal(edited.json().customer.active, false);
    assert.equal(edited.json().customer.email, "");
    const read = await app.instance.inject({ method: "GET", url: `${tenantPath()}/${customer.id}`, headers: { cookie } });
    assert.equal(read.statusCode, 200);
    assert.equal(read.json().customer.name, "Cliente alterado");
    assert.equal(read.json().customer.createdAt, customer.createdAt);
    assert.equal(read.headers["cache-control"], "no-store");
  });
});

test("BE-05b busca literal/paginação estável e ausência retornam resultados explícitos", async () => {
  await scenario(async (app, _user, cookie) => {
    const marker = `Pagina${randomUUID()}`;
    const first = await createCustomer(app, cookie, TENANT_A, { name: `${marker} B` });
    const second = await createCustomer(app, cookie, TENANT_A, { name: `${marker} A` });
    await createCustomer(app, cookie, TENANT_A, { name: `${marker} C_100%` });
    const response = await app.instance.inject({ method: "GET", url: `${tenantPath()}?q=${marker}&limit=1&offset=1`, headers: { cookie } });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.tenantId, TENANT_A);
    assert.equal(body.total, 3);
    assert.equal(body.limit, 1);
    assert.equal(body.offset, 1);
    assert.deepEqual(body.items.map((item: any) => item.id), [first.id]);
    const pageZero = await app.instance.inject({ method: "GET", url: `${tenantPath()}?q=${marker}&limit=1`, headers: { cookie } });
    assert.equal(pageZero.json().items[0].id, second.id);
    const literal = await app.instance.inject({ method: "GET", url: `${tenantPath()}?q=${encodeURIComponent(`${marker} C_100%`)}`, headers: { cookie } });
    assert.equal(literal.json().total, 1);
    const missing = `${tenantPath()}/${randomUUID()}`;
    assertError(await app.instance.inject({ method: "GET", url: missing, headers: { cookie } }), 404);
    assertError(await app.instance.inject({ method: "PATCH", url: missing, headers: authHeaders(cookie), payload: { version: 1, name: "Ausente" } }), 404);
  });
});

test("BE-05c cadastro persiste quando app e pools são reconstruídos", async () => {
  const user = await fixture.user();
  let app = await fixture.app();
  let customer: any;
  let cookie = "";
  try {
    cookie = (await login(app, user)).cookie;
    customer = await createCustomer(app, cookie, TENANT_A, { name: "Persistência real PostgreSQL" });
  } finally { await app.close(); }
  app = await fixture.app();
  try {
    const read = await app.instance.inject({ method: "GET", url: `${tenantPath()}/${customer.id}`, headers: { cookie } });
    assert.equal(read.statusCode, 200, read.body);
    assert.deepEqual(read.json().customer, customer);
  } finally { await app.close(); }
});

test("BE-05d auditoria acompanha escrita com autor/empresa do servidor e sem PII", async () => {
  await scenario(async (app, user, cookie) => {
    const customer = await createCustomer(app, cookie, TENANT_A, { name: "PII-QA-NOME-EXCLUSIVO", email: "pii-audit@example.test", phone: "11987654321" });
    const patch = await app.instance.inject({ method: "PATCH", url: `${tenantPath()}/${customer.id}`, headers: { ...authHeaders(cookie), "x-user-id": "forged-actor", "x-tenant-id": TENANT_B }, payload: { version: 1, phone: "11900000000" } });
    assert.equal(patch.statusCode, 200, patch.body);
    const events = await fixture.a.migrationPool.query("SELECT * FROM audit_events WHERE entity_id=$1 ORDER BY entity_version", [customer.id]);
    assert.equal(events.rowCount, 2);
    assert.deepEqual(events.rows.map((row) => row.entity_version), [1, 2]);
    assert.deepEqual(events.rows.map((row) => row.action), ["customer.created", "customer.updated"]);
    for (const event of events.rows) {
      assert.equal(event.tenant_id, TENANT_A);
      assert.equal(event.actor_id, user.id);
      assert.ok(event.id);
    }
    assert.doesNotMatch(JSON.stringify(events.rows), /PII-QA-NOME-EXCLUSIVO|pii-audit@example\.test|11987654321|11900000000|forged-actor/);
    assert.equal((await fixture.b.migrationPool.query("SELECT count(*)::int AS count FROM audit_events WHERE entity_id=$1", [customer.id])).rows[0].count, 0);
  });
});

test("BE-06a dados inválidos, extras e autoria forjada são recusados sem gravar", async () => {
  await scenario(async (app, _user, cookie) => {
    const before = (await fixture.a.migrationPool.query("SELECT count(*)::int AS count FROM customers")).rows[0].count;
    const valid = { name: "Cliente válido", type: "Pessoa física" };
    const invalid = [
      { ...valid, name: " " }, { ...valid, name: "n".repeat(121) }, { ...valid, name: 10 },
      { ...valid, type: "unknown" }, { ...valid, type: null },
      { ...valid, email: "x".repeat(255) }, { ...valid, email: "invalid-email" },
      { ...valid, phone: "1".repeat(33) }, { ...valid, phone: 123 },
      ...["id", "tenantId", "actorId", "createdAt", "updatedAt", "version", "databaseUrl", "active"].map((key) => ({ ...valid, [key]: "forged" })),
    ];
    for (const payload of invalid) assertError(await app.instance.inject({ method: "POST", url: tenantPath(), headers: authHeaders(cookie), payload }), 400);
    assert.equal((await fixture.a.migrationPool.query("SELECT count(*)::int AS count FROM customers")).rows[0].count, before);
  });
});

test("BE-06b PATCH e paginação rejeitam tipos/limites/campos extras sem modificar registro", async () => {
  await scenario(async (app, _user, cookie) => {
    const customer = await createCustomer(app, cookie);
    for (const payload of [{ name: "Sem versão" }, { version: 0, name: "Zero" }, { version: 1.5, name: "Fração" }, { version: "1", name: "Texto" }, { version: 1 }, { version: 1, id: randomUUID() }, { version: 1, active: "false" }, { version: 1, name: " " }]) {
      assertError(await app.instance.inject({ method: "PATCH", url: `${tenantPath()}/${customer.id}`, headers: authHeaders(cookie), payload }), 400);
    }
    for (const query of ["limit=0", "limit=101", "limit=1.5", "limit=x", "offset=-1", "offset=10001", "offset=1.5", `q=${"x".repeat(101)}`]) {
      assertError(await app.instance.inject({ method: "GET", url: `${tenantPath()}?${query}`, headers: { cookie } }), 400);
    }
    const read = await app.instance.inject({ method: "GET", url: `${tenantPath()}/${customer.id}`, headers: { cookie } });
    assert.deepEqual(read.json().customer, customer);
  });
});

test("BE-06c texto de SQL permanece dado literal e não altera tabelas", async () => {
  await scenario(async (app, _user, cookie) => {
    const name = `QA '; DROP TABLE customers; -- ${randomUUID()}`;
    const customer = await createCustomer(app, cookie, TENANT_A, { name });
    const found = await app.instance.inject({ method: "GET", url: `${tenantPath()}?q=${encodeURIComponent(name)}`, headers: { cookie } });
    assert.equal(found.statusCode, 200, found.body);
    assert.equal(found.json().total, 1);
    assert.equal(found.json().items[0].id, customer.id);
    const injection = await app.instance.inject({ method: "GET", url: `${tenantPath()}?q=${encodeURIComponent("' OR 1=1 --")}`, headers: { cookie } });
    assert.equal(injection.json().total, 0);
    assert.equal((await fixture.a.migrationPool.query("SELECT name FROM customers WHERE id=$1", [customer.id])).rows[0].name, name);
  });
});

test("BE-07 duas edições simultâneas confirmam uma única versão e uma auditoria", async () => {
  await scenario(async (app, _user, cookie) => {
    const customer = await createCustomer(app, cookie);
    const results = await Promise.all(["Concorrente A", "Concorrente B"].map((name) => app.instance.inject({ method: "PATCH", url: `${tenantPath()}/${customer.id}`, headers: authHeaders(cookie), payload: { version: 1, name } })));
    assert.deepEqual(results.map((response) => response.statusCode).sort(), [200, 409]);
    const winner = results.find((response) => response.statusCode === 200)!.json().customer;
    assert.equal(winner.version, 2);
    assertError(results.find((response) => response.statusCode === 409)!, 409);
    const stored = (await fixture.a.migrationPool.query("SELECT name,version FROM customers WHERE id=$1", [customer.id])).rows[0];
    assert.deepEqual(stored, { name: winner.name, version: 2 });
    const audits = await fixture.a.migrationPool.query("SELECT entity_version FROM audit_events WHERE entity_id=$1 ORDER BY entity_version", [customer.id]);
    assert.deepEqual(audits.rows.map((row) => row.entity_version), [1, 2]);
  });
});

test("BE-08a readiness falha de modo controlado com banco central indisponível", async () => {
  const unavailable = fixture.config.controlDatabaseUrl.replace(/\/[A-Za-z0-9_]+$/, "/qa_database_does_not_exist");
  const app = await fixture.app({ controlDatabaseUrl: unavailable });
  try {
    const live = await app.instance.inject({ method: "GET", url: "/health/live" });
    assert.equal(live.statusCode, 200);
    const ready = await app.instance.inject({ method: "GET", url: "/health/ready" });
    assertError(ready, 503);
    assert.doesNotMatch(ready.body, /postgresql:|password|does_not_exist|SELECT|ECONN|stack/i);
    assert.doesNotMatch(JSON.stringify(app.logs), /postgresql:|does_not_exist|password|SELECT|stack/i);
  } finally { await app.close(); }
});

test("BE-08b banco operacional indisponível não usa B nem exemplos como fallback", async () => {
  const unavailable = fixture.config.tenantDatabaseUrls.a.replace(/\/[A-Za-z0-9_]+$/, "/qa_tenant_does_not_exist");
  const app = await fixture.app({ tenantDatabaseUrls: { a: unavailable, b: fixture.config.tenantDatabaseUrls.b } });
  try {
    const user = await fixture.user("owner", true);
    const { cookie } = await login(app, user);
    assertError(await app.instance.inject({ method: "GET", url: tenantPath(), headers: { cookie } }), 503);
    assertError(await app.instance.inject({ method: "POST", url: tenantPath(), headers: authHeaders(cookie), payload: { name: "Não gravar em fallback", type: "Empresa" } }), 503);
    const b = await app.instance.inject({ method: "GET", url: tenantPath(TENANT_B), headers: { cookie } });
    assert.equal(b.statusCode, 200, b.body);
    assert.equal((await fixture.b.migrationPool.query("SELECT count(*)::int AS count FROM customers WHERE name=$1", ["Não gravar em fallback"])).rows[0].count, 0);
  } finally { await app.close(); }
});

test("BE-08c logs/erro ignoram dados pessoais, query, cookies e request ID forjado", async () => {
  await scenario(async (app, user, cookie) => {
    const secrets = ["QA-LOG-PRIVATE-NAME", "qa-log-private@example.test", "11988887777", "QAQUERYPRIVATE", "FORGEDREQUESTID"];
    const customer = await createCustomer(app, cookie, TENANT_A, { name: secrets[0], email: secrets[1], phone: secrets[2] });
    const bad = await app.instance.inject({ method: "PATCH", url: `${tenantPath()}/${customer.id}?private=${secrets[3]}`, headers: { ...authHeaders(cookie), "x-request-id": secrets[4] }, payload: { version: 1, tenantId: TENANT_B, password: PASSWORD } });
    const error = assertError(bad, 400);
    assert.notEqual(error.requestId, secrets[4]);
    await app.instance.inject({ method: "GET", url: `${tenantPath()}?q=${secrets[3]}`, headers: { cookie } });
    const text = [...app.logs, bad.body].join("\n");
    for (const secret of [...secrets, PASSWORD, cookie, user.email, fixture.config.authSecret, fixture.config.controlDatabaseUrl]) assert.ok(!text.includes(secret), `log leaked synthetic secret ${secret.slice(0, 18)}`);
    assert.ok(app.logs.length > 0, "observability must write catalog records");
    assert.ok(text.includes(error.requestId), "error must be correlated with server log");
  });
});

test("BE-09a repetir migrações preserva dados e runtime não ganha DDL ou superprivilégios", async () => {
  await scenario(async (app, _user, cookie) => {
    const customer = await createCustomer(app, cookie, TENANT_A, { name: "Preservar ao migrar" });
    await migrateControl(fixture.control.migrationPool);
    await migrateTenant(fixture.a.migrationPool);
    const stored = await fixture.a.migrationPool.query("SELECT name,version FROM customers WHERE id=$1", [customer.id]);
    assert.deepEqual(stored.rows, [{ name: "Preservar ao migrar", version: 1 }]);
    for (const url of [fixture.config.controlDatabaseUrl, fixture.config.tenantDatabaseUrls.a, fixture.config.tenantDatabaseUrls.b]) {
      const pool = new Pool({ connectionString: url, max: 1 });
      try {
        const role = (await pool.query("SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user")).rows[0];
        assert.deepEqual(role, { rolsuper: false, rolcreatedb: false, rolcreaterole: false });
        await assert.rejects(pool.query("CREATE TABLE qa_forbidden_ddl (id int)"), (error: any) => error.code === "42501");
      } finally { await pool.end(); }
    }
  });
});

test("BE-09b role operacional A não conecta no banco B", async () => {
  const fromA = new URL(fixture.config.tenantDatabaseUrls.a);
  const toB = new URL(fixture.config.tenantDatabaseUrls.b);
  fromA.pathname = toB.pathname;
  const pool = new Pool({ connectionString: fromA.toString(), max: 1, connectionTimeoutMillis: 1000 });
  try { await assert.rejects(pool.query("SELECT 1"), (error: any) => error.code === "42501" || error.code === "28000"); }
  finally { await pool.end(); }
});

test("BE-09c falha da auditoria faz rollback do cliente inteiro", async () => {
  const app = await fixture.app();
  const runtimeRole = decodeURIComponent(new URL(fixture.config.tenantDatabaseUrls.a).username);
  assert.match(runtimeRole, /^[a-zA-Z0-9_]+$/);
  const before = (await fixture.a.migrationPool.query("SELECT count(*)::int AS count FROM customers")).rows[0].count;
  await fixture.a.migrationPool.query(`REVOKE INSERT ON audit_events FROM "${runtimeRole}"`);
  try {
    const user = await fixture.user();
    const { cookie } = await login(app, user);
    const response = await app.instance.inject({ method: "POST", url: tenantPath(), headers: authHeaders(cookie), payload: { name: "Rollback obrigatório", type: "Empresa" } });
    assertError(response, 503);
    assert.equal((await fixture.a.migrationPool.query("SELECT count(*)::int AS count FROM customers")).rows[0].count, before);
    assert.equal((await fixture.a.migrationPool.query("SELECT count(*)::int AS count FROM customers WHERE name=$1", ["Rollback obrigatório"])).rows[0].count, 0);
  } finally {
    await fixture.a.migrationPool.query(`GRANT INSERT ON audit_events TO "${runtimeRole}"`);
    await app.close();
  }
});

test("BE-10 smoke por HTTP real autentica, consulta e revoga em loopback", async () => {
  const app = await fixture.app();
  try {
    const user = await fixture.user();
    const address = await app.instance.listen({ host: "127.0.0.1", port: 0 });
    const live = await fetch(`${address}/health/live`);
    assert.equal(live.status, 200);
    const signIn = await fetch(`${address}/api/auth/sign-in/email`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ email: user.email, password: PASSWORD }) });
    assert.equal(signIn.status, 200, await signIn.text());
    const cookie = signIn.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
    assert.ok(cookie);
    const me = await fetch(`${address}/api/v1/me`, { headers: { cookie } });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).user.id, user.id);
    const logout = await fetch(`${address}/api/auth/sign-out`, { method: "POST", headers: { ...authHeaders(cookie), "content-type": "application/json" }, body: "{}" });
    assert.equal(logout.status, 200);
    assert.equal((await fetch(`${address}/api/v1/me`, { headers: { cookie } })).status, 401);
  } finally { await app.close(); }
});

// Complemento aprovado do doc15: horário/autoria do servidor e ausência de escrita em PATCH sem mudança.
test("ACES-T01 criação, alteração e auditoria usam instantes UTC do servidor; horário forjado é recusado", async () => {
  await scenario(async (app, user, cookie) => {
    const started = await databaseTimeMs();
    const customer = await createCustomer(app, cookie, TENANT_A, { name: "Cliente QA horário" });
    const patch = await app.instance.inject({ method: "PATCH", url: `${tenantPath()}/${customer.id}`, headers: authHeaders(cookie), payload: { version: 1, phone: "11912340000" } });
    assert.equal(patch.statusCode, 200, patch.body);
    const edited = patch.json().customer;
    const finished = await databaseTimeMs();
    for (const value of [customer.createdAt, customer.updatedAt, edited.createdAt, edited.updatedAt]) {
      assert.equal(typeof value, "string");
      assert.match(value, /(?:Z|\+00:00)$/);
      const timestamp = Date.parse(value);
      assert.ok(Number.isFinite(timestamp) && timestamp >= started && timestamp <= finished, "DTO time must come from the request's server interval");
    }
    assert.equal(edited.createdAt, customer.createdAt);
    const events = await fixture.a.migrationPool.query("SELECT at,actor_id,tenant_id,entity_version FROM audit_events WHERE entity_id=$1 ORDER BY entity_version", [customer.id]);
    assert.equal(events.rowCount, 2);
    for (const event of events.rows) {
      const timestamp = new Date(event.at).getTime();
      assert.ok(Number.isFinite(timestamp) && timestamp >= started && timestamp <= finished, "audit time must come from the server interval");
      assert.equal(event.actor_id, user.id); assert.equal(event.tenant_id, TENANT_A);
    }
    const spoofed = await app.instance.inject({ method: "PATCH", url: `${tenantPath()}/${customer.id}`, headers: authHeaders(cookie), payload: { version: 2, phone: "11999991111", updatedAt: "2000-01-01T00:00:00.000Z", at: "2000-01-01T00:00:00.000Z" } });
    assertError(spoofed, 400);
    assert.equal((await fixture.a.migrationPool.query("SELECT count(*)::int AS count FROM audit_events WHERE entity_id=$1", [customer.id])).rows[0].count, 2);
    const read = await app.instance.inject({ method: "GET", url: `${tenantPath()}/${customer.id}`, headers: { cookie } });
    assert.deepEqual(read.json().customer, edited);
  });
});

test("ACES-T02 PATCH sem mudança preserva versão/data/auditoria; alteração real muda somente os metadados pertinentes", async () => {
  await scenario(async (app, _user, cookie) => {
    const customer = await createCustomer(app, cookie, TENANT_A, { name: "Cliente QA sem mudança" });
    const before = (await fixture.a.migrationPool.query("SELECT count(*)::int AS count FROM audit_events WHERE entity_id=$1", [customer.id])).rows[0].count;
    // PostgreSQL/JSON expõem milissegundos; separar os instantes torna verificável uma atualização real.
    await new Promise((resolve) => setTimeout(resolve, 10));
    const unchanged = await app.instance.inject({ method: "PATCH", url: `${tenantPath()}/${customer.id}`, headers: authHeaders(cookie), payload: { version: customer.version, name: customer.name, email: customer.email } });
    assert.equal(unchanged.statusCode, 200, unchanged.body);
    assert.deepEqual(unchanged.json().customer, customer);
    assert.equal((await fixture.a.migrationPool.query("SELECT count(*)::int AS count FROM audit_events WHERE entity_id=$1", [customer.id])).rows[0].count, before);
    const started = await databaseTimeMs();
    const changed = await app.instance.inject({ method: "PATCH", url: `${tenantPath()}/${customer.id}`, headers: authHeaders(cookie), payload: { version: customer.version, phone: "11955550000" } });
    assert.equal(changed.statusCode, 200, changed.body);
    const edited = changed.json().customer;
    const finished = await databaseTimeMs();
    assert.equal(edited.version, customer.version + 1); assert.equal(edited.createdAt, customer.createdAt);
    assert.ok(Date.parse(edited.updatedAt) >= started && Date.parse(edited.updatedAt) <= finished);
    assert.notEqual(edited.updatedAt, customer.updatedAt);
    assert.equal((await fixture.a.migrationPool.query("SELECT count(*)::int AS count FROM audit_events WHERE entity_id=$1", [customer.id])).rows[0].count, before + 1);
  });
});

test("BE-06d nome no limite válido de 120 caracteres é aceito integralmente sem truncar", async () => {
  await scenario(async (app, _user, cookie) => {
    const name = "N".repeat(120);
    const customer = await createCustomer(app, cookie, TENANT_A, { name });
    assert.equal(customer.name, name);
    const stored = await fixture.a.migrationPool.query("SELECT name,length(name)::int AS length FROM customers WHERE id=$1", [customer.id]);
    assert.deepEqual(stored.rows, [{ name, length: 120 }]);
  });
});
