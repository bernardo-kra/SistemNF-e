"use client";
import { useEffect,useRef,useState } from "react";
import { Field } from "@/components/ui";
import { accessBase,accessDate,accessRequest,AccessError } from "@/lib/access-api";
import { money } from "@/lib/domain";
import { simulationScenarios,simulationStates,type FiscalSimulation,type SimulationPage,type SimulationScenario } from "../../shared/fiscal-simulation.mjs";
import styles from "./connected-fiscal.module.css";

type Order={id:string;number:number|string;version:number;customerName:string;approved:boolean;laborCents:number|null};
type Availability={tenantId:string;enabled:boolean;environment:"simulation";officialAuthorization:false};
export function FiscalSimulator({tenant,onAccessError}:{tenant:string;onAccessError:(reason:unknown)=>void}){
 const [availability,setAvailability]=useState<Availability|null>(null),[query,setQuery]=useState(""),[orders,setOrders]=useState<Order[]>([]),[order,setOrder]=useState<Order|null>(null);
 const [scenario,setScenario]=useState<SimulationScenario>("accepted"),[history,setHistory]=useState<SimulationPage|null>(null),[offset,setOffset]=useState(0),[reload,setReload]=useState(0);
 const [result,setResult]=useState<FiscalSimulation|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const attempt=useRef<{key:string;id:string}|null>(null),live=useRef(true),errorHandler=useRef(onAccessError);errorHandler.current=onAccessError;
 const base=`${accessBase(tenant)}/fiscal/simulations`;
 function failure(reason:unknown){if(!live.current)return;setError(reason instanceof Error?reason.message:"Não foi possível concluir a simulação.");if(reason instanceof AccessError&&[401,403].includes(reason.status))errorHandler.current(reason);}
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 useEffect(()=>{const controller=new AbortController();void accessRequest<Availability>(base+"/config",{signal:controller.signal}).then(value=>{
  if(controller.signal.aborted)return;if(value.tenantId!==tenant||value.environment!=="simulation"||value.officialAuthorization!==false||typeof value.enabled!=="boolean")throw new AccessError(503);setAvailability(value);
 }).catch(reason=>{if(!controller.signal.aborted)failure(reason);});return()=>controller.abort();},[base,tenant,reload]);
 useEffect(()=>{
  if(!availability?.enabled||order)return;const controller=new AbortController(),timer=setTimeout(()=>{
   void accessRequest<{tenantId:string;items:Order[]}>(`${accessBase(tenant)}/operations/orders?q=${encodeURIComponent(query)}&limit=10`,{signal:controller.signal}).then(value=>{if(!controller.signal.aborted){if(value.tenantId!==tenant)throw new AccessError(503);setOrders(value.items);}}).catch(reason=>{if(!controller.signal.aborted)failure(reason);});
  },300);return()=>{clearTimeout(timer);controller.abort();};
 },[tenant,availability?.enabled,order,query]);
 useEffect(()=>{
  setHistory(null);if(!order)return;const controller=new AbortController();
  void accessRequest<SimulationPage>(`${base}?orderId=${order.id}&offset=${offset}`,{signal:controller.signal}).then(value=>{if(!controller.signal.aborted){if(value.tenantId!==tenant)throw new AccessError(503);value.items.forEach(checkDocument);setHistory(value);}}).catch(reason=>{if(!controller.signal.aborted)failure(reason);});
  return()=>controller.abort();
 },[base,tenant,order,offset,reload]);
 function checkDocument(value:FiscalSimulation){if(value.tenantId!==tenant||value.environment!=="simulation"||value.provider!=="local_simulator"||value.officialAuthorization!==false||!value.reference.startsWith("SIM-")||!Object.hasOwn(simulationStates,value.state))throw new AccessError(503);}
 async function run(document?:FiscalSimulation){
  if(busy||!order)return;const path=document?`${base}/${document.id}/reconcile`:base;
  const data=document?{version:document.version}:{orderId:order.id,orderVersion:order.version,scenario};
  const key=JSON.stringify({path,data});if(attempt.current?.key!==key)attempt.current={key,id:crypto.randomUUID()};
  setBusy(true);setError("");
  try{const response=await accessRequest<{document:FiscalSimulation}>(path,{method:"POST",body:{requestId:attempt.current.id,...data}});if(!live.current)return;checkDocument(response.document);setResult(response.document);
   if(offset)setOffset(0);else setHistory(previous=>{
    if(!previous)return previous;
    const existing=previous.items.some(row=>row.id===response.document.id);
    const items=previous.items.map(row=>row.id===response.document.id?response.document:row);
    // Reconciliation updates an existing record; it never changes page membership.
    if(document||existing)return {...previous,items};
    return {...previous,items:[response.document,...items].slice(0,previous.limit),total:previous.total+1};
   });
  }catch(reason){failure(reason);}finally{if(live.current)setBusy(false);}
 }
 function choose(value:Order){setOrder(value);setOrders([]);setOffset(0);setResult(null);setError("");attempt.current=null;}
 return <section aria-label="Simulador de emissão">
  <h2>Simulador de emissão</h2><p className={styles.note}><strong>Simulação — sem validade fiscal</strong></p>
  <p>Nenhum dado é enviado à SEFAZ ou prefeitura. CNPJ e certificado não são necessários para este teste do fluxo.</p>
  {error&&<p role="alert">{error}</p>}
  {!availability?<><p>Verificando disponibilidade…</p>{error&&<button className="button button-secondary" onClick={()=>{setError("");setReload(value=>value+1);}}>Tentar novamente</button>}</>:!availability.enabled?<p>O simulador não está ativado neste ambiente.</p>:<>
   {!order?<><Field label="OS para simular"><input role="combobox" aria-expanded={orders.length>0} aria-controls="simulation-orders" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Número ou cliente"/></Field>
    <div id="simulation-orders" role="listbox" aria-label="OS encontradas para simulação" className={styles.results}>{orders.map(value=><button role="option" aria-selected={false} className="button button-secondary" key={value.id} onClick={()=>choose(value)}>OS {value.number} · {value.customerName}</button>)}</div></>:<>
    <p><strong>OS {order.number} · {order.customerName}</strong></p><p>Serviço aprovado: {order.approved&&order.laborCents!=null?money(order.laborCents):"Ainda não está pronto para simular"}</p>
    <button className="button button-secondary" disabled={busy} onClick={()=>{setOrder(null);setResult(null);setQuery("");setError("");}}>Trocar OS</button>
    <Field label="Cenário de teste"><select aria-label="Cenário de teste" disabled={busy} value={scenario} onChange={event=>setScenario(event.target.value as SimulationScenario)}>{Object.entries(simulationScenarios).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></Field>
    <div className={styles.actions}><button className="button button-primary" disabled={busy||!history||!order.approved||!order.laborCents} onClick={()=>void run()}>Simular emissão</button><button className="button button-secondary" disabled={busy} onClick={()=>{setError("");setReload(value=>value+1);}}>Atualizar histórico</button></div>
    {result&&<div role="status"><h3>{simulationStates[result.state]}</h3><p>{result.reference}</p><p>{money(result.source.amountCents)} · {accessDate(result.updatedAt)}</p>{result.state==="simulated_unknown"&&<button className="button button-primary" disabled={busy} onClick={()=>void run(result)}>Consultar resultado simulado</button>}</div>}
    {!history?<p>Carregando histórico de simulações…</p>:<><h3>Histórico de simulações</h3><p>{history.total} {history.total===1?"simulação":"simulações"}</p>{history.items.filter(value=>value.id!==result?.id).map(value=><div key={value.id}><strong>{simulationStates[value.state]}</strong><p>{value.reference} · {money(value.source.amountCents)}</p><button className="button button-secondary" disabled={busy} onClick={()=>setResult(value)}>Abrir simulação</button></div>)}
     <div className={styles.actions}><button disabled={busy||!offset} onClick={()=>setOffset(value=>Math.max(0,value-25))}>Anterior</button><button disabled={busy||offset+25>=history.total} onClick={()=>setOffset(value=>value+25)}>Próxima</button></div></>}
    {result&&<details><summary>Eventos desta simulação</summary><ol>{result.events.map(event=><li key={event.version}>{event.kind==="created"?"Simulação registrada":"Resultado simulado consultado"} · {event.actorName} · {accessDate(event.at)}</li>)}</ol></details>}
   </>}
  </>}
 </section>;
}
