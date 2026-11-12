import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { createFixture, login, createCustomer, authHeaders, assertError, TENANT_A, TENANT_B, type Fixture, type TestApp } from "./helpers.ts";

let fixture: Fixture;
before(async () => {
  fixture = await createFixture();
  for (const [db, id] of [[fixture.a,TENANT_A],[fixture.b,TENANT_B]] as const)
    await db.migrationPool.query("INSERT INTO tenant_admission(singleton,slot_id,tenant_id,claimed_at) VALUES(true,$1,$2,clock_timestamp())",[randomUUID(),id]);
});
after(async () => { await fixture?.close(); });
const base = (tenant=TENANT_A) => `/api/v1/tenants/${tenant}/fiscal/simulations`;
async function get(app:TestApp,cookie:string,path:string,tenant=TENANT_A){return app.instance.inject({method:"GET",url:base(tenant)+path,headers:{cookie}});}
async function post(app:TestApp,cookie:string,body:Record<string,unknown>,path="",tenant=TENANT_A){return app.instance.inject({method:"POST",url:base(tenant)+path,headers:authHeaders(cookie),payload:body});}
async function command(app:TestApp,cookie:string,type:string,data:unknown){const res=await app.instance.inject({method:"POST",url:`/api/v1/tenants/${TENANT_A}/operations/commands`,headers:authHeaders(cookie),payload:{requestId:randomUUID(),type,data}});assert.equal(res.statusCode,200,res.body);return res.json().entity;}
async function scenario(run:(app:TestApp,cookie:string,order:any,actor:any)=>Promise<void>){
 const app=await fixture.app({fiscalSimulatorEnabled:true});try{
  const actor=await fixture.user(),{cookie}=await login(app,actor);
  const customer=await createCustomer(app,cookie,TENANT_A,{name:`Cliente simulação QA ${randomUUID()}`});
  const tech=await command(app,cookie,"technician.create",{name:`Técnico simulação QA ${randomUUID()}`});
  let order=await command(app,cookie,"order.create",{customerId:customer.id,technicianId:tech.id,equipment:"Aparelho QA",issue:"Reparo QA",laborCents:1250});
  order=await command(app,cookie,"order.advance",{id:order.id,version:order.version});order=await command(app,cookie,"order.advance",{id:order.id,version:order.version});
  order=await command(app,cookie,"order.update",{id:order.id,version:order.version,approved:true});
  await run(app,cookie,order,actor);
 }finally{await app.close();}
}
const input=(order:any,scenario="accepted",requestId:string=randomUUID())=>({requestId,orderId:order.id,orderVersion:order.version,scenario});
async function start(app:TestApp,cookie:string,order:any,scenario="accepted",requestId?:string){const r=await post(app,cookie,input(order,scenario,requestId));assert.equal(r.statusCode,200,r.body);return r.json().document;}
async function immutableSnapshot(){const values=[];for(const table of ["operational_records","stock_balances","stock_movements","finance_accounts","finance_agreements","finance_installments","finance_payments","finance_movements","fiscal_records","nfse_dps_counters","nfse_dps_drafts","nfse_a1_custody"])
 values.push((await fixture.a.migrationPool.query(`SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) v FROM ${table} t`)).rows[0].v);return values;}

