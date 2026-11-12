import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
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

test("NFSE-READY01 prontidão exige sessão/direito/vínculo e preserva bloqueio sem cadastro/A1", async () => {
  await scenario(async (app,cookie) => {
    assertError(await get(app,"","/readiness"),401);
    assertError(await app.instance.inject({method:"GET",url:base(TENANT_B)+"/readiness",headers:{cookie}}),403);
    const operator=await fixture.user("operator"), session=await login(app,operator);
    await fixture.control.migrationPool.query("UPDATE memberships SET permission_overrides=$1 WHERE user_id=$2",[JSON.stringify({"fiscal.read":false}),operator.id]);
    assertError(await get(app,session.cookie,"/readiness"),403);
    const response=await get(app,cookie,"/readiness");assert.equal(response.statusCode,200,response.body);
    assert.equal(response.json().readyForSubmission,false);assert.equal(response.json().environment,"production-restricted");
    assert.equal(response.json().setup.profileComplete,false);assert.equal(response.json().setup.certificateRegistered,false);
    assert.equal(response.json().setup.storageConfigured,false);assert.ok(response.json().technicalBlockers.includes("SUBMISSION_JOURNAL_REQUIRED"));
    assert.ok(!response.body.includes("ciphertext"));assert.ok(!response.body.includes("passphrase"));
  });
});
test("NFSE-READY02 cadastro preenchido não habilita emissão e consultas não alteram histórico",async()=>{
  await scenario(async(app,cookie)=>{
    await profile(app,cookie,full());
    const before=(await fixture.a.migrationPool.query("SELECT count(*)::int n FROM audit_events")).rows[0].n;
    for(let i=0;i<2;i++){const response=await get(app,cookie,"/readiness");assert.equal(response.statusCode,200,response.body);
      assert.equal(response.json().setup.profileComplete,true);assert.equal(response.json().readyForSubmission,false);
      assert.equal(response.json().setup.certificateCurrentForIssuer,false);
      assert.ok(response.json().technicalBlockers.includes("OFFICIAL_SIGNATURE_PROFILE_UNCONFIRMED"));}
    assert.equal((await fixture.a.migrationPool.query("SELECT count(*)::int n FROM audit_events")).rows[0].n,before);
    assertError(await get(app,cookie,"/readiness?unexpected=1"),400);
  });
});

test("NFSE-READY03 metadados genéricos de validade/emitente nunca certificam autorização",async()=>{
  await scenario(async(app,cookie)=>{
    await profile(app,cookie,full());
    const now=Date.now();
    for(const item of [
      {cnpj:"11222333000181",from:now-86400000,to:now+86400000,current:true},
      {cnpj:"11222333000181",from:now-172800000,to:now-86400000,current:false},
      {cnpj:"11444777000161",from:now-86400000,to:now+86400000,current:false},
    ]){
      // Metadata-only fixture; not a PFX, inspection, trusted certificate or user's record.
      await fixture.a.migrationPool.query(`INSERT INTO nfse_a1_custody
        (tenant_id,version,issuer_cnpj,fingerprint,valid_from,valid_to,key_bits,key_id,nonce,tag,ciphertext,updated_by,updated_at)
        VALUES($1,1,$2,$3,$4,$5,2048,'qa',$6,$7,$8,'qa',clock_timestamp())
        ON CONFLICT(tenant_id) DO UPDATE SET issuer_cnpj=EXCLUDED.issuer_cnpj,valid_from=EXCLUDED.valid_from,valid_to=EXCLUDED.valid_to`,
        [TENANT_A,item.cnpj,"0".repeat(64),new Date(item.from),new Date(item.to),Buffer.alloc(12),Buffer.alloc(16),Buffer.alloc(16)]);
      const response=await get(app,cookie,"/readiness");assert.equal(response.statusCode,200,response.body);
      assert.equal(response.json().setup.certificateRegistered,true);assert.equal(response.json().setup.certificateCurrentForIssuer,item.current);
      assert.equal(response.json().readyForSubmission,false);assert.equal(response.json().setup.storageConfigured,false);
      assert.ok(!response.body.includes(item.cnpj));
    }
  });
});
