import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { migrateTenant } from "../src/migrations.ts";
import { assertError, authHeaders, createFixture, login, TENANT_A, TENANT_B, type Fixture, type TestApp } from "./helpers.ts";
let fixture: Fixture;
before(async () => {
  fixture = await createFixture();
  for(const [db,id] of [[fixture.a,TENANT_A],[fixture.b,TENANT_B]] as const) await db.migrationPool.query("INSERT INTO tenant_admission(singleton,slot_id,tenant_id,claimed_at) VALUES(true,$1,$2,clock_timestamp())",[randomUUID(),id]);
});
after(async () => { await fixture?.close(); });
const base=(tenant=TENANT_A)=>`/api/v1/tenants/${tenant}/fiscal`;
const full=()=>({cnpj:"11222333000181",municipalityCode:"3550308",serviceMunicipalityCode:"3550308",regime:"simples_me_epp",simplesAssessment:"1",specialRegime:"0",series:"1",nationalTaxCode:"140101",serviceDescription:"Reparo genérico QA",approxSimplesRate:"4.12",issTaxation:"1",issWithholding:"1"});
async function scenario(run:(app:TestApp,cookie:string,actor:{id:string})=>Promise<void>) {const app=await fixture.app();try{const actor=await fixture.user();const {cookie}=await login(app,actor);await run(app,cookie,actor);}finally{await app.close();}}
async function get(app:TestApp,cookie:string,path="/profile"){return app.instance.inject({method:"GET",url:base()+path,headers:{cookie}});}
async function patch(app:TestApp,cookie:string,path:string,body:Record<string,unknown>){return app.instance.inject({method:"PATCH",url:base()+path,headers:authHeaders(cookie),payload:body});}
async function profile(app:TestApp,cookie:string,fields:Record<string,unknown>={}){const old=await get(app,cookie);assert.equal(old.statusCode,200,old.body);const result=await patch(app,cookie,"/profile",{requestId:randomUUID(),version:old.json().profile.version,...fields});assert.equal(result.statusCode,200,result.body);return result.json().profile;}
async function seed(app:TestApp,cookie:string){
 const customerId=randomUUID(),orderId=randomUUID();
 await fixture.a.migrationPool.query("INSERT INTO customers(id,name,type) VALUES($1,'Tomador genérico do cadastro','Pessoa física')",[customerId]);
 await fixture.a.migrationPool.query("INSERT INTO operational_records(entity_type,id,body,version,created_at,updated_at,created_by,updated_by) VALUES('order',$1,$2,1,clock_timestamp(),clock_timestamp(),'qa','qa')",[orderId,JSON.stringify({customerId,customerName:"Nome antigo",approved:true,laborCents:12345,unlockPassword:"NEVER-EXPOSE-DEVICE"})]);
 const result=await patch(app,cookie,`/customers/${customerId}`,{requestId:randomUUID(),version:0,document:{type:"CPF",value:"52998224725"}});assert.equal(result.statusCode,200,result.body);
 return {customerId,orderId};
}
async function prepare(app:TestApp,cookie:string,orderId:string,profileVersion:number,fields:Record<string,unknown>={}){
 return app.instance.inject({method:"POST",url:base()+`/orders/${orderId}/prepare`,headers:authHeaders(cookie),payload:{requestId:randomUUID(),orderVersion:1,profileVersion,customerFiscalVersion:1,competence:"2026-10-28",...fields}});
}
test("NFSDP01 sessão, vínculo e direitos fiscais independentes protegem perfil/cliente/preparação",async()=>{
 await scenario(async(app,cookie)=>{
  assertError(await app.instance.inject({method:"GET",url:base()+"/profile"}),401);
  assertError(await app.instance.inject({method:"GET",url:base(TENANT_B)+"/profile",headers:{cookie}}),403);
  const employee=await fixture.user("operator"),session=await login(app,employee);
  assertError(await get(app,session.cookie),403);assertError(await patch(app,session.cookie,"/profile",{version:0,requestId:randomUUID()}),403);
  assertError(await prepare(app,session.cookie,randomUUID(),0),403);
  assertError(await app.instance.inject({method:"PATCH",url:base()+"/profile",headers:{cookie,origin:"https://untrusted.example.test"},payload:{version:0,requestId:randomUUID()}}),403);
 });
});
test("NFSDP02 perfil vazio não inventa dados e pode salvar campos incompletos",async()=>{
 await scenario(async(app,cookie)=>{const result=await get(app,cookie);assert.equal(result.statusCode,200,result.body);const value=result.json().profile;assert.equal(value.version,0);assert.equal(value.fields.regime,null);assert.equal(value.fields.cnpj,null);assert.equal(value.preparationReady,false);assert.equal(value.readyForSubmission,false);assert.ok(value.missingFields.includes("regime"));
 const saved=await profile(app,cookie,{municipalityCode:"3550308"});assert.equal(saved.fields.municipalityCode,"3550308");assert.equal(saved.fields.regime,null);assert.equal(saved.preparationReady,false);});
});
test("NFSDP03 versão, null, noop e replay preservam autoria/hora sem auditoria duplicada",async()=>{
 await scenario(async(app,cookie,actor)=>{const initial=await profile(app,cookie,{...full(),legalName:"Empresa genérica"});assert.equal(initial.updatedBy,actor.id);assert.match(initial.updatedAt,/Z$/);assert.equal(initial.preparationReady,true);
 const command={requestId:randomUUID(),version:initial.version,legalName:"Empresa genérica"};const first=await patch(app,cookie,"/profile",command);assert.equal(first.statusCode,200,first.body);assert.deepEqual(first.json().profile,initial);
 const changed=await profile(app,cookie,{legalName:null});assert.equal(changed.version,initial.version+1);assert.equal(changed.fields.legalName,null);
 assert.deepEqual((await patch(app,cookie,"/profile",command)).json().profile,initial);
 assertError(await patch(app,cookie,"/profile",{requestId:randomUUID(),version:initial.version,series:"2"}),409);
 assertError(await patch(app,cookie,"/profile",{...command,series:"2"}),409);
 const audit=(await fixture.a.migrationPool.query("SELECT after_values,before_values,field_names FROM audit_events WHERE entity_type='fiscal_profile' AND entity_id=$1",[TENANT_A])).rows;
 assert.ok(audit.length>=2);assert.doesNotMatch(JSON.stringify(audit),/11222333000181|Empresa genérica/);
 });
});
test("NFSDP04 dados inválidos/forjados e produção são recusados sem alterar perfil",async()=>{
 await scenario(async(app,cookie)=>{const value=await profile(app,cookie,{});
 for(const fields of [{cnpj:"11111111111111"},{municipalityCode:"355"},{series:"0"},{regime:"inventado"},{approxSimplesRate:"4,12"},{actorId:"fake"},{environment:"production"}]) assertError(await patch(app,cookie,"/profile",{version:value.version,requestId:randomUUID(),...fields}),400);
 assert.deepEqual((await get(app,cookie)).json().profile,value);
 });
});
test("NFSDP05 identificação fiscal do tomador mantém vínculo/tipo, null e dados no banco",async()=>{
 await scenario(async(app,cookie)=>{const {customerId}=await seed(app,cookie);const path=`/customers/${customerId}`;let result=await get(app,cookie,path);assert.equal(result.statusCode,200,result.body);assert.equal(result.json().customerFiscal.fields.document.value,"52998224725");
 assertError(await patch(app,cookie,path,{requestId:randomUUID(),version:1,document:{type:"CNPJ",value:"11222333000181"}}),409);
 result=await patch(app,cookie,path,{requestId:randomUUID(),version:1,document:null});assert.equal(result.statusCode,200,result.body);assert.equal(result.json().customerFiscal.fields.document,null);
 const audit=(await fixture.a.migrationPool.query("SELECT before_values,after_values FROM audit_events WHERE entity_type='customer_fiscal' AND entity_id=$1",[customerId])).rows;assert.doesNotMatch(JSON.stringify(audit),/52998224725|11222333000181/);
 });
});
test("NFSDP06 preparação incompleta ou fora do recorte não reserva nem presume regime",async()=>{
 await scenario(async(app,cookie)=>{const {orderId}=await seed(app,cookie);let saved=await profile(app,cookie,{regime:null});assertError(await prepare(app,cookie,orderId,saved.version),409);
 saved=await profile(app,cookie,{...full(),regime:"mei"});assert.equal(saved.preparationReady,false);assert.ok(saved.unsupportedFields.includes("regime"));assertError(await prepare(app,cookie,orderId,saved.version),409);
 assert.equal((await fixture.a.migrationPool.query("SELECT count(*)::int AS n FROM nfse_dps_drafts WHERE order_id=$1",[orderId])).rows[0].n,0);
 });
});
test("NFSDP07 OS→cadastros→journal→XSD prepara em uma chamada e restringe XML ao download",async()=>{
 await scenario(async(app,cookie)=>{const saved=await profile(app,cookie,full()),{orderId}=await seed(app,cookie);const result=await prepare(app,cookie,orderId,saved.version);assert.equal(result.statusCode,200,result.body);const draft=result.json().draft;
 assert.equal(draft.state,"unsigned_draft");assert.equal(draft.readyForSubmission,false);assert.equal(draft.numberReserved,true);assert.equal(draft.serviceAmountCents,12345);assert.equal(draft.profileVersion,saved.version);assert.equal(draft.customerFiscalVersion,1);assert.equal(draft.xml,undefined);assert.doesNotMatch(result.body,/52998224725|NEVER-EXPOSE|<DPS/);
 const xml=await get(app,cookie,`/drafts/${draft.draftId}/xml`);assert.equal(xml.statusCode,200,xml.body);assert.match(xml.headers["content-type"] as string,/application\/xml/);assert.match(xml.body,/<xNome>Tomador genérico do cadastro<\/xNome>/);assert.match(xml.body,/<CPF>52998224725<\/CPF>/);assert.doesNotMatch(xml.body,/NEVER-EXPOSE|Nome antigo/);
 const history=await get(app,cookie,`/drafts/${draft.draftId}/history`);assert.equal(history.statusCode,200,history.body);assert.equal(history.json().events.length,1);assert.doesNotMatch(history.body,/52998224725|<DPS/);
 assert.ok(app.logs.every(line=>!line.includes("52998224725")&&!line.includes("11222333000181")&&!line.includes("<DPS")));
 });
});
test("NFSDP08 replay após editar cadastros recupera XML original e conflito não duplica",async()=>{
 await scenario(async(app,cookie)=>{const saved=await profile(app,cookie,full()),{orderId,customerId}=await seed(app,cookie),requestId=randomUUID();const body={requestId};const first=await prepare(app,cookie,orderId,saved.version,body);assert.equal(first.statusCode,200,first.body);const id=first.json().draft.draftId;const xml=(await get(app,cookie,`/drafts/${id}/xml`)).body;
 await profile(app,cookie,{regime:null});await patch(app,cookie,`/customers/${customerId}`,{requestId:randomUUID(),version:1,document:null});
 const repeated=await prepare(app,cookie,orderId,saved.version,body);assert.equal(repeated.statusCode,200,repeated.body);assert.deepEqual(repeated.json(),first.json());assert.equal((await get(app,cookie,`/drafts/${id}/xml`)).body,xml);
 assertError(await prepare(app,cookie,orderId,saved.version,{requestId,competence:"2026-10-27"}),409);
 });
});
test("NFSDP09 versão fiscal/tomador desatualizada bloqueia sem consumir número",async()=>{
 await scenario(async(app,cookie)=>{const saved=await profile(app,cookie,full()),{orderId}=await seed(app,cookie);
 assertError(await prepare(app,cookie,orderId,saved.version+1),409);assertError(await prepare(app,cookie,orderId,saved.version,{customerFiscalVersion:0}),409);
 assert.equal((await fixture.a.migrationPool.query("SELECT count(*)::int AS n FROM nfse_dps_drafts WHERE order_id=$1",[orderId])).rows[0].n,0);
 });
});
test("NFSDP10 concessões exigem dependências e revogação protege inclusive replay/XML",async()=>{
 await scenario(async(app,cookie)=>{const saved=await profile(app,cookie,full()),{orderId}=await seed(app,cookie);const prepared=await prepare(app,cookie,orderId,saved.version);assert.equal(prepared.statusCode,200,prepared.body);const id=prepared.json().draft.draftId;
 const employee=await fixture.user("viewer"),{cookie:staff}=await login(app,employee);const grants={"fiscal.read":true,"fiscal.configure":true};
 await fixture.control.migrationPool.query("UPDATE memberships SET permission_overrides=$1 WHERE user_id=$2",[JSON.stringify(grants),employee.id]);assert.equal((await get(app,staff)).statusCode,200);assertError(await prepare(app,staff,orderId,saved.version),403);
 await fixture.control.migrationPool.query("UPDATE memberships SET permission_overrides=$1 WHERE user_id=$2",[JSON.stringify({"fiscal.prepare":true}),employee.id]);assertError(await prepare(app,staff,orderId,saved.version),403);
 await fixture.control.migrationPool.query("UPDATE memberships SET active=false WHERE user_id=$1",[employee.id]);assertError(await get(app,staff,`/drafts/${id}/xml`),403);
 });
});
test("NFSDP11 perfil suporta concorrência otimista e replay sem migração destrutiva",async()=>{
 await scenario(async(app,cookie)=>{const saved=await profile(app,cookie,full());const results=await Promise.all(["21","22"].map(series=>patch(app,cookie,"/profile",{requestId:randomUUID(),version:saved.version,series})));assert.deepEqual(results.map(row=>row.statusCode).sort(),[200,409]);
 const before=(await get(app,cookie)).json().profile;await migrateTenant(fixture.a.migrationPool);assert.deepEqual((await get(app,cookie)).json().profile,before);
 });
});
test("NFSDP12 falha no vínculo da preparação desfaz também a reserva do journal",async()=>{
 await scenario(async(app,cookie)=>{const saved=await profile(app,cookie,full()),{orderId}=await seed(app,cookie);
 const counters=(await fixture.a.migrationPool.query("SELECT * FROM nfse_dps_counters ORDER BY environment,municipality_code,issuer_cnpj,series")).rows;
 await fixture.a.migrationPool.query("CREATE FUNCTION qa_fail_fiscal_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'NEVER-EXPOSE-PRIVATE-SQL'; END $$; CREATE TRIGGER qa_fail_fiscal_link BEFORE INSERT ON fiscal_prepare_requests FOR EACH ROW EXECUTE FUNCTION qa_fail_fiscal_link()");
 try {const result=await prepare(app,cookie,orderId,saved.version);assertError(result,503);assert.doesNotMatch(result.body,/NEVER-EXPOSE|11222333000181|52998224725/);}
 finally {await fixture.a.migrationPool.query("DROP TRIGGER qa_fail_fiscal_link ON fiscal_prepare_requests; DROP FUNCTION qa_fail_fiscal_link()");}
 assert.equal((await fixture.a.migrationPool.query("SELECT count(*)::int AS n FROM nfse_dps_drafts WHERE order_id=$1",[orderId])).rows[0].n,0);
 assert.deepEqual((await fixture.a.migrationPool.query("SELECT * FROM nfse_dps_counters ORDER BY environment,municipality_code,issuer_cnpj,series")).rows,counters);
 });
});
test("NFSDP13 pool vinculado a outra empresa não expõe perfil nem documento",async()=>{
 await scenario(async(app,cookie)=>{assert.equal((await get(app,cookie)).statusCode,200);const wrong=await fixture.app({tenantDatabaseUrls:{a:fixture.config.tenantDatabaseUrls.b,b:fixture.config.tenantDatabaseUrls.b}});
 try {assertError(await get(wrong,cookie),403);assertError(await get(wrong,cookie,`/customers/${randomUUID()}`),403);}finally{await wrong.close();}
 });
});
test("NFSDP14 local de prestação desconhecido não é inferido do município do emissor",async()=>{
 await scenario(async(app,cookie)=>{const saved=await profile(app,cookie,{...full(),serviceMunicipalityCode:null}),{orderId}=await seed(app,cookie);assertError(await prepare(app,cookie,orderId,saved.version),409);});
});
test("NFSDP15 município de prestação declarado pode diferir do emissor",async()=>{
 await scenario(async(app,cookie)=>{const saved=await profile(app,cookie,{...full(),serviceMunicipalityCode:"3304557"}),{orderId}=await seed(app,cookie);const result=await prepare(app,cookie,orderId,saved.version);assert.equal(result.statusCode,200,result.body);const xml=(await get(app,cookie,`/drafts/${result.json().draft.draftId}/xml`)).body;assert.match(xml,/<cLocEmi>3550308<\/cLocEmi>/);assert.match(xml,/<cLocPrestacao>3304557<\/cLocPrestacao>/);});
});
test("NFSDP16 rascunho existente pode ser recuperado pela OS depois de perder a chave local",async()=>{
 await scenario(async(app,cookie)=>{const saved=await profile(app,cookie,full()),{orderId}=await seed(app,cookie);const prepared=await prepare(app,cookie,orderId,saved.version);assert.equal(prepared.statusCode,200,prepared.body);const result=await get(app,cookie,`/orders/${orderId}/draft`);assert.equal(result.statusCode,200,result.body);assert.equal(result.json().draft.draftId,prepared.json().draft.draftId);assert.equal(result.json().draft.xml,undefined);});
});
test("NFSDP17 exceção de município na OS não reescreve o padrão do perfil",async()=>{
 await scenario(async(app,cookie)=>{const saved=await profile(app,cookie,full()),{orderId}=await seed(app,cookie);const result=await prepare(app,cookie,orderId,saved.version,{serviceMunicipalityCode:"3304557"});assert.equal(result.statusCode,200,result.body);const xml=(await get(app,cookie,`/drafts/${result.json().draft.draftId}/xml`)).body;assert.match(xml,/<cLocPrestacao>3304557<\/cLocPrestacao>/);assert.deepEqual((await get(app,cookie)).json().profile,saved);});
});
