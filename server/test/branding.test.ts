import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { Pool } from "pg";
import sharp from "sharp";
import { migrateTenant } from "../src/migrations.ts";
import { assertError, authHeaders, createCustomer, createFixture, login, TENANT_A, TENANT_B, type Fixture, type TestApp, type TestUser } from "./helpers.ts";

// BR-QA: expectativas do documento 20, escritas antes das fontes. Somente imagens genéricas em memória.
let fixture: Fixture;
before(async () => { fixture = await createFixture(); });
after(async () => { await fixture?.close(); });
const base = (tenant = TENANT_A) => `/api/v1/tenants/${tenant}/branding`;
const receipt = (id: string, tenant = TENANT_A) => `/api/v1/tenants/${tenant}/orders/${id}/receipt`;
const dataUrl = (buffer: Buffer, mime = "image/png") => `data:${mime};base64,${buffer.toString("base64")}`;
async function png(color = "#2980b9", width = 24, height = 16) {
  return sharp({ create: { width, height, channels: 4, background: color } }).png().toBuffer();
}
async function scenario(run: (app: TestApp, cookie: string, actor: TestUser) => Promise<void>) {
  const app = await fixture.app();
  try { const actor = await fixture.user(); const { cookie } = await login(app, actor); await run(app, cookie, actor); }
  finally { await app.close(); }
}
async function metadata(app: TestApp, cookie: string, tenant = TENANT_A) {
  const response = await app.instance.inject({ method: "GET", url: base(tenant), headers: { cookie } });
  assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().tenantId, tenant);
  return response.json().branding;
}
async function patch(app: TestApp, cookie: string, body: Record<string, unknown>, tenant = TENANT_A) {
  return app.instance.inject({ method: "PATCH", url: base(tenant), headers: authHeaders(cookie), payload: body });
}
async function save(app: TestApp, cookie: string, fields: Record<string, unknown>) {
  const current = await metadata(app, cookie);
  const response = await patch(app, cookie, { requestId: randomUUID(), version: current.version, ...fields });
  assert.equal(response.statusCode, 200, response.body); return response.json().branding;
}
async function auditCount() {
  return (await fixture.a.migrationPool.query("SELECT count(*)::int AS n FROM audit_events WHERE entity_id=$1", [TENANT_A])).rows[0].n as number;
}
async function asset(app: TestApp, cookie: string, kind: string, version: number, tenant = TENANT_A) {
  return app.instance.inject({ method: "GET", url: `${base(tenant)}/assets/${kind}?version=${version}`, headers: { cookie } });
}
async function command(app: TestApp, cookie: string, type: string, data: Record<string, unknown>) {
  const response = await app.instance.inject({ method: "POST", url: `/api/v1/tenants/${TENANT_A}/operations/commands`, headers: authHeaders(cookie), payload: { requestId: randomUUID(), type, data } });
  assert.equal(response.statusCode, 200, response.body); return response.json().entity;
}

test("BR01 imagens/configuração exigem sessão e vínculo; só gestor altera, origem e revogação são revalidadas", async () => {
  await scenario(async (app, cookie) => {
    assertError(await app.instance.inject({ method: "GET", url: base() }), 401);
    assertError(await app.instance.inject({ method: "GET", url: `${base()}/assets/logo?version=0` }), 401);
    assertError(await app.instance.inject({ method: "GET", url: base(TENANT_B), headers: { cookie } }), 403);
    const employee = await fixture.user("viewer"), session = await login(app, employee);
    await fixture.control.migrationPool.query("UPDATE memberships SET permission_overrides=$1 WHERE user_id=$2", [JSON.stringify({ "customers.read": false }), employee.id]);
    assert.equal((await app.instance.inject({ method: "GET", url: base(), headers: { cookie: session.cookie } })).statusCode, 200);
    assertError(await patch(app, session.cookie, { requestId: randomUUID(), version: 0, backgroundOpacity: 8 }), 403);
    assertError(await app.instance.inject({ method: "PATCH", url: base(), headers: { cookie, origin: "https://untrusted.example.test" }, payload: { requestId: randomUUID(), version: 0, backgroundOpacity: 8 } }), 403);
    await fixture.control.migrationPool.query("UPDATE memberships SET active=false WHERE user_id=$1", [employee.id]);
    assertError(await app.instance.inject({ method: "GET", url: base(), headers: { cookie: session.cookie } }), 403);
    const central = await fixture.user("viewer"), centralSession = await login(app, central);
    await fixture.control.migrationPool.query("DELETE FROM memberships WHERE user_id=$1", [central.id]);
    await fixture.control.migrationPool.query("INSERT INTO platform_administrator(singleton,user_id,active,version,configured_at) VALUES(true,$1,true,1,clock_timestamp())", [central.id]);
    assertError(await app.instance.inject({ method: "GET", url: base(), headers: { cookie: centralSession.cookie } }), 403);
  });
});

