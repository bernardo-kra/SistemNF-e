import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { migrateControl } from "../src/migrations.ts";
import { ORIGIN, PASSWORD, TENANT_A, TENANT_B, assertError, authHeaders, createCustomer, createFixture, login, tenantPath, type Fixture, type TestApp } from "./helpers.ts";

// ACC: expectativas do contrato do documento 15, escritas antes da implementação.
let fixture: Fixture;
before(async () => { fixture = await createFixture(); });
after(async () => { await fixture?.close(); });
const memberKeys = ["active", "createdAt", "email", "id", "name", "overrides", "permissions", "role", "updatedAt", "version"].sort();
const customerPermissions = ["customers.read", "customers.create", "customers.update", "customers.archive"];
// FIN-LIVE grants the owner five new rights; existing employee defaults stay unchanged.
const financePermissions = ["finance.read", "finance.agreements.create", "finance.receive", "finance.accounts.manage", "finance.cash.manage"];
// OP/DSC add owner rights; employees require explicit grants, including sales.discount.
const operationalPermissions = ["products.read", "products.create", "products.update", "products.archive", "products.cost.read", "stock.read", "stock.receive", "sales.read", "sales.create", "sales.deliver", "sales.discount", "orders.read", "orders.create", "orders.update", "orders.advance", "orders.deliver", "purchases.read", "purchases.import", "purchases.receive", "audit.read"];
const base = (tenant = TENANT_A) => `/api/v1/tenants/${tenant}`;
const members = (tenant = TENANT_A) => `${base(tenant)}/members`;
const auditPath = (tenant = TENANT_A) => `${base(tenant)}/access-audit`;
const attempt = (patch: Record<string, unknown> = {}) => ({ requestId: randomUUID(), name: "Funcionário QA", email: `acc-${randomUUID()}@example.test`, password: PASSWORD, role: "operator", ...patch });
async function ownerScenario(run: (app: TestApp, cookie: string, actor: { id: string; email: string }) => Promise<void>) {
  const app = await fixture.app();
  try { const actor = await fixture.user(); const { cookie } = await login(app, actor); await run(app, cookie, actor); }
  finally { await app.close(); }
}
async function createMember(app: TestApp, cookie: string, payload = attempt(), tenant = TENANT_A) {
  const response = await app.instance.inject({ method: "POST", url: members(tenant), headers: authHeaders(cookie), payload });
  assert.equal(response.statusCode, 201, response.body);
  const data = response.json(); assert.equal(data.tenantId, tenant);
  assert.deepEqual(Object.keys(data.member).sort(), memberKeys);
  return { member: data.member, payload };
}
async function readMember(app: TestApp, cookie: string, id: string, tenant = TENANT_A) {
  const response = await app.instance.inject({ method: "GET", url: `${members(tenant)}?limit=100`, headers: { cookie } });
  assert.equal(response.statusCode, 200, response.body);
  const member = response.json().items.find((entry: { id: string }) => entry.id === id); assert.ok(member);
  return member;
}
async function audits(app: TestApp, cookie: string, tenant = TENANT_A) {
  const response = await app.instance.inject({ method: "GET", url: `${auditPath(tenant)}?limit=100`, headers: { cookie } });
  assert.equal(response.statusCode, 200, response.body); return response.json().items as Array<{ id: string; actorId: string; targetId: string; action: string; version: number; fields: string[]; at: string }>;
}

test("ACC-01 equipe exige sessão e gestor; operador não se promove por chamada direta", async () => {
  const app = await fixture.app();
  try {
    const employee = await fixture.user("operator"); const { cookie } = await login(app, employee);
    for (const route of [members(), `${base()}/access-options`, auditPath()]) {
      assertError(await app.instance.inject({ method: "GET", url: route }), 401);
      assertError(await app.instance.inject({ method: "GET", url: route, headers: { cookie } }), 403);
    }
    assertError(await app.instance.inject({ method: "PATCH", url: `${members()}/${employee.id}`, headers: authHeaders(cookie), payload: { version: 1, role: "owner" } }), 403);
    assertError(await app.instance.inject({ method: "POST", url: members(), headers: authHeaders(cookie), payload: attempt() }), 403);
    const record = await fixture.control.migrationPool.query("SELECT role FROM memberships WHERE user_id=$1 AND tenant_id=$2", [employee.id, TENANT_A]);
    assert.equal(record.rows[0].role, "operator");
  } finally { await app.close(); }
});

