import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { ApiConfig } from "./config.js";
import { ApiError, forbidden, conflict, invalidInput, unavailable } from "./errors.js";
import { allowedKeys, inputRecord, requireUuid } from "./customers.js";
import type { createAccountsService } from "./accounts.js";

const capacityError = () => new ApiError(409,"CAPACITY_UNAVAILABLE","Não há vaga preparada para uma nova empresa no momento.");
const quoted = (value:string) => `"${value.replaceAll('"','""')}"`;
async function transaction<T>(pool:Pool, action:(client:PoolClient)=>Promise<T>) {
  const client=await pool.connect();
  try { await client.query("BEGIN"); await client.query("SET LOCAL statement_timeout='5000ms'; SET LOCAL lock_timeout='3000ms'");
    const result=await action(client); await client.query("COMMIT"); return result;
  } catch(error) { await client.query("ROLLBACK").catch(()=>{}); throw error; } finally { client.release(); }
}
async function controlled<T>(action:()=>Promise<T>) {
  try{return await action();}catch(error){if(error instanceof ApiError)throw error;throw unavailable();}
}

/** Explicit administrative connection only. Never called by HTTP; never adopts another account. */
export async function configurePlatformAdministrator(pool:Pool,userId:string,active:boolean) {
  if(typeof userId!=="string"||!userId||userId.length>200||typeof active!=="boolean")throw new Error("Informe a conta administrativa explicitamente.");
  return transaction(pool,async(client)=>{
    await client.query("SELECT pg_advisory_xact_lock(731245)");
    const user=await client.query('SELECT u.id FROM "user" u WHERE u.id=$1 AND EXISTS(SELECT 1 FROM account a WHERE a."userId"=u.id AND a."providerId"=\'credential\' AND a.password IS NOT NULL)',[userId]);
    if(!user.rowCount)throw new Error("Conta com credencial não encontrada.");
    const previous=(await client.query("SELECT user_id,active,version FROM platform_administrator WHERE singleton=true FOR UPDATE")).rows[0];
    if(previous&&previous.user_id!==userId)throw new Error("Já existe outra conta administrativa. Nenhuma substituição foi aplicada.");
    if(previous?.active===active)return;
    if(!previous&&!active)throw new Error("Não há concessão a revogar.");
    const version=previous?previous.version+1:1;
    await client.query("INSERT INTO platform_administrator(singleton,user_id,active,version) VALUES(true,$1,$2,$3) ON CONFLICT(singleton) DO UPDATE SET active=EXCLUDED.active,version=EXCLUDED.version,configured_at=clock_timestamp()",[userId,active,version]);
    await client.query("INSERT INTO platform_administrator_events(id,user_id,active,version,source) VALUES($1,$2,$3,$4,'administrative-cli')",[randomUUID(),userId,active,version]);
  });
}

async function emptyDatabase(connection:Pick<Pool,"query">|PoolClient) {
  const tables=await connection.query<{tablename:string}>("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('schema_migrations','sistem_environment','tenant_admission','operational_coordination')");
  const clauses=tables.rows.map(row=>`EXISTS(SELECT 1 FROM public.${quoted(row.tablename)} LIMIT 1)`);
  clauses.push("EXISTS(SELECT 1 FROM operational_coordination WHERE id<>1 OR sale_number<>0 OR order_number<>0)");
  return !(await connection.query(`SELECT ${clauses.join(" OR ")} AS occupied`)).rows[0].occupied;
}

/** A migration credential marks an explicitly selected EMPTY database; no database is created here. */
export async function prepareCompanySlot(pool:Pool) {
  return transaction(pool,async(client)=>{
    await client.query("SELECT pg_advisory_xact_lock(731246)");
    const versions=await client.query("SELECT version FROM schema_migrations WHERE version IN ('tenant_001','tenant_002','tenant_003','tenant_004')");
    if(versions.rowCount!==4||!await emptyDatabase(client))throw new Error("O banco precisa estar migrado e vazio para preparar uma vaga.");
    const existing=(await client.query("SELECT slot_id,tenant_id FROM tenant_admission WHERE singleton=true FOR UPDATE")).rows[0];
    if(existing?.tenant_id)throw new Error("O banco já foi vinculado; seus dados foram preservados.");
    if(existing)return existing.slot_id as string;
    const id=randomUUID();await client.query("INSERT INTO tenant_admission(singleton,slot_id) VALUES(true,$1)",[id]);return id;
  });
}

