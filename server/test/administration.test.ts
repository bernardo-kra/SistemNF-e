import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import { Pool } from "pg";
import { createAuth } from "../src/auth.ts";
import { migrateTenant } from "../src/migrations.ts";
import { createFixture, login, authHeaders, assertError, PASSWORD, TENANT_A, type Fixture, type TestApp, type TestUser } from "./helpers.ts";

// ADM: requisitos aprovados de cadastro selecionado; definidos antes da implementação.
let fixture: Fixture, administrator: TestUser | undefined;
before(async () => { fixture = await createFixture(); });
after(async () => { await fixture?.close(); });
const endpoint = "/api/v1/administration/companies";
const input = (name = "Empresa selecionada QA") => ({ requestId: randomUUID(), name, owner: { name: "Gestora selecionada QA", email: `adm-${randomUUID()}@example.test`, password: PASSWORD } });
async function administratorUser() {
  if (!administrator) {
    const auth = createAuth(fixture.control.migrationPool, fixture.config, true);
    const email = `central-${randomUUID()}@example.test`;
    const account = await auth.api.signUpEmail({ body: { name: "Admin central QA", email, password: PASSWORD } });
    administrator = { id: account.user.id, email, password: PASSWORD };
    const { configurePlatformAdministrator } = await import("../src/administration.js");
    await configurePlatformAdministrator(fixture.control.migrationPool, administrator.id, true);
  }
  return administrator;
}
async function vacancy(prepared = true) {
  const key = `slot_${randomUUID().replaceAll("-", "").slice(0,12)}`;
  const database = await fixture.cluster.createDatabase(key);
  await migrateTenant(database.migrationPool);
  if (prepared) {
    const { prepareCompanySlot } = await import("../src/administration.js");
    await prepareCompanySlot(database.migrationPool);
  }
  await database.grantRuntime();
  return { key, database, urls: { ...fixture.config.tenantDatabaseUrls, [key]: database.runtimeUrl } };
}
async function adminApp(urls: typeof fixture.config.tenantDatabaseUrls & Record<string,string> = fixture.config.tenantDatabaseUrls) {
  const actor = await administratorUser(), app = await fixture.app({ tenantDatabaseUrls: urls });
  const { cookie } = await login(app, actor); return { app, cookie, actor };
}
async function post(app: TestApp, cookie: string, payload: ReturnType<typeof input>) {
  return app.instance.inject({ method: "POST", url: endpoint, headers: authHeaders(cookie), payload });
}

test("ADM01 cadastro de empresas exige sessão e administrador central; cadastro público continua fechado", async () => {
  const app = await fixture.app();
  try {
    assertError(await app.instance.inject({ method: "GET", url: endpoint }), 401);
    assertError(await app.instance.inject({ method: "POST", url: endpoint, headers: authHeaders(""), payload: input() }), 401);
    for (const role of ["owner", "operator", "viewer"]) {
      const actor = await fixture.user(role), { cookie } = await login(app, actor);
      assertError(await app.instance.inject({ method: "GET", url: endpoint, headers: { cookie } }), 403);
      assertError(await post(app, cookie, input()), 403);
    }
    const signup = await app.instance.inject({ method: "POST", url: "/api/auth/sign-up/email", headers: authHeaders(""), payload: { name: "Visitante", email: "visitor@example.test", password: PASSWORD } });
    assert.ok([403,404].includes(signup.statusCode));
    assert.equal((await fixture.control.migrationPool.query('SELECT count(*)::int n FROM "user" WHERE email=$1', ["visitor@example.test"])).rows[0].n, 0);
  } finally { await app.close(); }
});

test("ADM02 concessão singleton explícita não deriva de gestor; runtime não pode promovê-la", async () => {
  const { app, cookie, actor } = await adminApp();
  try {
    const me = await app.instance.inject({ method: "GET", url: "/api/v1/me", headers: { cookie } });
    assert.equal(me.json().platformAdmin, true); assert.deepEqual(me.json().tenants, []);
    const owner = await fixture.user(); const own = await login(app, owner);
    assert.equal((await app.instance.inject({ method: "GET", url: "/api/v1/me", headers: { cookie: own.cookie } })).json().platformAdmin, false);
    const { configurePlatformAdministrator } = await import("../src/administration.js");
    await assert.rejects(configurePlatformAdministrator(fixture.control.migrationPool, owner.id, true));
    const runtime = new Pool({ connectionString: fixture.control.runtimeUrl });
    try {
      await assert.rejects(runtime.query("UPDATE platform_administrator SET user_id=$1", [owner.id]), (e: any) => e.code === "42501");
      await assert.rejects(runtime.query("DELETE FROM platform_administrator"), (e: any) => e.code === "42501");
    } finally { await runtime.end(); }
    assert.equal((await fixture.control.migrationPool.query("SELECT user_id FROM platform_administrator")).rows[0].user_id, actor.id);
  } finally { await app.close(); }
});