test("ACC-02 opções e DTO de equipe só expõem campos do contrato e dados da empresa autorizada", async () => {
  await ownerScenario(async (app, cookie, actor) => {
    const options = await app.instance.inject({ method: "GET", url: `${base()}/access-options`, headers: { cookie } });
    assert.equal(options.statusCode, 200, options.body);
    assert.deepEqual(options.json().permissions.map((item: { id: string }) => item.id).sort(), [...customerPermissions].sort());
    assert.deepEqual(options.json().roles.map((item: { id: string }) => item.id).sort(), ["operator", "owner", "viewer"]);
    const listed = await app.instance.inject({ method: "GET", url: `${members()}?q=${encodeURIComponent(actor.email)}`, headers: { cookie } });
    assert.equal(listed.statusCode, 200, listed.body); assert.equal(listed.json().total, 1);
    const member = listed.json().items[0]; assert.deepEqual(Object.keys(member).sort(), memberKeys);
    assert.equal(member.id, actor.id); assert.equal(member.version, 1);
    assert.equal(member.createdAt, null); assert.equal(member.updatedAt, null);
    assert.deepEqual(member.permissions.slice().sort(), [...customerPermissions, ...operationalPermissions, ...financePermissions, "team.read", "team.manage"].sort());
    for (const route of [members(TENANT_B), `${base(TENANT_B)}/access-options`, auditPath(TENANT_B)]) {
      assertError(await app.instance.inject({ method: "GET", url: route, headers: { cookie, "x-tenant-id": TENANT_B } }), 403);
    }
  });
});

test("ACC-03 gestor cria funcionário com SDK, login real e vínculo/auditoria sem dados pessoais", async () => {
  await ownerScenario(async (app, cookie, actor) => {
    const { member, payload } = await createMember(app, cookie);
    assert.equal(member.name, payload.name); assert.equal(member.email, payload.email);
    assert.equal(member.role, "operator"); assert.equal(member.active, true); assert.equal(member.version, 1);
    assert.deepEqual(member.overrides, {}); assert.deepEqual(member.permissions.slice().sort(), [...customerPermissions].sort());
    for (const value of [member.createdAt, member.updatedAt]) { assert.equal(typeof value, "string"); assert.match(value, /Z$/); assert.ok(Number.isFinite(Date.parse(value))); }
    const signedIn = await login(app, { id: member.id, email: payload.email, password: payload.password });
    const me = await app.instance.inject({ method: "GET", url: "/api/v1/me", headers: { cookie: signedIn.cookie } });
    assert.equal(me.statusCode, 200); assert.equal(me.json().user.id, member.id);
    assert.deepEqual(me.json().tenants.map((item: { id: string }) => item.id), [TENANT_A]);
    const events = (await audits(app, cookie)).filter((event) => event.targetId === member.id);
    assert.equal(events.length, 1); assert.equal(events[0].actorId, actor.id); assert.equal(events[0].version, 1);
    assert.deepEqual(Object.keys(events[0]).sort(), ["action", "actorId", "at", "fields", "id", "targetId", "version"]);
    assert.ok(events[0].action); assert.match(events[0].at, /Z$/);
    for (const secret of [payload.email, payload.name, payload.password, fixture.config.controlDatabaseUrl, signedIn.cookie]) {
      assert.ok(!JSON.stringify(events).includes(secret)); assert.ok(!app.logs.join("\n").includes(secret));
    }
  });
});