test("BR02 empresa sem personalização retorna padrão vazio sem inventar registro ou dados de outra empresa", async () => {
  await scenario(async (app, cookie) => {
    const before = await auditCount();
    const current = await metadata(app, cookie);
    assert.deepEqual(current, { version: 0, backgroundOpacity: 10, logo: null, background: null, updatedAt: null, updatedBy: null });
    assert.deepEqual(await metadata(app, cookie), current); assert.equal(await auditCount(), before);
    assert.equal((await fixture.a.migrationPool.query("SELECT count(*)::int AS n FROM company_branding")).rows[0].n, 0);
    assert.equal((await fixture.a.migrationPool.query("SELECT count(*)::int AS n FROM company_branding_requests")).rows[0].n, 0);
  });
});

test("BR03 salva logo e fundo uma vez; normaliza imagem, limita dimensões e persiste entre sessões", async () => {
  await scenario(async (app, cookie, actor) => {
    const logo = await sharp({ create: { width: 1400, height: 700, channels: 4, background: "#218c74" } }).png().withMetadata({ orientation: 1 }).toBuffer();
    // PNG fotográfico genérico >64KiB verifica que somente esta rota aceita o corpo ampliado.
    const background = await sharp(randomBytes(500 * 400 * 3), { raw: { width: 500, height: 400, channels: 3 } }).png().toBuffer();
    assert.ok(background.length > 65536 && background.length < 1024 * 1024);
    const before = await metadata(app, cookie), audits = await auditCount();
    const response = await patch(app, cookie, { requestId: randomUUID(), version: before.version, logo: dataUrl(logo), background: dataUrl(background), backgroundOpacity: 12 });
    assert.equal(response.statusCode, 200, response.body); const current = response.json().branding;
    assert.equal(current.version, before.version + 1); assert.equal(current.backgroundOpacity, 12); assert.equal(current.updatedBy, actor.id); assert.match(current.updatedAt, /Z$/);
    assert.deepEqual(Object.keys(current.logo).sort(), ["height", "mimeType", "width"]); assert.equal(current.logo.mimeType, "image/webp");
    assert.ok(current.logo.width <= 600 && current.logo.height <= 300 && current.logo.width > 0 && current.logo.height > 0);
    assert.ok(current.background.width <= 1200 && current.background.height <= 1600);
    assert.doesNotMatch(response.body, /data:image|base64|bytea|filename|buffer/i);
    const download = await asset(app, cookie, "logo", current.version);
    assert.equal(download.statusCode, 200); const info = await sharp(download.rawPayload).metadata();
    assert.equal(info.format, "webp"); assert.equal(info.exif, undefined); assert.equal(info.orientation, undefined);
    assert.ok(download.rawPayload.length <= 512 * 1024); assert.equal(await auditCount(), audits + 1);
    const secondApp = await fixture.app();
    try { const session = await login(secondApp, actor); assert.deepEqual(await metadata(secondApp, session.cookie), current); }
    finally { await secondApp.close(); }
  });
});

