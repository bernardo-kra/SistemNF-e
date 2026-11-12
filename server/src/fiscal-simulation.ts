import { createHash,randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { simulationScenarios,type FiscalSimulation,type SimulationScenario,type SimulationState,type SimulationPage } from "../../shared/fiscal-simulation.mjs";
import { allowedKeys,inputRecord,requireUuid } from "./customers.js";
import { conflict,invalidInput,notFound,unavailable,ApiError } from "./errors.js";
import { withDpsTransaction,type DpsJournalAccess } from "./nfse-dps-journal.js";

type Access=DpsJournalAccess & {actorName?:string};
type Row={id:string;tenant_id:string;reference:string;source_id:string;source_version:number;snapshot:FiscalSimulation["source"];scenario:SimulationScenario;state:SimulationState;version:number;created_by:string;created_at:Date|string;updated_at:Date|string;events:{version:number;kind:"created"|"reconciled";actor_id:string;actor_name:string;at:string}[]};
const columns="id,tenant_id,reference,source_id,source_version,snapshot,scenario,state,version,created_by,created_at,updated_at";
const context=(access:Access)=>({...access,tenantId:requireUuid(access.tenantId)});
function version(value:unknown){if(!Number.isSafeInteger(value)||Number(value)<1||Number(value)>2147483647)throw invalidInput();return value as number;}
function pageInteger(value:unknown,fallback:number,min:number,max:number){if(value===undefined)return fallback;if(typeof value!=="string"||!/^\d+$/.test(value))throw invalidInput();const parsed=Number(value);if(!Number.isSafeInteger(parsed)||parsed<min||parsed>max)throw invalidInput();return parsed;}
const hash=(data:unknown)=>createHash("sha256").update(JSON.stringify(data)).digest("hex");
const eventSql = "COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.version) FROM fiscal_simulation_events e WHERE e.tenant_id=d.tenant_id AND e.simulation_id=d.id),'[]'::jsonb) AS events";
const iso=(value:Date|string)=>(value instanceof Date?value:new Date(value)).toISOString();
function projection(row:Row):FiscalSimulation{
 return{id:row.id,tenantId:row.tenant_id,reference:row.reference,environment:"simulation",provider:"local_simulator",model:"NFS-e",officialAuthorization:false,state:row.state,version:row.version,scenario:row.scenario,source:row.snapshot,createdBy:row.created_by,createdAt:iso(row.created_at),updatedAt:iso(row.updated_at),events:row.events.map(event=>({version:event.version,kind:event.kind,actorId:event.actor_id,actorName:event.actor_name,at:iso(event.at)}))};
}
async function document(client:PoolClient,access:Access,id:string):Promise<FiscalSimulation>{
 const row=(await client.query<Row>(`SELECT ${columns},${eventSql} FROM fiscal_simulations d WHERE tenant_id=$1 AND id=$2`,[access.tenantId,id])).rows[0];if(!row)throw notFound();return projection(row);
}
async function previous(client:PoolClient,access:Access,id:string,command:string,fingerprint:string){
 const row=(await client.query("SELECT tenant_id,actor_id,command,fingerprint,simulation_id FROM fiscal_simulation_requests WHERE id=$1",[id])).rows[0];if(!row)return null;
 if(row.tenant_id!==access.tenantId||row.actor_id!==access.actorId||row.command!==command||row.fingerprint!==fingerprint)throw conflict();return document(client,access,row.simulation_id);
}
async function link(client:PoolClient,access:Access,id:string,command:string,fingerprint:string,simulationId:string){
 await client.query("INSERT INTO fiscal_simulation_requests(id,tenant_id,actor_id,command,fingerprint,simulation_id) VALUES($1,$2,$3,$4,$5,$6)",[id,access.tenantId,access.actorId,command,fingerprint,simulationId]);
}
async function event(client:PoolClient,access:Access,id:string,version:number,kind:"created"|"reconciled",state:SimulationState,at:Date){
 await client.query("INSERT INTO fiscal_simulation_events(tenant_id,simulation_id,version,kind,actor_id,actor_name,at) VALUES($1,$2,$3,$4,$5,$6,$7)",[access.tenantId,id,version,kind,access.actorId,access.actorName??access.actorId,at]);
 await client.query(`INSERT INTO audit_events(id,tenant_id,actor_id,action,entity_type,entity_id,entity_version,at,field_names,after_values)
 VALUES($1,$2,$3,$4,'fiscal_simulation',$5,$6,$7,ARRAY['state','simulation'],$8)`,[randomUUID(),access.tenantId,access.actorId,`fiscal.simulation.${kind==='created'?'create':'reconcile'}`,id,version,at,JSON.stringify({state,environment:"simulation",officialAuthorization:false})]);
}
/** Closed simulator only. Does not import any HTTP, certificate or official DPS writer. */
export async function startFiscalSimulation(rawAccess:Access,raw:unknown){
 const access=context(rawAccess),body=inputRecord(raw);allowedKeys(body,["requestId","orderId","orderVersion","scenario"]);
 const requestId=requireUuid(body.requestId),orderId=requireUuid(body.orderId),orderVersion=version(body.orderVersion);
 if(typeof body.scenario!=="string"||!Object.hasOwn(simulationScenarios,body.scenario))throw invalidInput();const scenario=body.scenario as SimulationScenario;
 const fingerprint=hash({command:"start",orderId,orderVersion,scenario});
 return withDpsTransaction(access,true,async client=>{
  const replay=await previous(client,access,requestId,"start",fingerprint);if(replay)return replay;
  // Recover the immutable snapshot before validating eligibility for a new simulation.
  const found=(await client.query("SELECT id FROM fiscal_simulations WHERE tenant_id=$1 AND source_id=$2 AND source_version=$3 AND scenario=$4",[access.tenantId,orderId,orderVersion,scenario])).rows[0];
  if(found){await link(client,access,requestId,"start",fingerprint,found.id);return document(client,access,found.id);}
  const source=(await client.query("SELECT body,version FROM operational_records WHERE entity_type='order' AND id=$1 FOR SHARE",[orderId])).rows[0];if(!source)throw notFound();
  if(source.version!==orderVersion)throw conflict();
  if(source.body.approved!==true||!Number.isSafeInteger(source.body.laborCents)||source.body.laborCents<=0||source.body.laborCents>1000000000000)throw new ApiError(409,"SIMULATION_SOURCE_NOT_READY","Selecione uma OS com serviço aprovado e valor positivo para testar a emissão.");
  if(typeof source.body.customerName!=="string"||!["string","number"].includes(typeof source.body.number))throw unavailable();
  const snapshot={orderId,orderVersion,orderNumber:String(source.body.number),customerName:source.body.customerName,amountCents:source.body.laborCents};
  const id=randomUUID(),at=(await client.query("SELECT clock_timestamp() AS at")).rows[0].at as Date;
  const state:SimulationState=scenario==="accepted"?"simulated_accepted":scenario==="rejected"?"simulated_rejected":"simulated_unknown";
  await client.query(`INSERT INTO fiscal_simulations(id,tenant_id,reference,source_id,source_version,snapshot,scenario,state,version,created_by,updated_by,created_at,updated_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$9,$10,$10)`,[id,access.tenantId,`SIM-${id}`,orderId,orderVersion,JSON.stringify(snapshot),scenario,state,access.actorId,at]);
  await event(client,access,id,1,"created",state,at);await link(client,access,requestId,"start",fingerprint,id);return document(client,access,id);
 });
}
export async function reconcileFiscalSimulation(rawAccess:Access,rawId:unknown,raw:unknown){
 const access=context(rawAccess),id=requireUuid(rawId),body=inputRecord(raw);allowedKeys(body,["requestId","version"]);const requestId=requireUuid(body.requestId),expected=version(body.version),fingerprint=hash({command:"reconcile",id,version:expected});
 return withDpsTransaction(access,true,async client=>{
  const replay=await previous(client,access,requestId,"reconcile",fingerprint);if(replay)return replay;
  const current=await document(client,access,id);if(current.version!==expected||current.state!=="simulated_unknown")throw conflict();
  const at=(await client.query("SELECT clock_timestamp() AS at")).rows[0].at as Date;
  await client.query("UPDATE fiscal_simulations SET state='simulated_accepted',version=2,updated_by=$3,updated_at=$4 WHERE tenant_id=$1 AND id=$2",[access.tenantId,id,access.actorId,at]);
  await event(client,access,id,2,"reconciled","simulated_accepted",at);await link(client,access,requestId,"reconcile",fingerprint,id);return document(client,access,id);
 });
}
export function getFiscalSimulation(rawAccess:Access,rawId:unknown){const access=context(rawAccess),id=requireUuid(rawId);return withDpsTransaction(access,false,client=>document(client,access,id));}
export function listFiscalSimulations(rawAccess:Access,raw:unknown):Promise<SimulationPage>{
 const access=context(rawAccess),query=inputRecord(raw);allowedKeys(query,["orderId","limit","offset"]);const orderId=requireUuid(query.orderId),limit=pageInteger(query.limit,25,1,100),offset=pageInteger(query.offset,0,0,2147483646);
 return withDpsTransaction(access,false,async client=>{
  const page=(await client.query<{total:string;items:Row[]}>(`WITH selected AS(
    SELECT ${columns} FROM fiscal_simulations WHERE tenant_id=$1 AND source_id=$2
  ), page AS(SELECT * FROM selected ORDER BY created_at DESC,id DESC LIMIT $3 OFFSET $4),
  presented AS(SELECT d.*,${eventSql} FROM page d)
  SELECT (SELECT count(*)::text FROM selected) AS total,COALESCE(jsonb_agg(to_jsonb(presented) ORDER BY created_at DESC,id DESC),'[]'::jsonb) AS items FROM presented`,[access.tenantId,orderId,limit,offset])).rows[0];
  const total=Number(page.total);if(!Number.isSafeInteger(total))throw unavailable();
  return{tenantId:access.tenantId,items:page.items.map(projection),total,limit,offset};
 });
}
export function fiscalSimulationConfig(access:Access,enabled:boolean){return withDpsTransaction(access,false,async()=>({tenantId:requireUuid(access.tenantId),enabled,environment:"simulation" as const,officialAuthorization:false as const}));}
