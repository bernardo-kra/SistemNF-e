import { test, expect, type Page } from "@playwright/test";
const tenant="10000000-0000-4000-8000-000000000001";
async function api(page:Page,fail=false,overrides:Record<string,unknown>={}){const calls:string[]=[];
 await page.route("http://127.0.0.1:4000/**",async route=>{
  const path=new URL(route.request().url()).pathname;calls.push(path);let json:any={};
  if(path.endsWith("/me"))json={user:{id:"qa",name:"Pessoa QA",email:"qa@example.test"},tenants:[{id:tenant,name:"Loja QA",role:"owner",permissions:["fiscal.read"]}]};
  else if(path.endsWith("/branding"))json={branding:{version:0,logo:null,background:null,backgroundOpacity:10}};
  else if(path.endsWith("/profile"))json={profile:{version:0,fields:{},missingFields:["regime"],unsupportedFields:[],preparationReady:false}};
  else if(path.endsWith("/readiness")){if(fail){await route.fulfill({status:503,json:{error:{code:"SERVICE_UNAVAILABLE"}}});return;}
   json={tenantId:tenant,environment:"production-restricted",readyForSubmission:false,setup:{profileComplete:false,certificateRegistered:false,certificateCurrentForIssuer:false,storageConfigured:false},technicalBlockers:["OFFICIAL_SIGNATURE_PROFILE_UNCONFIRMED"],...overrides};}
  await route.fulfill({json});
 });return {calls,recover:()=>{fail=false;}};
}
for(const width of [1440,320])test(`NFR-UI01 pendências reais e envio indisponível em ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:1000});const {calls}=await api(page);await page.goto("/fiscal/");
 await expect(page.getByRole("heading",{name:"Prontidão para emissão",exact:true})).toBeVisible();
 await expect(page.getByText("Envio oficial ainda indisponível",{exact:true})).toBeVisible();
 await expect(page.getByText("Cadastro fiscal incompleto",{exact:true})).toBeVisible();
 await expect(page.getByText("Certificado A1 ainda não cadastrado",{exact:true})).toBeVisible();
 expect(calls.some(path=>path.includes("/submit"))).toBe(false);await expect(page.getByRole("button",{name:"Emitir nota",exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath(`fiscal-readiness-${width}.png`),fullPage:true});
});
test("NFR-UI02 falha não mostra prontidão e permite consultar novamente",async({page})=>{
 const {calls,recover}=await api(page,true);await page.goto("/fiscal/");
 await expect(page.getByText("Não foi possível conferir as pendências de emissão.",{exact:true})).toBeVisible();
 recover();
 await page.getByRole("button",{name:"Verificar emissão novamente",exact:true}).click();
 await expect(page.getByText("Cadastro fiscal incompleto",{exact:true})).toBeVisible();
 expect(calls.filter(path=>path.endsWith("/readiness")).length).toBeGreaterThanOrEqual(2);
});
test("NFR-UI03 resposta de outra empresa ou prontidão inesperada mantém envio bloqueado",async({page})=>{
 for(const overrides of [{tenantId:"10000000-0000-4000-8000-000000000002"},{readyForSubmission:true}]){
  await page.unrouteAll({behavior:"wait"});await api(page,false,overrides);await page.goto("/fiscal/");
  await expect(page.getByText("Não foi possível conferir as pendências de emissão.",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Emitir nota",exact:true})).toHaveCount(0);
 }
});