test("ACC-04 repetir tentativa preserva identidade, vínculo e senha; conteúdo diferente conflita", async () => {
  await ownerScenario(async (app, cookie) => {
    const { member, payload } = await createMember(app, cookie);
    const repeated = await createMember(app, cookie, { ...payload, password: "Different-QA-password!" });
    assert.deepEqual(repeated.member, member);
    assertError(await app.instance.inject({ method: "POST", url: members(), headers: authHeaders(cookie), payload: { ...payload, name: "Outro nome" } }), 409);
    const count = await fixture.control.migrationPool.query('SELECT count(*)::int AS count FROM "user" WHERE email=$1', [payload.email]);
    assert.equal(count.rows[0].count, 1);
    assert.equal((await audits(app, cookie)).filter((event) => event.targetId === member.id).length, 1);
    await login(app, { id: member.id, email: payload.email, password: payload.password });
    const changedPassword = await app.instance.inject({ method: "POST", url: "/api/auth/sign-in/email", headers: { origin: ORIGIN }, payload: { email: payload.email, password: "Different-QA-password!" } });
    assertError(changedPassword, 401);
  });
});

test("ACC-05 e-mail preexistente não é adotado nem exposto, mesmo em outra empresa", async () => {
  await ownerScenario(async (app, cookie) => {
    const other = await fixture.user("viewer", true);
    await fixture.control.migrationPool.query("DELETE FROM memberships WHERE user_id=$1 AND tenant_id=$2", [other.id, TENANT_A]);
    const response = await app.instance.inject({ method: "POST", url: members(), headers: authHeaders(cookie), payload: attempt({ email: other.email, name: "Não adotar", role: "owner" }) });
    assertError(response, 409); assert.ok(!response.body.includes(other.id)); assert.ok(!response.body.includes(other.email));
    assert.equal((await fixture.control.migrationPool.query("SELECT count(*)::int AS count FROM memberships WHERE user_id=$1 AND tenant_id=$2", [other.id, TENANT_A])).rows[0].count, 0);
    assert.equal((await fixture.control.migrationPool.query("SELECT role FROM memberships WHERE user_id=$1 AND tenant_id=$2", [other.id, TENANT_B])).rows[0].role, "viewer");
  });
});

test("ACC-06 criação concorrente do mesmo e-mail confirma somente uma conta/vínculo", async () => {
  await ownerScenario(async (app, cookie) => {
    const payload = attempt(); const second = { ...payload, requestId: randomUUID() };
    const result = await Promise.all([payload, second].map((body) => app.instance.inject({ method: "POST", url: members(), headers: authHeaders(cookie), payload: body })));
    assert.deepEqual(result.map((response) => response.statusCode).sort(), [201, 409]);
    const users = await fixture.control.migrationPool.query('SELECT id FROM "user" WHERE email=$1', [payload.email]); assert.equal(users.rowCount, 1);
    assert.equal((await audits(app, cookie)).filter((event) => event.targetId === users.rows[0].id).length, 1);
  });
});

test("ACC-07 permissões customizadas valem imediatamente para me e endpoints de clientes", async () => {
  await ownerScenario(async (app, cookie) => {
    const { member, payload } = await createMember(app, cookie, attempt({ role: "viewer" }));
    const employee = await login(app, { id: member.id, email: payload.email, password: payload.password });
    const denied = () => app.instance.inject({ method: "POST", url: tenantPath(), headers: authHeaders(employee.cookie), payload: { name: "Cliente autorizado", type: "Empresa" } });
    assertError(await denied(), 403);
    const grant = await app.instance.inject({ method: "PATCH", url: `${members()}/${member.id}`, headers: authHeaders(cookie), payload: { version: 1, overrides: { "customers.create": true } } });
    assert.equal(grant.statusCode, 200, grant.body); assert.equal((await denied()).statusCode, 201);
    const me = await app.instance.inject({ method: "GET", url: "/api/v1/me", headers: { cookie: employee.cookie } });
    assert.deepEqual(me.json().tenants[0].permissions.slice().sort(), ["customers.create", "customers.read"]);
    const revoke = await app.instance.inject({ method: "PATCH", url: `${members()}/${member.id}`, headers: authHeaders(cookie), payload: { version: 2, overrides: { "customers.read": false } } });
    assert.equal(revoke.statusCode, 200, revoke.body);
    assertError(await denied(), 403);
    assertError(await app.instance.inject({ method: "GET", url: tenantPath(), headers: { cookie: employee.cookie } }), 403);
  });
});