type Intent={request_id:string;tenant_id:string;actor_id:string;slot_id:string;fingerprint:string;owner_name:string;owner_email:string;completed_at:Date|null;database_key:string};
type Input={requestId:string;name:string;owner:{name:string;email:string;password:string}};
function text(value:unknown,max:number) {if(typeof value!=="string"||!value.trim()||value.trim().length>max)throw invalidInput();return value.trim();}
function parse(raw:unknown):Input {
  const data=inputRecord(raw);allowedKeys(data,["requestId","name","owner"]);
  const owner=inputRecord(data.owner);allowedKeys(owner,["name","email","password"]);
  const email=text(owner.email,254).toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)||typeof owner.password!=="string"||owner.password.length<12||owner.password.length>128||!owner.password.trim())throw invalidInput("Confira o e-mail e a senha inicial do gestor.");
  return {requestId:requireUuid(data.requestId),name:text(data.name,120),owner:{name:text(owner.name,120),email,password:owner.password}};
}
export function createAdministrationService(pool:Pool,config:ApiConfig,tenantPool:(key:string)=>Pool,accounts:ReturnType<typeof createAccountsService>) {
  async function isAdministrator(userId:string) {
    return controlled(async()=>Boolean((await pool.query("SELECT user_id FROM platform_administrator WHERE singleton=true AND user_id=$1 AND active=true",[userId])).rowCount));
  }
  async function assertAdministrator(userId:string,client?:PoolClient) {
    const query=client??pool;
    if(client)await client.query("SELECT pg_advisory_xact_lock_shared(731245)");
    if(!(await query.query("SELECT user_id FROM platform_administrator WHERE singleton=true AND user_id=$1 AND active=true",[userId])).rowCount)throw forbidden();
  }
  async function slots(connection:Pick<Pool,"query">|PoolClient=pool) {
    const usedKeys=new Set((await connection.query("SELECT database_key FROM tenants")).rows.map(row=>row.database_key));
    const usedIds=new Set((await connection.query("SELECT slot_id FROM company_onboarding")).rows.map(row=>row.slot_id));
    const result:{key:string;id:string}[]=[],seen=new Set<string>();
    for(const key of Object.keys(config.tenantDatabaseUrls)) {
      if(usedKeys.has(key))continue;
      const target=tenantPool(key);
      const marker=await target.query("SELECT to_regclass('public.tenant_admission') AS name");
      if(!marker.rows[0].name)continue;
      const row=(await target.query("SELECT slot_id,tenant_id FROM tenant_admission WHERE singleton=true")).rows[0];
      if(!row||row.tenant_id||usedIds.has(row.slot_id)||seen.has(row.slot_id))continue;
      if(!await emptyDatabase(target))continue;
      result.push({key,id:row.slot_id});seen.add(row.slot_id);
    }
    return result;
  }
  const selectIntent="SELECT c.*,t.database_key FROM company_onboarding c JOIN tenants t ON t.id=c.tenant_id";
  async function company(connection:Pick<Pool,"query">|PoolClient,id:string) {
    const row=(await connection.query(`SELECT t.id,t.name,t.active,c.request_id,c.owner_name,c.owner_email,c.created_at,c.completed_at,
      owner.user_id,owner.name AS user_name,owner.email AS user_email FROM tenants t LEFT JOIN company_onboarding c ON c.tenant_id=t.id
      LEFT JOIN LATERAL(SELECT m.user_id,u.name,u.email FROM memberships m JOIN "user" u ON u.id=m.user_id WHERE m.tenant_id=t.id AND m.role='owner' AND m.active=true ORDER BY m.created_at NULLS LAST,u.id LIMIT 1) owner ON true WHERE t.id=$1`,[id])).rows[0];
    if(!row)throw unavailable();
    return {id:row.id,name:row.name,status:row.active?"active":row.request_id?"pending":"inactive",owner:{...(row.user_id?{id:row.user_id}:{}),name:row.user_id?row.user_name:row.owner_name??"Não informado",email:row.user_id?row.user_email:row.owner_email??""},...(row.request_id&&!row.completed_at?{requestId:row.request_id}:{}),createdAt:row.created_at?.toISOString()??null};
  }
  async function list(actorId:string,raw:unknown) {return controlled(async()=>{
    await assertAdministrator(actorId);
    const q=inputRecord(raw);allowedKeys(q,["q","limit","offset"]);
    const search=q.q===undefined?"":typeof q.q==="string"&&q.q.length<=100?q.q.trim():(()=>{throw invalidInput();})();
    const number=(value:unknown,fallback:number,max:number)=>value===undefined?fallback:typeof value==="string"&&/^\d+$/.test(value)&&Number(value)<=max?Number(value):(()=>{throw invalidInput();})();
    const limit=number(q.limit,25,100),offset=number(q.offset,0,10000);if(limit<1)throw invalidInput();
    const values=[`%${search.replace(/[\\%_]/g,"\\$&")}%`];
    const count=(await pool.query("SELECT count(*)::int total FROM tenants WHERE name ILIKE $1",values)).rows[0].total;
    const rows=await pool.query("SELECT id FROM tenants WHERE name ILIKE $1 ORDER BY name,id LIMIT $2 OFFSET $3",[...values,limit,offset]);
    const items=[];for(const row of rows.rows)items.push(await company(pool,row.id));
    const available=(await slots()).length;await assertAdministrator(actorId);
    return {items,total:count,limit,offset,capacity:{available}};
  });}
  async function create(actorId:string,raw:unknown) {return controlled(async()=>{
    await assertAdministrator(actorId);const data=parse(raw);
    const digest=createHash("sha256").update(JSON.stringify({name:data.name,owner:{name:data.owner.name,email:data.owner.email}})).digest("hex");
    const intent=await transaction(pool,async(client)=>{
      await client.query("SELECT pg_advisory_xact_lock(731247)");await assertAdministrator(actorId,client);
      const previous=(await client.query<Intent>(`${selectIntent} WHERE c.request_id=$1 FOR UPDATE OF c`,[data.requestId])).rows[0];
      if(previous){if(previous.actor_id!==actorId||previous.fingerprint!==digest)throw conflict();return previous;}
      // Coordinate with employee provisioning before reserving a physical vacancy.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`sistem:team:email:${data.owner.email}`]);
      if((await client.query("SELECT request_id FROM company_onboarding WHERE owner_email=$1",[data.owner.email])).rowCount)throw new ApiError(409,"ACCOUNT_CONFLICT","Este e-mail já está reservado para outro cadastro.");
      if((await client.query('SELECT id FROM "user" WHERE lower(email)=lower($1)',[data.owner.email])).rowCount)throw new ApiError(409,"ACCOUNT_CONFLICT","Já existe uma conta com esse e-mail. Use outra conta para o novo gestor.");
      const slot=(await slots(client))[0];if(!slot)throw capacityError();
      const tenantId=randomUUID();await client.query("INSERT INTO tenants(id,name,database_key,active) VALUES($1,$2,$3,false)",[tenantId,data.name,slot.key]);
      await client.query("INSERT INTO company_onboarding(request_id,tenant_id,actor_id,slot_id,fingerprint,owner_name,owner_email) VALUES($1,$2,$3,$4,$5,$6,$7)",[data.requestId,tenantId,actorId,slot.id,digest,data.owner.name,data.owner.email]);
      return (await client.query<Intent>(`${selectIntent} WHERE c.request_id=$1`,[data.requestId])).rows[0];
    });
    if(intent.completed_at){await assertAdministrator(actorId);return {company:await company(pool,intent.tenant_id)};}
    await assertAdministrator(actorId);
    await transaction(tenantPool(intent.database_key),async(client)=>{
      const marker=(await client.query("SELECT slot_id,tenant_id FROM tenant_admission WHERE singleton=true FOR UPDATE")).rows[0];
      if(!marker||marker.slot_id!==intent.slot_id||(marker.tenant_id&&marker.tenant_id!==intent.tenant_id))throw capacityError();
      if(!marker.tenant_id){if(!await emptyDatabase(client))throw capacityError();await client.query("UPDATE tenant_admission SET tenant_id=$1,claimed_at=clock_timestamp() WHERE singleton=true",[intent.tenant_id]);}
    });
    // No central connection remains borrowed here. Better Auth can use its second connection.
    let owner;
    try {owner=await accounts.createFirstOwner({tenantId:intent.tenant_id,actorId}, {requestId:data.requestId,...data.owner,role:"owner",overrides:{}});}
    catch(error) {
      // Another instance may have completed this exact intent after our initial read.
      if(error instanceof ApiError&&[403,503].includes(error.statusCode)) {
        await assertAdministrator(actorId);
        const finished=(await pool.query<Intent>(`${selectIntent} WHERE c.request_id=$1`,[data.requestId])).rows[0];
        if(finished?.completed_at&&finished.actor_id===actorId&&finished.fingerprint===digest)return {company:await company(pool,finished.tenant_id)};
      }
      throw error;
    }
    return transaction(pool,async(client)=>{
      await assertAdministrator(actorId,client);
      const ready=await client.query("SELECT m.user_id FROM memberships m JOIN access_audit_events a ON a.tenant_id=m.tenant_id AND a.target_user_id=m.user_id AND a.action='membership.created' WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.role='owner' AND m.active=true",[intent.tenant_id,owner.id]);
      if(!ready.rowCount)throw unavailable();
      await client.query("UPDATE tenants SET active=true WHERE id=$1",[intent.tenant_id]);
      await client.query("UPDATE company_onboarding SET completed_at=COALESCE(completed_at,clock_timestamp()) WHERE request_id=$1",[data.requestId]);
      await client.query("INSERT INTO company_admission_events(id,tenant_id,actor_id) VALUES($1,$2,$3) ON CONFLICT(tenant_id) DO NOTHING",[randomUUID(),intent.tenant_id,actorId]);
      return {company:await company(client,intent.tenant_id)};
    });
  });}
  return {isAdministrator,assertAdministrator,list,create};
}