test("SIM01 aceita sem CNPJ/A1, mantém snapshot e não modifica domínios operacionais/oficiais",async()=>{
 await scenario(async(app,cookie,order,actor)=>{
  const before=await immutableSnapshot(),document=await start(app,cookie,order);
  assert.equal(document.environment,"simulation");assert.equal(document.provider,"local_simulator");assert.equal(document.model,"NFS-e");assert.equal(document.officialAuthorization,false);
  assert.equal(document.state,"simulated_accepted");assert.match(document.reference,/^SIM-/);assert.equal(document.source.amountCents,1250);assert.equal(document.source.orderId,order.id);
  assert.equal(document.createdBy,actor.id);assert.equal(document.events.length,1);assert.equal(document.events[0].actorId,actor.id);
  for(const key of ["accessKey","protocol","xml","dpsId"])assert.equal(Object.hasOwn(document,key),false);
  assert.deepEqual(await immutableSnapshot(),before);
  const official=await app.instance.inject({method:"GET",url:`/api/v1/tenants/${TENANT_A}/fiscal/drafts/${document.id}`,headers:{cookie}});assertError(official,404);
  await command(app,cookie,"order.update",{id:order.id,version:order.version,diagnosis:"Outro diagnóstico QA"});
  const saved=await get(app,cookie,`/${document.id}`);assert.equal(saved.statusCode,200);assert.equal(saved.json().document.source.orderVersion,order.version);assert.equal(saved.json().document.source.amountCents,1250);
 });
});
test("SIM02 resultado desconhecido consulta a mesma referência e rejeição não pode ser promovida",async()=>{
 await scenario(async(app,cookie,order)=>{
  const unknown=await start(app,cookie,order,"unknown_after_accept");assert.equal(unknown.state,"simulated_unknown");
  const request={requestId:randomUUID(),version:unknown.version};const response=await post(app,cookie,request,`/${unknown.id}/reconcile`);assert.equal(response.statusCode,200,response.body);
  const accepted=response.json().document;assert.equal(accepted.id,unknown.id);assert.equal(accepted.reference,unknown.reference);assert.equal(accepted.version,2);assert.equal(accepted.state,"simulated_accepted");assert.equal(accepted.events.length,2);
  const replay=await post(app,cookie,request,`/${unknown.id}/reconcile`);assert.equal(replay.statusCode,200);assert.deepEqual(replay.json().document,accepted);
  const rejected=await start(app,cookie,order,"rejected");assert.equal(rejected.state,"simulated_rejected");
  assertError(await post(app,cookie,{requestId:randomUUID(),version:rejected.version},`/${rejected.id}/reconcile`),409);
  assertError(await post(app,cookie,{requestId:randomUUID(),version:accepted.version,state:"authorized"},`/${accepted.id}/reconcile`),400);
 });
});
test("SIM03 mesmo pedido ou nova chave equivalente não duplicam; ator/conteúdo/versão conflitam",async()=>{
 await scenario(async(app,cookie,order)=>{
  const id=randomUUID(),first=await start(app,cookie,order,"accepted",id);assert.deepEqual(await start(app,cookie,order,"accepted",id),first);
  assert.deepEqual(await start(app,cookie,order),first);
  assertError(await post(app,cookie,input(order,"rejected",id)),409);
  const other=await fixture.user(),session=await login(app,other);assertError(await post(app,session.cookie,input(order,"accepted",id)),409);
  await command(app,cookie,"order.update",{id:order.id,version:order.version,diagnosis:"Mudança QA"});
  assert.deepEqual(await start(app,cookie,order),first,"Nova chave equivalente recupera o snapshot mesmo depois da alteração da OS");
  assertError(await post(app,cookie,input(order,"rejected")),409);
  const history=await get(app,cookie,`?orderId=${order.id}`);assert.equal(history.statusCode,200);assert.equal(history.json().total,1);
 });
});
test("SIM04 direitos, revogação, sessão, empresa e configuração são conferidos inclusive replay",async()=>{
 await scenario(async(app,cookie,order)=>{
  assertError(await post(app,"",input(order)),401);assertError(await post(app,cookie,input(order),"",TENANT_B),403);
  const operator=await fixture.user("operator"),session=await login(app,operator);
  await fixture.control.migrationPool.query("UPDATE memberships SET permission_overrides=$1 WHERE user_id=$2",[JSON.stringify({"fiscal.read":true,"orders.read":true,"fiscal.simulate":false}),operator.id]);
  assertError(await post(app,session.cookie,input(order)),403);
  await fixture.control.migrationPool.query("UPDATE memberships SET permission_overrides=$1 WHERE user_id=$2",[JSON.stringify({"fiscal.read":true,"orders.read":true,"fiscal.simulate":true}),operator.id]);
  const id=randomUUID();await start(app,session.cookie,order,"accepted",id);
  await fixture.control.migrationPool.query("UPDATE memberships SET permission_overrides=$1 WHERE user_id=$2",[JSON.stringify({"fiscal.read":true,"orders.read":true,"fiscal.simulate":false}),operator.id]);
  assertError(await post(app,session.cookie,input(order,"accepted",id)),403);
  const off=await fixture.app();try{const cfg=await get(off,cookie,"/config");assert.equal(cfg.statusCode,200);assert.equal(cfg.json().enabled,false);assertError(await post(off,cookie,input(order,"rejected")),503);}finally{await off.close();}
 });
});
test("SIM05 concorrência e falha de auditoria preservam uma simulação completa ou nada",async()=>{
 await scenario(async(app,cookie,order)=>{
  const results=await Promise.all([post(app,cookie,input(order)),post(app,cookie,input(order))]);assert.ok(results.every(r=>r.statusCode===200));assert.equal(results[0].json().document.id,results[1].json().document.id);
  const role=fixture.a.runtimeUser,id=randomUUID();await fixture.a.migrationPool.query(`REVOKE INSERT ON audit_events FROM "${role}"`);
  try{assertError(await post(app,cookie,input(order,"rejected",id)),503);}finally{await fixture.a.migrationPool.query(`GRANT INSERT ON audit_events TO "${role}"`);}
  const result=await start(app,cookie,order,"rejected",id);assert.equal(result.events.length,1);
  const count=(await fixture.a.migrationPool.query("SELECT count(*)::int n FROM fiscal_simulations WHERE source_id=$1",[order.id])).rows[0].n;assert.equal(count,2);
 });
});
test("SIM06 dados forjados, preço/aprovação ausentes e consultas inválidas não criam simulação",async()=>{
 await scenario(async(app,cookie,order)=>{
  for(const extra of [{environment:"production"},{provider:"focus"},{officialAuthorization:true},{scenario:"authorized"},{orderVersion:0}])assertError(await post(app,cookie,{...input(order),...extra}),400);
  const pending=await command(app,cookie,"order.create",{customerId:order.customerId,equipment:"Outro QA",issue:"Examinar QA"});assertError(await post(app,cookie,input(pending)),409);
  for(const query of ["?orderId=invalid",`?orderId=${order.id}&limit=101`,`?orderId=${order.id}&offset=-1`,`?orderId=${order.id}&unexpected=1`])assertError(await get(app,cookie,query),400);
 });
});
test("SIM07 histórico é paginado, auditável e migração incremental reaplicável sem perder registros",async()=>{
 await scenario(async(app,cookie,order)=>{
  for(const value of ["accepted","rejected","unknown_after_accept"])await start(app,cookie,order,value);
  const first=await get(app,cookie,`?orderId=${order.id}&limit=1`),second=await get(app,cookie,`?orderId=${order.id}&limit=1&offset=1`);
  assert.equal(first.statusCode,200);assert.equal(first.json().total,3);assert.notEqual(first.json().items[0].id,second.json().items[0].id);
  const event=first.json().items[0].events[0];assert.equal(event.kind,"created");assert.equal(typeof event.at,"string");
  await assert.rejects(fixture.a.migrationPool.query("UPDATE fiscal_simulation_events SET kind='changed' WHERE simulation_id=$1",[first.json().items[0].id]));
  const {migrateTenant}=await import("../src/migrations.ts");await migrateTenant(fixture.a.migrationPool);
  assert.equal((await get(app,cookie,`?orderId=${order.id}`)).json().total,3);
 });
});