test("ACC-08 revogação do vínculo em A impede próxima requisição sem afetar B", async () => {
  await ownerScenario(async (app, cookie) => {
    const employee = await fixture.user("operator", true); const session = await login(app, employee);
    const patch = await app.instance.inject({ method: "PATCH", url: `${members()}/${employee.id}`, headers: authHeaders(cookie), payload: { version: 1, active: false } });
    assert.equal(patch.statusCode, 200, patch.body);
    assertError(await app.instance.inject({ method: "GET", url: tenantPath(), headers: { cookie: session.cookie } }), 403);
    assert.equal((await app.instance.inject({ method: "GET", url: tenantPath(TENANT_B), headers: { cookie: session.cookie } })).statusCode, 200);
    const me = await app.instance.inject({ method: "GET", url: "/api/v1/me", headers: { cookie: session.cookie } });
    assert.deepEqual(me.json().tenants.map((entry: { id: string }) => entry.id), [TENANT_B]);
  });
});

test("ACC-09 versão obsoleta conflita; no-op não inventa horário, versão ou auditoria", async () => {
  await ownerScenario(async (app, cookie, actor) => {
    const legacy = await fixture.user("viewer"); const original = await readMember(app, cookie, legacy.id);
    const originalAudit = (await audits(app, cookie)).filter((event) => event.targetId === legacy.id);
    const noop = await app.instance.inject({ method: "PATCH", url: `${members()}/${legacy.id}`, headers: authHeaders(cookie), payload: { version: 1, role: "viewer", active: true, overrides: {} } });
    assert.equal(noop.statusCode, 200, noop.body); assert.deepEqual(noop.json().member, original);
    assert.deepEqual((await audits(app, cookie)).filter((event) => event.targetId === legacy.id), originalAudit);
    const patch = await app.instance.inject({ method: "PATCH", url: `${members()}/${legacy.id}`, headers: authHeaders(cookie), payload: { version: 1, role: "operator" } });
    assert.equal(patch.statusCode, 200, patch.body); const changed = patch.json().member;
    assert.equal(changed.version, 2); assert.equal(changed.createdAt, null); assert.match(changed.updatedAt, /Z$/);
    assertError(await app.instance.inject({ method: "PATCH", url: `${members()}/${legacy.id}`, headers: authHeaders(cookie), payload: { version: 1, active: false } }), 409);
    assert.deepEqual(await readMember(app, cookie, legacy.id), changed);
    const event = (await audits(app, cookie)).filter((entry) => entry.targetId === legacy.id);
    assert.equal(event.length, originalAudit.length + 1); assert.equal(event[0].actorId, actor.id); assert.deepEqual(event[0].fields, ["role"]);
  });
});

test("ACC-10 último gestor fica protegido sob duas alterações concorrentes", async () => {
  const app = await fixture.app();
  const saved = await fixture.control.migrationPool.query("SELECT user_id,active FROM memberships WHERE tenant_id=$1", [TENANT_A]);
  try {
    await fixture.control.migrationPool.query("UPDATE memberships SET active=false WHERE tenant_id=$1", [TENANT_A]);
    const first = await fixture.user("owner"), second = await fixture.user("owner");
    const one = await login(app, first), two = await login(app, second);
    const result = await Promise.all([[first, one], [second, two]].map(([user, session]) => app.instance.inject({ method: "PATCH", url: `${members()}/${(user as { id: string }).id}`, headers: authHeaders((session as { cookie: string }).cookie), payload: { version: 1, role: "viewer" } })));
    assert.deepEqual(result.map((response) => response.statusCode).sort(), [200, 409]);
    const failed = result.find((response) => response.statusCode === 409)!; assert.equal(failed.json().error.code, "LAST_OWNER");
    assert.equal((await fixture.control.migrationPool.query("SELECT count(*)::int AS count FROM memberships WHERE tenant_id=$1 AND role='owner' AND active", [TENANT_A])).rows[0].count, 1);
    const owner = result[0].statusCode === 409 ? { user: first, session: one } : { user: second, session: two };
    const inactive = await app.instance.inject({ method: "PATCH", url: `${members()}/${owner.user.id}`, headers: authHeaders(owner.session.cookie), payload: { version: 1, active: false } });
    assert.equal(assertError(inactive, 409).code, "LAST_OWNER");
  } finally {
    for (const row of saved.rows) await fixture.control.migrationPool.query("UPDATE memberships SET active=$1 WHERE user_id=$2 AND tenant_id=$3", [row.active, row.user_id, TENANT_A]);
    await app.close();
  }
});

