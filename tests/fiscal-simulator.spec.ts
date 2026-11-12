import { expect,test,type Page } from "@playwright/test";
const tenant="10000000-0000-4000-8000-000000000001",orderId="20000000-0000-4000-8000-000000000002",docId="30000000-0000-4000-8000-000000000003";
async function api(page:Page,options:{enabled?:boolean;allowed?:boolean;failOnce?:boolean}={}){
 const calls:{path:string;method:string}[]=[],commands:any[]=[];let current:any=null;
 await page.route("http://127.0.0.1:4000/**",async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname,method=request.method();calls.push({path,method});let json:any={};
  if(path.endsWith("/me"))json={user:{id:"qa",name:"Pessoa QA",email:"qa@example.test"},tenants:[{id:tenant,name:"Loja QA",role:"owner",permissions:["fiscal.read","orders.read",...(options.allowed===false?[]:["fiscal.simulate"])]}]};
  else if(path.endsWith("/branding"))json={branding:{version:0,logo:null,background:null,backgroundOpacity:10}};
  else if(path.endsWith("/profile"))json={profile:{version:0,fields:{},missingFields:["cnpj","regime"],unsupportedFields:[],preparationReady:false}};
  else if(path.endsWith("/readiness"))json={tenantId:tenant,environment:"production-restricted",readyForSubmission:false,setup:{profileComplete:false,certificateRegistered:false,certificateCurrentForIssuer:false,storageConfigured:false},technicalBlockers:[]};
  else if(path.endsWith("/simulations/config"))json={tenantId:tenant,enabled:options.enabled!==false,environment:"simulation",officialAuthorization:false};
  else if(path.endsWith("/operations/orders"))json={tenantId:tenant,items:[{id:orderId,number:123,version:4,customerName:"Cliente QA",approved:true,laborCents:1250}],total:1};
  else if(path.includes("/simulations")&&method==="POST"){
   const data=request.postDataJSON();commands.push({path,data});
   if(options.failOnce&&commands.length===1){await route.fulfill({status:503,json:{error:{code:"SERVICE_UNAVAILABLE"}}});return;}
   const reconciled=path.endsWith("/reconcile");
   current={id:docId,tenantId:tenant,reference:`SIM-${docId}`,environment:"simulation",provider:"local_simulator",model:"NFS-e",officialAuthorization:false,version:reconciled?2:1,
    state:reconciled?"simulated_accepted":data.scenario==="unknown_after_accept"?"simulated_unknown":data.scenario==="rejected"?"simulated_rejected":"simulated_accepted",
    source:{orderId,orderVersion:4,orderNumber:"123",customerName:"Cliente QA",amountCents:1250},createdBy:"qa",createdAt:"2026-11-09T12:00:00Z",updatedAt:"2026-11-09T12:00:00Z",
    events:[{version:1,kind:"created",actorId:"qa",actorName:"Pessoa QA",at:"2026-11-09T12:00:00Z"}]};json={document:current};
  }else if(path.includes("/simulations"))json={tenantId:tenant,items:current?[current]:[],total:current?1:0,limit:25,offset:0};
  await route.fulfill({json});
 });return{calls,commands};
}
async function selectOrder(page:Page){await page.getByRole("button",{name:"Simulador",exact:true}).click();await page.getByRole("combobox",{name:"OS para simular",exact:true}).fill("123");await page.getByRole("option",{name:/123.*Cliente QA/}).click();}
for(const width of [1440,320])test(`SIM-UI01 simula sem CNPJ/A1, uma confirmação e rótulo inequívoco em ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:1000});const state=await api(page);await page.goto("/fiscal/");await selectOrder(page);
 await expect(page.getByText("Simulação — sem validade fiscal",{exact:true})).toBeVisible();
 await expect(page.getByLabel("CNPJ do prestador",{exact:true})).toHaveCount(0);await expect(page.getByLabel("Arquivo do certificado A1",{exact:true})).toHaveCount(0);
 const save=page.getByRole("button",{name:"Simular emissão",exact:true});await save.scrollIntoViewIfNeeded();const box=await save.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(width);
 await save.click();await expect(page.getByText("Aceite simulado — sem validade fiscal",{exact:true})).toBeVisible();
 expect(state.commands).toHaveLength(1);expect(state.commands[0].data).toMatchObject({orderId,orderVersion:4,scenario:"accepted"});
 expect(state.calls.some(call=>call.path.includes("/fiscal/customers/")||call.path.endsWith("/draft"))).toBe(false);
 await page.screenshot({path:info.outputPath(`fiscal-simulator-${width}.png`),fullPage:true});
});
test("SIM-UI02 resultado desconhecido é consultado sem novo envio",async({page})=>{
 const state=await api(page);await page.goto("/fiscal/");await selectOrder(page);await page.getByLabel("Cenário de teste",{exact:true}).selectOption("unknown_after_accept");
 expect(state.commands).toHaveLength(0);await page.getByRole("button",{name:"Simular emissão",exact:true}).click();await expect(page.getByText("Resultado simulado desconhecido",{exact:true})).toBeVisible();
 await page.getByRole("button",{name:"Consultar resultado simulado",exact:true}).click();await expect(page.getByText("Aceite simulado — sem validade fiscal",{exact:true})).toBeVisible();
 expect(state.commands).toHaveLength(2);expect(state.commands[1].path).toContain(`/${docId}/reconcile`);expect(state.commands[1].data.version).toBe(1);
});
test("SIM-UI03 falha preserva escolha/ID e rejeição permanece rotulada como simulada",async({page})=>{
 const state=await api(page,{failOnce:true});await page.goto("/fiscal/");await selectOrder(page);await page.getByLabel("Cenário de teste",{exact:true}).selectOption("rejected");
 await page.getByRole("button",{name:"Simular emissão",exact:true}).click();await expect(page.getByRole("alert").filter({hasText:/Não foi possível/})).toBeVisible();
 await expect(page.getByLabel("Cenário de teste",{exact:true})).toHaveValue("rejected");await page.getByRole("button",{name:"Simular emissão",exact:true}).click();
 await expect(page.getByText("Rejeição simulada — sem validade fiscal",{exact:true})).toBeVisible();expect(state.commands[0].data).toEqual(state.commands[1].data);
});
test("SIM-UI04 configuração desativada ou falta de direito não permitem simular",async({page})=>{
 await api(page,{enabled:false});await page.goto("/fiscal/");await page.getByRole("button",{name:"Simulador",exact:true}).click();await expect(page.getByText("O simulador não está ativado neste ambiente.",{exact:true})).toBeVisible();await expect(page.getByRole("button",{name:"Simular emissão",exact:true})).toHaveCount(0);
 await page.unrouteAll({behavior:"wait"});const state=await api(page,{allowed:false});await page.goto("/fiscal/");await expect(page.getByRole("button",{name:"Simulador",exact:true})).toHaveCount(0);expect(state.calls.some(call=>call.path.includes("/simulations"))).toBe(false);
});

test("SIM-UI05 consultar uma simulação aberta em outra página preserva o total",async({page})=>{
 await api(page);const unknown={id:docId,tenantId:tenant,reference:`SIM-${docId}`,environment:"simulation",provider:"local_simulator",model:"NFS-e",officialAuthorization:false,version:1,state:"simulated_unknown",source:{orderId,orderVersion:4,orderNumber:"123",customerName:"Cliente QA",amountCents:1250},createdBy:"qa",createdAt:"2026-11-09T12:00:00Z",updatedAt:"2026-11-09T12:00:00Z",events:[]};
 await page.route("**/fiscal/simulations?*",async route=>{const offset=Number(new URL(route.request().url()).searchParams.get("offset")??0);await route.fulfill({json:{tenantId:tenant,items:offset?[unknown]:Array.from({length:25},(_,index)=>({...unknown,id:`old-${index}`,reference:`SIM-old-${index}`,state:"simulated_accepted"})),total:26,limit:25,offset}});});
 await page.goto("/fiscal/");await selectOrder(page);await page.getByRole("button",{name:"Próxima",exact:true}).click();await page.getByRole("button",{name:"Abrir simulação",exact:true}).click();
 await page.getByRole("button",{name:"Anterior",exact:true}).click();await expect(page.getByText("26 simulações",{exact:true})).toBeVisible();await expect(page.getByRole("button",{name:"Abrir simulação",exact:true})).toHaveCount(25);
 await page.getByRole("button",{name:"Consultar resultado simulado",exact:true}).click();await expect(page.getByText("Aceite simulado — sem validade fiscal",{exact:true}).first()).toBeVisible();
 await expect(page.getByText("26 simulações",{exact:true})).toBeVisible();
 await expect(page.getByRole("button",{name:"Abrir simulação",exact:true})).toHaveCount(25);
});