test("ADM03 sem vaga ou sem marker não cria empresa nem identidade; indisponibilidade é503", async () => {
  const empty = await vacancy(false), { app, cookie } = await adminApp(empty.urls), payload = input();
  try {
    const list = await app.instance.inject({ method: "GET", url: endpoint, headers: { cookie } });
    assert.equal(list.statusCode, 200); assert.equal(list.json().capacity.available, 0);
    const denied = await post(app, cookie, payload); assertError(denied, 409); assert.equal(denied.json().error.code, "CAPACITY_UNAVAILABLE");
    assert.equal((await fixture.control.migrationPool.query('SELECT count(*)::int n FROM "user" WHERE email=$1', [payload.owner.email])).rows[0].n, 0);
  } finally { await app.close(); }
  const dead = await adminApp({ ...fixture.config.tenantDatabaseUrls, offline: "postgresql://invalid:invalid@127.0.0.1:1/offline" });
  try { assertError(await post(dead.app, dead.cookie, input()), 503); } finally { await dead.app.close(); }
});

test("ADM04 uma confirmação cadastra empresa e gestor; gestor cria equipe e admin não ganha acesso operacional", async () => {
  const slot = await vacancy(), { app, cookie, actor } = await adminApp(slot.urls), payload = input();
  try {
    const response = await post(app, cookie, payload); assert.equal(response.statusCode, 201, response.body);
    const company = response.json().company; assert.equal(company.name, payload.name); assert.equal(company.status, "active");
    assert.equal(company.owner.email, payload.owner.email);
    const manager = await login(app, { id: company.owner.id, email: payload.owner.email, password: payload.owner.password });
    const me = (await app.instance.inject({ method: "GET", url: "/api/v1/me", headers: { cookie: manager.cookie } })).json();
    assert.equal(me.platformAdmin, false); assert.deepEqual(me.tenants.map((t: any) => t.id), [company.id]);
    const employee = await app.instance.inject({ method: "POST", url: `/api/v1/tenants/${company.id}/members`, headers: authHeaders(manager.cookie), payload: { requestId: randomUUID(), name: "Atendente QA", email: `employee-${randomUUID()}@example.test`, password: PASSWORD, role: "operator" } });
    assert.equal(employee.statusCode, 201, employee.body);
    assertError(await app.instance.inject({ method: "GET", url: `/api/v1/tenants/${TENANT_A}/members`, headers: { cookie: manager.cookie } }), 403);
    assertError(await app.instance.inject({ method: "GET", url: `/api/v1/tenants/${company.id}/operations/products`, headers: { cookie } }), 403);
    assert.equal((await fixture.control.migrationPool.query("SELECT count(*)::int n FROM memberships WHERE tenant_id=$1 AND user_id=$2", [company.id, actor.id])).rows[0].n, 0);
    assert.equal((await fixture.control.migrationPool.query("SELECT count(*)::int n FROM access_audit_events WHERE tenant_id=$1 AND actor_id=$2", [company.id, actor.id])).rows[0].n, 1);
    assert.doesNotMatch(JSON.stringify(response.json()) + app.logs.join(""), new RegExp(payload.owner.password));
    assert.doesNotMatch(JSON.stringify(response.json()), /database_key|provisioning|postgresql|fingerprint|password/);
  } finally { await app.close(); }
});

test("ADM05 repetição e mudança de conteúdo não duplicam empresa nem redefinem senha", async () => {
  const slot = await vacancy(), { app, cookie } = await adminApp(slot.urls), payload = input();
  try {
    const first = await post(app, cookie, payload); assert.equal(first.statusCode, 201, first.body);
    const again = await post(app, cookie, { ...payload, owner: { ...payload.owner, password: "Outra-senha-que-nao-substitui!" } });
    assert.equal(again.statusCode, 201); assert.equal(again.json().company.id, first.json().company.id);
    assertError(await post(app, cookie, { ...payload, name: "Outra empresa" }), 409);
    assert.equal((await fixture.control.migrationPool.query("SELECT count(*)::int n FROM company_onboarding WHERE request_id=$1", [payload.requestId])).rows[0].n, 1);
    await login(app, { id: first.json().company.owner.id, email: payload.owner.email, password: PASSWORD });
  } finally { await app.close(); }
});