test("ACC-11 entradas incoerentes, direitos administrativos forjados e origem indevida são recusados", async () => {
  await ownerScenario(async (app, cookie, actor) => {
    const { member } = await createMember(app, cookie);
    for (const payload of [
      { version: 1, overrides: { "team.manage": true } }, { version: 1, overrides: { unknown: true } },
      { version: 1, overrides: { "customers.read": "false" } },
      { version: 1, overrides: { "customers.read": false } },
      { version: 1, overrides: { "customers.update": false } },
      { version: 1, role: "inventado" }, { version: 0, active: false }, { version: "1", active: false },
      { version: 1, actorId: actor.id }, { version: 1, updatedAt: "2000-01-01T00:00:00.000Z", active: false },
      { version: 1, email: "other@example.test" }, { version: 1, password: "Do-not-reset-password!" },
    ]) assertError(await app.instance.inject({ method: "PATCH", url: `${members()}/${member.id}`, headers: authHeaders(cookie), payload }), 400);
    assertError(await app.instance.inject({ method: "PATCH", url: `${members()}/${actor.id}`, headers: authHeaders(cookie), payload: { version: 1, overrides: { "customers.read": false } } }), 400);
    for (const payload of [attempt({ requestId: "invalid" }), attempt({ password: "short" }), attempt({ actorId: actor.id }), attempt({ role: "owner", overrides: { "customers.create": true } })])
      assertError(await app.instance.inject({ method: "POST", url: members(), headers: authHeaders(cookie), payload }), 400);
    for (const origin of [undefined, "https://untrusted.example.test"]) {
      const headers = { cookie, ...(origin ? { origin } : {}) };
      assertError(await app.instance.inject({ method: "PATCH", url: `${members()}/${member.id}`, headers, payload: { version: 1, active: false } }), 403);
      assertError(await app.instance.inject({ method: "POST", url: members(), headers, payload: attempt() }), 403);
    }
    assert.equal((await readMember(app, cookie, member.id)).version, 1);
  });
});

test("ACC-12 auditoria recusada desfaz edição e criação de vínculo; mesma intenção recupera identidade", async () => {
  await ownerScenario(async (app, cookie) => {
    const { member } = await createMember(app, cookie);
    const payload = attempt(); const role = decodeURIComponent(new URL(fixture.config.controlDatabaseUrl).username);
    await fixture.control.migrationPool.query(`REVOKE INSERT ON access_audit_events FROM "${role}"`);
    let orphanId: string;
    try {
      assertError(await app.instance.inject({ method: "PATCH", url: `${members()}/${member.id}`, headers: authHeaders(cookie), payload: { version: 1, active: false } }), 503);
      assert.equal((await readMember(app, cookie, member.id)).version, 1); assert.equal((await readMember(app, cookie, member.id)).active, true);
      assertError(await app.instance.inject({ method: "POST", url: members(), headers: authHeaders(cookie), payload }), 503);
      const identity = await fixture.control.migrationPool.query('SELECT id FROM "user" WHERE email=$1', [payload.email]); assert.equal(identity.rowCount, 1);
      orphanId = identity.rows[0].id;
      assert.equal((await fixture.control.migrationPool.query("SELECT count(*)::int AS count FROM memberships WHERE user_id=$1 AND tenant_id=$2", [orphanId, TENANT_A])).rows[0].count, 0);
    } finally { await fixture.control.migrationPool.query(`GRANT INSERT ON access_audit_events TO "${role}"`); }
    const recovered = await createMember(app, cookie, { ...payload, password: "Changed-only-for-retry!" });
    assert.equal(recovered.member.id, orphanId!); assert.equal((await audits(app, cookie)).filter((event) => event.targetId === orphanId!).length, 1);
    await login(app, { id: orphanId!, email: payload.email, password: payload.password });
  });
});