test("BR04 tipos, conteúdo, limites e campos forjados são recusados sem salvar metade da personalização", async () => {
  await scenario(async (app, cookie) => {
    const current = await metadata(app, cookie), audits = await auditCount();
    const oldAsset = await asset(app, cookie, "background", current.version);
    const valid = dataUrl(await png("#b33939"));
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const excessivePixels = await png("#ffffff", 4000, 3001);
    const frames = Buffer.alloc(20 * 40 * 4);
    for (let pixel = 0; pixel < 800; pixel++) { frames[pixel * 4] = pixel < 400 ? 255 : 0; frames[pixel * 4 + 2] = pixel < 400 ? 0 : 255; frames[pixel * 4 + 3] = 255; }
    const animated = await sharp(frames, { raw: { width: 20, height: 40, channels: 4, pageHeight: 20 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
    assert.equal((await sharp(animated, { animated: true }).metadata()).pages, 2);
    const invalid: Record<string, unknown>[] = [
      { logo: "https://example.test/remote.png" }, { logo: "data:image/png;base64,AA==" }, { logo: "data:image/png;base64,not base64" },
      { logo: dataUrl(svg, "image/svg+xml") }, { logo: dataUrl(svg) },
      { logo: valid, background: "not-an-image" }, { background: dataUrl(excessivePixels) },
      { logo: dataUrl(animated, "image/webp") },
      { logo: dataUrl(Buffer.alloc(1024 * 1024 + 1)) }, { backgroundOpacity: -1 }, { backgroundOpacity: 21 }, { backgroundOpacity: 2.5 },
      { logo: valid, actorId: "forged" }, { logo: valid, updatedAt: "2000-01-01T00:00:00Z" }, { logo: valid, filename: "private-name.png" },
    ];
    for (const fields of invalid) {
      const response = await patch(app, cookie, { requestId: randomUUID(), version: current.version, ...fields });
      assert.ok([400, 413].includes(response.statusCode), `controlled input/size rejection required, got ${response.statusCode}`);
      assertError(response, response.statusCode);
      assert.deepEqual(await metadata(app, cookie), current); assert.equal(await auditCount(), audits);
    }
    assert.deepEqual((await asset(app, cookie, "background", current.version)).rawPayload, oldAsset.rawPayload);
    const tooLarge = await patch(app, cookie, { requestId: randomUUID(), version: current.version, logo: "x".repeat(3 * 1024 * 1024) });
    assertError(tooLarge, 413); assert.deepEqual(await metadata(app, cookie), current);
  });
});

test("BR05 versão e tentativa estável impedem duplicação; no-op não inventa alteração e outro autor não reaproveita intento", async () => {
  await scenario(async (app, cookie) => {
    const current = await metadata(app, cookie), audits = await auditCount();
    const data = { requestId: randomUUID(), version: current.version, backgroundOpacity: (current.backgroundOpacity + 1) % 21 };
    const first = await patch(app, cookie, data); assert.equal(first.statusCode, 200, first.body);
    const saved = first.json().branding;
    assert.deepEqual((await patch(app, cookie, data)).json().branding, saved); assert.equal(await auditCount(), audits + 1);
    assertError(await patch(app, cookie, { ...data, backgroundOpacity: (data.backgroundOpacity + 1) % 21 }), 409);
    assertError(await patch(app, cookie, { ...data, requestId: randomUUID() }), 409);
    const otherActor = await fixture.user(), otherSession = await login(app, otherActor);
    assertError(await patch(app, otherSession.cookie, data), 409);
    const noop = await patch(app, cookie, { requestId: randomUUID(), version: saved.version, backgroundOpacity: saved.backgroundOpacity });
    assert.equal(noop.statusCode, 200, noop.body); assert.deepEqual(noop.json().branding, saved); assert.equal(await auditCount(), audits + 1);
    await fixture.control.migrationPool.query("UPDATE memberships SET active=false WHERE user_id=$1", [otherActor.id]);
    assertError(await patch(app, otherSession.cookie, data), 403);
  });
});

test("BR06 duas alterações da mesma versão não sobrescrevem silenciosamente o trabalho uma da outra", async () => {
  await scenario(async (app, cookie) => {
    const current = await metadata(app, cookie), audits = await auditCount();
    const results = await Promise.all(["#674ea7", "#e69138"].map(async (color) => patch(app, cookie, { requestId: randomUUID(), version: current.version, logo: dataUrl(await png(color)) })));
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
    assert.equal((await metadata(app, cookie)).version, current.version + 1); assert.equal(await auditCount(), audits + 1);
  });
});

test("BR07 assets são privados e versionados; remover logo preserva fundo e outra empresa", async () => {
  await scenario(async (app, cookie) => {
    const current = await metadata(app, cookie), previousBackground = await asset(app, cookie, "background", current.version);
    assert.equal(previousBackground.statusCode, 200); assert.match(String(previousBackground.headers["content-type"]), /^image\/webp/);
    assert.equal(previousBackground.headers["x-content-type-options"], "nosniff"); assert.equal(previousBackground.headers["cache-control"], "no-store");
    const saved = await save(app, cookie, { logo: null }); assert.equal(saved.logo, null); assert.deepEqual(saved.background, current.background);
    assertError(await asset(app, cookie, "logo", saved.version), 404); assertError(await asset(app, cookie, "background", current.version), 409);
    assertError(await asset(app, cookie, "wrong", saved.version), 400);
    assert.deepEqual((await asset(app, cookie, "background", saved.version)).rawPayload, previousBackground.rawPayload);
    assertError(await asset(app, cookie, "background", saved.version, TENANT_B), 403);
    const both = await fixture.user("owner", true), session = await login(app, both);
    assert.equal((await metadata(app, session.cookie, TENANT_B)).version, 0); assertError(await asset(app, session.cookie, "background", 0, TENANT_B), 404);
  });
});

test("BR08 falha de auditoria desfaz imagens/versão e a mesma tentativa recupera sem blobs nos eventos/logs", async () => {
  await scenario(async (app, cookie) => {
    const current = await metadata(app, cookie), audits = await auditCount();
    const image = dataUrl(await png("#cf6a87")), body = { requestId: randomUUID(), version: current.version, logo: image, backgroundOpacity: (current.backgroundOpacity + 1) % 21 };
    const runtimeRole = decodeURIComponent(new URL(fixture.config.tenantDatabaseUrls.a).username);
    await fixture.a.migrationPool.query(`REVOKE INSERT ON audit_events FROM "${runtimeRole}"`);
    try { assertError(await patch(app, cookie, body), 503); assert.deepEqual(await metadata(app, cookie), current); assert.equal(await auditCount(), audits); }
    finally { await fixture.a.migrationPool.query(`GRANT INSERT ON audit_events TO "${runtimeRole}"`); }
    const response = await patch(app, cookie, body); assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().branding.version, current.version + 1);
    assert.equal(await auditCount(), audits + 1);
    const events = await fixture.a.migrationPool.query("SELECT field_names,before_values,after_values FROM audit_events WHERE entity_id=$1", [TENANT_A]);
    assert.doesNotMatch(JSON.stringify(events.rows), /data:image|base64|buffer|bytea/i);
    assert.ok(!app.logs.join("\n").includes(image)); assert.ok(!app.logs.join("\n").includes(image.split(",")[1]));
  });
});

test("BR09 comprovante contém só a OS autorizada e marca atual, sem alterar OS/estoque/financeiro", async () => {
  await scenario(async (app, cookie) => {
    const customer = await createCustomer(app, cookie, TENANT_A, { name: "Consumidor fictício QA", phone: "11900000000", email: "private-qa@example.test" });
    const technician = await command(app, cookie, "technician.create", { name: "Técnico fictício QA" });
    const order = await command(app, cookie, "order.create", { customerId: customer.id, technicianId: technician.id, equipment: "Equipamento QA", issue: "Verificar tela", due: "2100-01-31", laborCents: 5000 });
    const counters = async () => (await fixture.a.migrationPool.query("SELECT (SELECT count(*) FROM audit_events)::int AS audits,(SELECT count(*) FROM finance_payments)::int AS payments,(SELECT count(*) FROM stock_movements)::int AS stock")).rows[0];
    const before = await counters();
    const response = await app.instance.inject({ method: "GET", url: receipt(order.id), headers: { cookie } });
    assert.equal(response.statusCode, 200, response.body); const result = response.json();
    assert.equal(result.tenantId, TENANT_A); assert.equal(result.companyName, "Loja A de teste"); assert.match(result.generatedAt, /Z$/);
    assert.deepEqual(Object.keys(result.order).sort(), ["id", "number", "version", "customerName", "customerPhone", "equipment", "issue", "diagnosis", "technicianName", "due", "laborCents", "approved", "tested", "stage", "createdAt", "updatedAt"].sort());
    assert.equal(result.order.id, order.id); assert.equal(result.order.customerName, customer.name); assert.equal(result.order.customerPhone, customer.phone); assert.equal(result.order.laborCents, 5000);
    assert.doesNotMatch(response.body, /private-qa@example|password|senha|costCents|paidCents|receivedCents|data:image/i);
    assert.deepEqual(result.branding, await metadata(app, cookie)); assert.deepEqual(await counters(), before);
    assertError(await app.instance.inject({ method: "GET", url: receipt(order.id) }), 401);
    const both = await fixture.user("owner", true), session = await login(app, both);
    assertError(await app.instance.inject({ method: "GET", url: receipt(order.id, TENANT_B), headers: { cookie: session.cookie } }), 404);
    const viewer = await fixture.user("viewer"), viewerSession = await login(app, viewer);
    assertError(await app.instance.inject({ method: "GET", url: receipt(order.id), headers: { cookie: viewerSession.cookie } }), 403);
  });
});

test("BR10 migração repetida conserva configuração; bytes ficam no banco e tentativas são imutáveis", async () => {
  await scenario(async (app, cookie) => {
    const current = await metadata(app, cookie);
    const bytes = await asset(app, cookie, "logo", current.version); assert.equal(bytes.statusCode, 200);
    await migrateTenant(fixture.a.migrationPool); await migrateTenant(fixture.a.migrationPool);
    assert.deepEqual(await metadata(app, cookie), current); assert.deepEqual((await asset(app, cookie, "logo", current.version)).rawPayload, bytes.rawPayload);
    assert.equal((await fixture.a.migrationPool.query("SELECT count(*)::int AS n FROM schema_migrations WHERE version='tenant_005'")).rows[0].n, 1);
    assert.equal((await fixture.a.migrationPool.query("SELECT count(*)::int AS n FROM company_branding")).rows[0].n, 1);
    const bytea = await fixture.a.migrationPool.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND table_name='company_branding' AND data_type='bytea'"); assert.ok(bytea.rows[0].n >= 2);
    const runtime = new Pool({ connectionString: fixture.config.tenantDatabaseUrls.a, max: 1 });
    try { await assert.rejects(runtime.query("UPDATE company_branding_requests SET actor_id=actor_id"), (error: any) => error.code === "42501"); }
    finally { await runtime.end(); }
    assert.ok(!app.logs.join("\n").includes("data:image"));
  });
});

// Complementar solicitado na revisão; não foi executado no RED inicial BR01–10.
test("BR11 primeira gravação concorrente em empresa vazia não vence duas vezes", async () => {
  await scenario(async (app) => {
    const actor = await fixture.user("owner", true), session = await login(app, actor);
    assert.equal((await metadata(app, session.cookie, TENANT_B)).version, 0);
    const results = await Promise.all([6, 14].map((backgroundOpacity) => patch(app, session.cookie, { requestId: randomUUID(), version: 0, backgroundOpacity }, TENANT_B)));
    assert.deepEqual(results.map((result) => result.statusCode).sort(), [200, 409]);
    const current = await metadata(app, session.cookie, TENANT_B); assert.equal(current.version, 1); assert.ok([6, 14].includes(current.backgroundOpacity));
    assert.equal((await fixture.b.migrationPool.query("SELECT count(*)::int AS n FROM company_branding")).rows[0].n, 1);
    assert.equal((await fixture.b.migrationPool.query("SELECT count(*)::int AS n FROM audit_events WHERE entity_id=$1", [TENANT_B])).rows[0].n, 1);
  });
});