test("ADM06 alias físico e banco ocupado não podem ser usados como nova vaga", async () => {
  const slot = await vacancy(), urls = { ...slot.urls, alias: slot.database.runtimeUrl.replace("127.0.0.1", "localhost") }, { app, cookie } = await adminApp(urls);
  try {
    assert.equal((await app.instance.inject({ method: "GET", url: endpoint, headers: { cookie } })).json().capacity.available, 1);
    const first = await post(app, cookie, input()); assert.equal(first.statusCode, 201, first.body);
    assertError(await post(app, cookie, input()), 409);
  } finally { await app.close(); }
  const dirty = await vacancy();
  await dirty.database.migrationPool.query("INSERT INTO customers(id,name,email,phone,type,active,version,created_at,updated_at) VALUES($1,'Legado','','','Empresa',true,1,clock_timestamp(),clock_timestamp())", [randomUUID()]);
  const blocked = await adminApp(dirty.urls);
  try { assertError(await post(blocked.app, blocked.cookie, input()), 409); } finally { await blocked.app.close(); }
});

test("ADM07 duas instâncias disputam uma vaga sem criar duas empresas ou identidades", async () => {
  const slot = await vacancy(), first = await adminApp(slot.urls), second = await adminApp(slot.urls), one = input(), two = input();
  try {
    const replies = await Promise.all([post(first.app, first.cookie, one), post(second.app, second.cookie, two)]);
    assert.deepEqual(replies.map(r => r.statusCode).sort(), [201,409]);
    assert.equal((await fixture.control.migrationPool.query('SELECT count(*)::int n FROM "user" WHERE email=ANY($1::text[])', [[one.owner.email,two.owner.email]])).rows[0].n, 1);
    assert.equal((await slot.database.migrationPool.query("SELECT count(*)::int n FROM tenant_admission WHERE tenant_id IS NOT NULL")).rows[0].n, 1);
  } finally { await first.app.close(); await second.app.close(); }
});

for (const failure of ["audit", "activation"] as const) test(`ADM08-${failure} falha preserva empresa inativa e retry recupera sem resetar conta`, async () => {
  const slot = await vacancy(), { app, cookie } = await adminApp(slot.urls), payload = input(`Empresa falha ${failure}`);
  const table = failure === "audit" ? "access_audit_events" : "tenants", event = failure === "audit" ? "INSERT" : "UPDATE";
  await fixture.control.migrationPool.query(`CREATE FUNCTION fail_adm_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated'; END; $$; CREATE TRIGGER fail_adm_test BEFORE ${event} ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_adm_test()`);
  try {
    assertError(await post(app, cookie, payload), 503);
    const pending = (await fixture.control.migrationPool.query("SELECT t.id,t.active,c.request_id FROM tenants t JOIN company_onboarding c ON c.tenant_id=t.id WHERE c.request_id=$1", [payload.requestId])).rows[0];
    assert.equal(pending.active, false);
    const claims = (await slot.database.migrationPool.query("SELECT tenant_id FROM tenant_admission")).rows; assert.equal(claims[0].tenant_id, pending.id);
    const user = (await fixture.control.migrationPool.query('SELECT id FROM "user" WHERE email=$1', [payload.owner.email])).rows[0]; assert.ok(user);
    const manager = await login(app, { id:user.id, email:payload.owner.email, password:PASSWORD });
    assert.deepEqual((await app.instance.inject({ method:"GET", url:"/api/v1/me", headers:{cookie:manager.cookie} })).json().tenants, []);
    const listed = (await app.instance.inject({ method:"GET", url:endpoint, headers:{cookie} })).json().items.find((r:any)=>r.id===pending.id);
    assert.equal(listed.status,"pending"); assert.equal(listed.requestId,payload.requestId);
    await fixture.control.migrationPool.query(`DROP TRIGGER fail_adm_test ON ${table}; DROP FUNCTION fail_adm_test()`);
    const resumed = await post(app,cookie,{...payload,owner:{...payload.owner,password:"Senha-repetida-nao-redefine!"}}); assert.equal(resumed.statusCode,201,resumed.body);
    assert.equal(resumed.json().company.owner.id,user.id);
    await login(app,{id:user.id,email:payload.owner.email,password:PASSWORD});
  } finally {
    await fixture.control.migrationPool.query(`DROP TRIGGER IF EXISTS fail_adm_test ON ${table}; DROP FUNCTION IF EXISTS fail_adm_test()`); await app.close();
  }
});