test("ACC-13 busca literal, estado e datas São Paulo excluem legado desconhecido", async () => {
  await ownerScenario(async (app, cookie) => {
    const tag = `qa-${randomUUID()}`;
    const first = await createMember(app, cookie, attempt({ name: `${tag} A %_ literal` }));
    const second = await createMember(app, cookie, attempt({ name: `${tag} B` }));
    const legacy = await fixture.user("viewer");
    await fixture.control.migrationPool.query('UPDATE "user" SET name=$1 WHERE id=$2', [`${tag} C legado`, legacy.id]);
    await fixture.control.migrationPool.query("UPDATE memberships SET created_at=$1,updated_at=$1 WHERE user_id=$2 AND tenant_id=$3", ["2026-10-25T02:59:59.999Z", first.member.id, TENANT_A]);
    await fixture.control.migrationPool.query("UPDATE memberships SET created_at=$1,updated_at=$1,active=false WHERE user_id=$2 AND tenant_id=$3", ["2026-10-25T03:00:00.000Z", second.member.id, TENANT_A]);
    const query = async (extra: string) => { const response = await app.instance.inject({ method: "GET", url: `${members()}?q=${encodeURIComponent(tag)}&${extra}`, headers: { cookie } }); assert.equal(response.statusCode, 200, response.body); return response.json(); };
    const sorted = await query("sort=created"); assert.deepEqual(sorted.items.map((item: { id: string }) => item.id), [second.member.id, first.member.id, legacy.id]);
    assert.equal(sorted.items[2].createdAt, null);
    const dated = await query("dateField=created&from=2026-10-25&to=2026-10-25"); assert.deepEqual(dated.items.map((item: { id: string }) => item.id), [second.member.id]);
    const inactive = await query("status=inactive"); assert.deepEqual(inactive.items.map((item: { id: string }) => item.id), [second.member.id]);
    const active = await query("status=active&sort=name&limit=1&offset=1"); assert.equal(active.total, 2); assert.equal(active.items[0].id, legacy.id);
    const literal = await app.instance.inject({ method: "GET", url: `${members()}?q=${encodeURIComponent(`${tag} A %_`)}`, headers: { cookie } });
    assert.equal(literal.statusCode, 200); assert.equal(literal.json().total, 1); assert.equal(literal.json().items[0].id, first.member.id);
    for (const extra of ["sort=unknown", "status=unknown", "limit=101", "offset=-1", "dateField=unknown", "dateField=created&from=2026-02-30", "dateField=created&from=2026-10-26&to=2026-10-25", "actorId=forged"]) {
      assertError(await app.instance.inject({ method: "GET", url: `${members()}?${extra}`, headers: { cookie } }), 400);
    }
  });
});

test("ACC-14 migração repetida preserva vínculo e auditoria central continua imutável no runtime", async () => {
  await ownerScenario(async (app, cookie) => {
    const { member } = await createMember(app, cookie);
    const before = await audits(app, cookie);
    await migrateControl(fixture.control.migrationPool);
    assert.deepEqual(await readMember(app, cookie, member.id), member); assert.deepEqual(await audits(app, cookie), before);
    for (const statement of ["UPDATE access_audit_events SET action='forged'", "DELETE FROM access_audit_events", "TRUNCATE access_audit_events"]) {
      await assert.rejects(app.controlPool.query(statement), (error: { code?: string }) => error.code === "42501");
    }
    assert.deepEqual(await audits(app, cookie), before);
  });
});
