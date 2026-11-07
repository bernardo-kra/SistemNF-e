import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Browser, BrowserContext } from "@playwright/test";
import { createFixture, ORIGIN, TENANT_A, type Fixture, type TestApp } from "./helpers.ts";

// Integration verification: real Chrome → local HTTP → isolated PostgreSQL → official XSD.
// No intercepted requests, customer data, remote bank or fiscal transmission.
if(!process.argv.includes("--run"))throw new Error("Execute explicitamente com --run e frontend local disponível.");
const {chromium,expect}=createRequire(new URL("../../package.json",import.meta.url))("@playwright/test") as typeof import("@playwright/test");
const base=`http://127.0.0.1:4000/api/v1/tenants/${TENANT_A}`;
let fixture:Fixture|undefined,app:TestApp|undefined,browser:Browser|undefined,context:BrowserContext|undefined;
let stage="setup",success=false,cleanup=true,preparationPosts=0,preparationMs=0;
try{
 fixture=await createFixture();await fixture.a.migrationPool.query("INSERT INTO tenant_admission(singleton,slot_id,tenant_id,claimed_at) VALUES(true,$1,$2,clock_timestamp())",[randomUUID(),TENANT_A]);
 const actor=await fixture.user();app=await fixture.app();await app.instance.listen({host:"127.0.0.1",port:4000});browser=await chromium.launch({channel:"chrome",headless:true});context=await browser.newContext({viewport:{width:1440,height:1000}});
 stage="login";const login=await context.request.post("http://127.0.0.1:4000/api/auth/sign-in/email",{headers:{origin:ORIGIN},data:{email:actor.email,password:actor.password}});assert.equal(login.status(),200);
 const created=await context.request.post(base+"/customers",{headers:{origin:ORIGIN},data:{requestId:randomUUID(),name:"Tomador genérico de integração",type:"Pessoa física"}});assert.equal(created.status(),201);const customerId=(await created.json()).customer.id,orderId=randomUUID();
 await fixture.a.migrationPool.query("INSERT INTO operational_records(entity_type,id,body,version,created_at,updated_at,created_by,updated_by) VALUES('order',$1,$2,1,clock_timestamp(),clock_timestamp(),$3,$3)",[orderId,JSON.stringify({number:"OS-QA900",customerId,customerName:"Tomador genérico de integração",approved:true,laborCents:12345,stage:"ready_for_pickup",tested:true,equipment:"Aparelho genérico",issue:"Serviço genérico",diagnosis:"",technicianName:"Técnico genérico",due:"2026-10-31"}),actor.id]);
 const page=await context.newPage();page.on("request",request=>{if(request.method()==="POST"&&new URL(request.url()).pathname.endsWith("/prepare"))preparationPosts++;});
 stage="profile";await page.goto(ORIGIN+"/fiscal/");await page.getByRole("button",{name:"Configuração fiscal",exact:true}).click();
 const values:Record<string,string>={"CNPJ do prestador":"11222333000181","Município emissor (código IBGE)":"3550308","Local habitual do serviço (código IBGE)":"3550308","Série da DPS":"1","Código nacional do serviço":"140101","Descrição habitual do serviço":"Reparo genérico de integração","Tributos aproximados do Simples (%)":"4,12"};
 for(const [label,value] of Object.entries(values))await page.getByLabel(label,{exact:true}).fill(value);
 for(const [label,value] of Object.entries({"Regime tributário":"simples_me_epp","Apuração do Simples":"1","Regime especial":"0","Tributação do ISS":"1","Retenção do ISS":"1"}))await page.getByLabel(label,{exact:true}).selectOption(value);
 await page.getByLabel("Tributos aproximados do Simples (%)",{exact:true}).fill("4,123");await page.getByRole("button",{name:"Salvar configuração",exact:true}).click();await expect(page.getByText("Confira os campos e as permissões informadas.",{exact:true})).toBeVisible();
 await page.getByLabel("Tributos aproximados do Simples (%)",{exact:true}).fill("4,12");await page.getByRole("button",{name:"Salvar configuração",exact:true}).click();await expect(page.getByText("Configuração salva. Campos desconhecidos continuam pendentes.",{exact:true})).toBeVisible();
 stage="recipient";await page.getByRole("button",{name:"Preparar NFS-e",exact:true}).click();await page.getByLabel("Buscar ordem de serviço",{exact:true}).fill("QA900");await page.getByRole("option",{name:/OS-QA900/}).click();await page.getByLabel("Tipo de documento",{exact:true}).selectOption("CPF");await page.getByLabel("Documento do tomador",{exact:true}).fill("52998224725");await page.getByRole("button",{name:"Salvar identificação",exact:true}).click();await expect(page.getByText("Identificação fiscal salva para as próximas ordens.",{exact:true})).toBeVisible();
 stage="prepare";await page.getByLabel("Competência do serviço",{exact:true}).fill("2026-10-28");const started=performance.now();await page.getByRole("button",{name:"Preparar rascunho",exact:true}).click();await expect(page.getByText("Rascunho preparado. Nenhuma nota foi transmitida.",{exact:true})).toBeVisible();preparationMs=Math.round(performance.now()-started);assert.equal(preparationPosts,1);
 stage="metadata";const snapshot=await context.request.get(base+`/fiscal/orders/${orderId}/draft`);assert.equal(snapshot.status(),200);const draft=(await snapshot.json()).draft;assert.equal(draft.readyForSubmission,false);assert.equal(draft.xml,undefined);
 stage="xml";const xml=await context.request.get(base+`/fiscal/drafts/${draft.draftId}/xml`);assert.equal(xml.status(),200);assert.match(await xml.text(),/<xNome>Tomador genérico de integração<\/xNome>/);assert.match(await xml.text(),/<vServ>123.45<\/vServ>/);
 stage="recovery";await page.reload();await page.getByLabel("Buscar ordem de serviço",{exact:true}).fill("QA900");await page.getByRole("option",{name:/OS-QA900/}).click();await expect(page.getByRole("button",{name:"Baixar rascunho XML",exact:true})).toBeVisible();assert.equal(preparationPosts,1);
 const directory=new URL("../.local/validation/",import.meta.url);await mkdir(directory,{recursive:true});
 for(const width of [1440,320]){await page.setViewportSize({width,height:1000});if(width<800)await page.getByRole("button",{name:"Abrir navegação",exact:true}).click({trial:true});await page.getByRole("button",{name:"Baixar rascunho XML",exact:true}).click({trial:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.screenshot({path:fileURLToPath(new URL(`nfsd-p-browser-${width}.png`,directory)),fullPage:true});}
 assert.ok(app.logs.every(line=>!line.includes("52998224725")&&!line.includes("11222333000181")&&!line.includes("<DPS")));success=true;
}catch(error){console.error(JSON.stringify({event:"fiscal.browser.failed",stage,code:error&&typeof error==="object"&&"code"in error?String(error.code):"VERIFICATION_FAILED"}));process.exitCode=1;}
finally{for(const close of [()=>context?.close(),()=>browser?.close(),()=>app?.close(),()=>fixture?.close()]){try{await close();}catch{cleanup=false;process.exitCode=1;}}console.log(JSON.stringify({event:"fiscal.browser.result",success,stage,cleanup,preparationPosts,observedPreparationMs:preparationMs}));}