test("ADM09 admin revogado perde acesso sem logout; flags forjadas e e-mail existente não elevam conta", async () => {
  const slot=await vacancy(), {app,cookie,actor}=await adminApp(slot.urls), existing=await fixture.user("viewer");
  try {
    assertError(await post(app,cookie,{...input(),owner:{name:"Não adotar",email:existing.email,password:PASSWORD}}),409);
    assertError(await post(app,cookie,{...input(),platformAdmin:true} as any),400);
    const {configurePlatformAdministrator}=await import("../src/administration.js");
    await configurePlatformAdministrator(fixture.control.migrationPool,actor.id,false);
    try { assertError(await app.instance.inject({method:"GET",url:endpoint,headers:{cookie}}),403); assertError(await post(app,cookie,input()),403); }
    finally { await configurePlatformAdministrator(fixture.control.migrationPool,actor.id,true); }
  } finally { await app.close(); }
});

test("ADM-R1 mesmo UUID concorrente recupera resultado mesmo depois da primeira ativação", async () => {
  const slot=await vacancy(),{app,actor}=await adminApp(slot.urls),payload=input();
  const {createAdministrationService}=await import("../src/administration.js"),{createAccountsService}=await import("../src/accounts.js");
  const target=new Pool({connectionString:slot.database.runtimeUrl,max:2});
  const accounts=createAccountsService(app.controlPool,{...fixture.config,tenantDatabaseUrls:slot.urls});
  let secondReached!:()=>void,releaseSecond!:()=>void;
  const reached=new Promise<void>(resolve=>{secondReached=resolve;}),gate=new Promise<void>(resolve=>{releaseSecond=resolve;});
  const firstService=createAdministrationService(app.controlPool,{...fixture.config,tenantDatabaseUrls:slot.urls},()=>target,{...accounts,createFirstOwner:async(...args:Parameters<typeof accounts.createFirstOwner>)=>{await reached;return accounts.createFirstOwner(...args);}});
  const secondService=createAdministrationService(app.controlPool,{...fixture.config,tenantDatabaseUrls:slot.urls},()=>target,{...accounts,createFirstOwner:async(...args:Parameters<typeof accounts.createFirstOwner>)=>{secondReached();await gate;return accounts.createFirstOwner(...args);}});
  let second:Promise<Awaited<ReturnType<typeof secondService.create>>>|undefined;
  try {
    const first=firstService.create(actor.id,payload);second=secondService.create(actor.id,payload);
    const result=await first;releaseSecond();
    assert.equal((await second).company.id,result.company.id);
  } finally {releaseSecond();await second?.catch(()=>{});await target.end();await app.close();}
});

