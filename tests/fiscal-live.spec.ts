import { expect, test, type Page } from "@playwright/test";
const tenant="10000000-0000-4000-8000-000000000001", customer="10000000-0000-4000-8000-000000000011", order="10000000-0000-4000-8000-000000000012";
const fields={cnpj:null,municipalityCode:null,regime:null,simplesAssessment:null,specialRegime:null,series:null,nationalTaxCode:null,serviceDescription:null,approxSimplesRate:null,issTaxation:null,issWithholding:null,legalName:null,municipalTaxCode:null,nbsCode:null};
async function api(page:Page,ready=false,rights=["customers.read","orders.read","fiscal.read","fiscal.configure","fiscal.prepare"],missing?:string[]){
 const calls:{path:string;method:string;body:any}[]=[];
 const profile={version:ready?1:0,fields:{...fields,...(ready?{cnpj:"11222333000181",regime:"simples_me_epp",serviceDescription:"Reparo QA"}:{})},missingFields:missing??(ready?[]:["regime"]),unsupportedFields:[],preparationReady:ready&&!missing?.length,readyForSubmission:false,updatedAt:null,updatedBy:null};
 let prepared:unknown=null;
 await page.route("http://127.0.0.1:4000/**",async route=>{
  const req=route.request(),path=new URL(req.url()).pathname,method=req.method();const headers={"access-control-allow-origin":"http://127.0.0.1:3000","access-control-allow-credentials":"true","access-control-allow-headers":"content-type","access-control-allow-methods":"GET,POST,PATCH,OPTIONS"};
  if(method==="OPTIONS"){await route.fulfill({status:204,headers});return;}
  const body=req.postDataJSON();calls.push({path,method,body});let json:unknown={tenantId:tenant};
  if(path.endsWith("/me"))json={user:{id:"qa-manager",name:"Pessoa QA",email:"qa@example.test"},tenants:[{id:tenant,name:"Empresa genérica QA",role:"owner",permissions:rights}]};
  else if(path.endsWith("/branding"))json={branding:{version:0,logo:null,background:null,backgroundOpacity:10}};
  else if(path.endsWith("/profile")){if(method==="PATCH"){Object.assign(profile.fields,body);profile.version++;}json={profile};}
  else if(path.endsWith("/readiness"))json={tenantId:tenant,environment:"production-restricted",readyForSubmission:false,setup:{profileComplete:false,certificateRegistered:false,certificateCurrentForIssuer:false,storageConfigured:false},technicalBlockers:[]};
  else if(path.endsWith("/certificate"))json={tenantId:tenant,storageConfigured:false,certificate:null};
  else if(path.endsWith("/operations/orders"))json={items:[{id:order,number:"OS-QA001",customerId:customer,customerName:"Cliente QA",approved:true,version:1,laborCents:12345},{id:order.replace(/2$/,"3"),number:"OS-QA002",customerId:customer,customerName:"Outro cliente QA",approved:true,version:1,laborCents:10000}],total:2};
  else if(path.endsWith(`/customers/${customer}`))json={customerFiscal:{version:1,fields:{document:{type:"CPF",value:"52998224725"},address:null}}};
  else if(path.endsWith("/prepare")){prepared={draftId:"10000000-0000-4000-8000-000000000021",number:"1",state:"unsigned_draft",readyForSubmission:false,numberReserved:true,pendingChecks:["CERTIFICATE_AND_SIGNATURE_REQUIRED"],serviceAmountCents:12345};json={draft:prepared};}
  else if(path.endsWith("/draft"))json={draft:prepared};
  await route.fulfill({headers,json});
 });return calls;
}
for(const width of [1440,320])test(`NFSDP-UI01 cadastro incompleto sem presumir regime, preserva contexto em ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:1000});const calls=await api(page);await page.goto("/fiscal/");
 await page.getByRole("button",{name:"Configuração fiscal",exact:true}).click();await expect(page.getByLabel("Regime tributário",{exact:true})).toHaveValue("");
 await page.getByLabel("Município emissor (código IBGE)",{exact:true}).fill("3550308");await page.getByLabel("Tributos aproximados do Simples (%)",{exact:true}).fill("4,12");
 await page.getByRole("button",{name:"Preparar NFS-e",exact:true}).click();await page.getByRole("button",{name:"Configuração fiscal",exact:true}).click();
 await expect(page.getByLabel("Município emissor (código IBGE)",{exact:true})).toHaveValue("3550308");await page.getByRole("button",{name:"Salvar configuração",exact:true}).click();
 await expect.poll(()=>calls.filter(call=>call.method==="PATCH").length).toBe(1);expect(calls.find(call=>call.method==="PATCH")?.body.regime).toBeNull();expect(calls.find(call=>call.method==="PATCH")?.body.approxSimplesRate).toBe("4.12");
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await expect(page.getByText("Validação oficial e transmissão ainda pendentes.",{exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath("fiscal-profile.png"),fullPage:true});
});
test("NFSDP-UI02 prepara conjunto com dados conhecidos e uma chamada, sem campos de numeração ou repetição do cliente",async({page})=>{
 const calls=await api(page,true);await page.goto("/fiscal/");await page.getByLabel("Buscar ordem de serviço",{exact:true}).fill("QA001");await page.getByRole("option",{name:/OS-QA001/}).click();
 await page.getByLabel("Competência do serviço",{exact:true}).fill("2026-10-28");await page.getByRole("button",{name:"Preparar rascunho",exact:true}).click();
 await expect(page.getByText("Rascunho preparado. Nenhuma nota foi transmitida.",{exact:true})).toBeVisible();expect(calls.filter(call=>call.path.endsWith("/prepare"))).toHaveLength(1);
 const body=calls.find(call=>call.path.endsWith("/prepare"))!.body;expect(body).not.toHaveProperty("customerName");expect(body).not.toHaveProperty("fiscal");expect(body).not.toHaveProperty("number");
 await page.reload();await page.getByLabel("Buscar ordem de serviço",{exact:true}).fill("QA001");await page.getByRole("option",{name:/OS-QA001/}).click();await expect(page.getByRole("button",{name:"Baixar rascunho XML"})).toBeVisible();expect(calls.filter(call=>call.path.endsWith("/prepare"))).toHaveLength(1);await expect(page.getByLabel("Competência do serviço",{exact:true})).toHaveCount(0);
});
test("NFSDP-UI04 local e competência de uma OS não são transferidos silenciosamente para outra",async({page})=>{
 await api(page,true);await page.goto("/fiscal/");const search=page.getByLabel("Buscar ordem de serviço",{exact:true});await search.fill("QA001");await page.getByRole("option",{name:/OS-QA001/}).click();await page.getByLabel("Competência do serviço",{exact:true}).fill("2026-10-28");await page.getByText("Serviço realizado em outro município",{exact:true}).click();await page.getByLabel("Município desta prestação (código IBGE)",{exact:true}).fill("3304557");
 await search.fill("QA002");await page.getByRole("option",{name:/OS-QA002/}).click();await expect(page.getByLabel("Competência do serviço",{exact:true})).toHaveValue("");await page.getByText("Serviço realizado em outro município",{exact:true}).click();await expect(page.getByLabel("Município desta prestação (código IBGE)",{exact:true})).toHaveValue("");
});
test("NFSDP-UI05 local declarado na OS resolve apenas essa pendência sem presumir local habitual",async({page})=>{
 await api(page,true,undefined,["serviceMunicipalityCode"]);await page.goto("/fiscal/");await page.getByLabel("Buscar ordem de serviço",{exact:true}).fill("QA001");await page.getByRole("option",{name:/OS-QA001/}).click();await page.getByLabel("Competência do serviço",{exact:true}).fill("2026-10-28");await expect(page.getByRole("button",{name:"Preparar rascunho",exact:true})).toBeDisabled();await page.getByText("Serviço realizado em outro município",{exact:true}).click();await page.getByLabel("Município desta prestação (código IBGE)",{exact:true}).fill("3304557");await expect(page.getByRole("button",{name:"Preparar rascunho",exact:true})).toBeEnabled();
});
test("NFSDP-UI06 resposta antiga não invalida a sessão depois de trocar empresa",async({page})=>{
 await api(page,true);let release=()=>{},seen=false;
 await page.route("**/fiscal/orders/*/prepare",async route=>{seen=true;await new Promise<void>(resolve=>{release=resolve;});await route.fulfill({status:403,headers:{"access-control-allow-origin":"http://127.0.0.1:3000","access-control-allow-credentials":"true"},json:{error:{code:"FORBIDDEN",message:"Negado",requestId:"qa"}}}).catch(()=>{});});
 try{await page.goto("/fiscal/");await page.getByLabel("Buscar ordem de serviço",{exact:true}).fill("QA001");await page.getByRole("option",{name:/OS-QA001/}).click();await page.getByLabel("Competência do serviço",{exact:true}).fill("2026-10-28");await page.getByRole("button",{name:"Preparar rascunho",exact:true}).click();await expect.poll(()=>seen).toBe(true);await page.getByLabel("Empresa",{exact:true}).selectOption("");release();await expect(page.getByText("Selecione uma empresa para continuar.",{exact:true})).toBeVisible();await expect(page.getByText("Você não tem permissão para realizar esta ação.",{exact:true})).toHaveCount(0);}finally{release();}
});
test("NFSDP-UI03 usuário sem consulta fiscal não dispara consulta nem exibe formulários",async({page})=>{
 const calls=await api(page,false,["customers.read"]);await page.goto("/fiscal/");await expect(page.getByText("Seu perfil não tem permissão para consultar o fiscal.",{exact:true})).toBeVisible();expect(calls.filter(call=>call.path.includes("/fiscal/"))).toHaveLength(0);
});
test("NFSDP-UI07 documento ausente é cadastrado na mesma OS e permite continuar",async({page})=>{
 await api(page,true);let saved=0,document:unknown=null;
 await page.route("**/fiscal/customers/*",async route=>{if(route.request().method()==="OPTIONS"){await route.fulfill({status:204,headers:{"access-control-allow-origin":"http://127.0.0.1:3000","access-control-allow-credentials":"true","access-control-allow-headers":"content-type","access-control-allow-methods":"GET,PATCH,OPTIONS"}});return;}if(route.request().method()==="PATCH"){saved++;document=route.request().postDataJSON().document;}await route.fulfill({headers:{"access-control-allow-origin":"http://127.0.0.1:3000","access-control-allow-credentials":"true"},json:{customerFiscal:{version:document?1:0,fields:{document,address:null}}}});});
 await page.goto("/fiscal/");await page.getByLabel("Buscar ordem de serviço",{exact:true}).fill("QA001");await page.getByRole("option",{name:/OS-QA001/}).click();await page.getByLabel("Tipo de documento",{exact:true}).selectOption("CPF");await page.getByLabel("Documento do tomador",{exact:true}).fill("52998224725");await page.getByRole("button",{name:"Salvar identificação",exact:true}).click();await expect(page.getByText("Identificação fiscal salva para as próximas ordens.",{exact:true})).toBeVisible();expect(saved).toBe(1);await expect(page.getByLabel("Buscar ordem de serviço",{exact:true})).toHaveValue("OS-QA001");
});
test("NFSDP-UI08 controles permanecem dentro da tela ao reduzir desktop para 320px",async({page},info)=>{
 await api(page,true);await page.goto("/fiscal/");await page.getByLabel("Buscar ordem de serviço",{exact:true}).fill("QA001");await page.getByRole("option",{name:/OS-QA001/}).click();await page.setViewportSize({width:320,height:1000});await page.getByRole("button",{name:"Abrir navegação",exact:true}).click({trial:true});
 const outside=await page.locator("#main-content").evaluate(root=>[...root.querySelectorAll("input,select,textarea,button,p,h1,h2,summary")].filter(element=>element.getClientRects().length>0).flatMap(element=>{const r=element.getBoundingClientRect();return r.left < -1 || r.right > innerWidth+1 ? [{tag:element.tagName,left:Math.round(r.left),right:Math.round(r.right)}]:[];}));expect(outside).toEqual([]);await page.screenshot({path:info.outputPath("fiscal-prepare-mobile.png"),fullPage:true});
});