test("ADM-R2 mesmo e-mail concorrente reserva só uma vaga antes da criação da identidade", async () => {
  const one=await vacancy(),two=await vacancy(),urls={...one.urls,[two.key]:two.database.runtimeUrl};
  const {app,actor}=await adminApp(urls),{createAdministrationService}=await import("../src/administration.js"),{createAccountsService}=await import("../src/accounts.js");
  const targets=new Map<string,Pool>();const pool=(key:string)=>{let target=targets.get(key);if(!target){target=new Pool({connectionString:urls[key as keyof typeof urls],max:2});targets.set(key,target);}return target;};
  const accounts=createAccountsService(app.controlPool,{...fixture.config,tenantDatabaseUrls:urls});
  let arrived!:()=>void,release!:()=>void;const reached=new Promise<void>(resolve=>{arrived=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  const service=createAdministrationService(app.controlPool,{...fixture.config,tenantDatabaseUrls:urls},pool,{...accounts,createFirstOwner:async(...args:Parameters<typeof accounts.createFirstOwner>)=>{arrived();await gate;return accounts.createFirstOwner(...args);}});
  const payload=input(),other={...payload,requestId:randomUUID(),name:"Outra empresa com mesmo e-mail"};let first:Promise<unknown>|undefined;
  try {
    first=service.create(actor.id,payload);await reached;
    const second=await Promise.race([service.create(actor.id,other).then(()=>"created",(e:unknown)=>(e as {statusCode?:number}).statusCode),new Promise<string>(resolve=>setTimeout(()=>resolve("second-consumed-slot"),1000))]);
    release();await first;
    assert.equal(second,409,"duplicate email must be refused before entering account creation");
    const rows=await fixture.control.migrationPool.query("SELECT count(*)::int n FROM company_onboarding WHERE owner_email=$1",[payload.owner.email]);assert.equal(rows.rows[0].n,1);
  } finally {release();await first?.catch(()=>{});await Promise.all([...targets.values()].map(pool=>pool.end()));await app.close();}
});

test("ADM-R3 gestor ativo retorna ID, nome e e-mail da mesma identidade", async () => {
  const slot=await vacancy(),{app,cookie}=await adminApp(slot.urls),payload=input();
  try {
    const response=await post(app,cookie,payload);assert.equal(response.statusCode,201);const company=response.json().company;
    const next=await fixture.user();
    await fixture.control.migrationPool.query("INSERT INTO memberships(user_id,tenant_id,role,active) VALUES($1,$2,'owner',true)",[next.id,company.id]);
    await fixture.control.migrationPool.query("UPDATE memberships SET active=false WHERE user_id=$1 AND tenant_id=$2",[company.owner.id,company.id]);
    const listed=(await app.instance.inject({method:"GET",url:endpoint,headers:{cookie}})).json().items.find((row:any)=>row.id===company.id);
    assert.equal(listed.owner.id,next.id);assert.equal(listed.owner.email,next.email);assert.equal(listed.owner.name,"Pessoa de teste");
  } finally {await app.close();}
});

test("ADM-R4 tentativa anterior de funcionário não ocupa e-mail já reservado para gestor", async () => {
  const slot=await vacancy(),{app,actor}=await adminApp(slot.urls),manager=await fixture.user(),payload=input();
  const {createAccountsService}=await import("../src/accounts.js"),{createAdministrationService}=await import("../src/administration.js");
  const config={...fixture.config,tenantDatabaseUrls:slot.urls},accounts=createAccountsService(app.controlPool,config);
  const context={tenantId:TENANT_A,actorId:manager.id},employee={requestId:randomUUID(),...payload.owner,role:"operator"};
  await fixture.control.migrationPool.query(`CREATE FUNCTION fail_identity_adm() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated'; END; $$; CREATE TRIGGER fail_identity_adm BEFORE INSERT ON "user" FOR EACH ROW EXECUTE FUNCTION fail_identity_adm()`);
  try {await assert.rejects(accounts.create(context,employee),(error:any)=>error.statusCode===503);}
  finally {await fixture.control.migrationPool.query('DROP TRIGGER fail_identity_adm ON "user"; DROP FUNCTION fail_identity_adm()');}
  let reached!:()=>void,release!:()=>void;const arrived=new Promise<void>(resolve=>{reached=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  const target=new Pool({connectionString:slot.database.runtimeUrl,max:2});
  const service=createAdministrationService(app.controlPool,config,()=>target,{...accounts,createFirstOwner:async(...args:Parameters<typeof accounts.createFirstOwner>)=>{reached();await gate;return accounts.createFirstOwner(...args);}});
  const registration=service.create(actor.id,payload);registration.catch(()=>{});
  try {await arrived;await assert.rejects(accounts.create(context,employee),(error:any)=>error.statusCode===409);release();assert.equal((await registration).company.status,"active");}
  finally {release();await registration.catch(()=>{});await target.end();await app.close();}
});

test("ADM-R5 conhecer UUID do cadastro central não autoriza ocupar sua reserva de e-mail", async () => {
  const slot=await vacancy(),{app,actor}=await adminApp(slot.urls),manager=await fixture.user(),payload=input();
  const {createAccountsService}=await import("../src/accounts.js"),{createAdministrationService}=await import("../src/administration.js");
  const config={...fixture.config,tenantDatabaseUrls:slot.urls},accounts=createAccountsService(app.controlPool,config);
  let reached!:()=>void,release!:()=>void;const arrived=new Promise<void>(resolve=>{reached=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  const target=new Pool({connectionString:slot.database.runtimeUrl,max:2});
  const service=createAdministrationService(app.controlPool,config,()=>target,{...accounts,createFirstOwner:async(...args:Parameters<typeof accounts.createFirstOwner>)=>{reached();await gate;return accounts.createFirstOwner(...args);}});
  const registration=service.create(actor.id,payload);registration.catch(()=>{});
  try {
    await arrived;
    await assert.rejects(accounts.create({tenantId:TENANT_A,actorId:manager.id},{requestId:payload.requestId,...payload.owner,role:"operator"}),(error:any)=>error.statusCode===409);
    release();assert.equal((await registration).company.status,"active");
  } finally {release();await registration.catch(()=>{});await target.end();await app.close();}
});
