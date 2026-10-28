import { Pool } from "pg";
import { readConfig } from "../src/config.js";
import { configurePlatformAdministrator, prepareCompanySlot } from "../src/administration.js";

// Deliberately outside HTTP. Credentials are supplied through private environment files.
async function main() {
  const [action,value,...rest]=process.argv.slice(2);
  if(action==="--help") {console.log("Uso: admin --grant-admin USER_ID | --revoke-admin USER_ID | --prepare-slot DATABASE_KEY. Exige SISTEM_MIGRATION_DATABASE_URL administrativa e configuração de runtime privada. Não cria bancos, contas ou senhas.");return;}
  if(!value||rest.length||!["--grant-admin","--revoke-admin","--prepare-slot"].includes(action))throw new Error();
  const config=readConfig(process.env),base=new URL(process.env.SISTEM_MIGRATION_DATABASE_URL??"");
  if(!["postgres:","postgresql:"].includes(base.protocol)||base.hostname.includes("-pooler")||!base.username||!base.password)throw new Error();
  const pools:Pool[]=[];
  function migration(url:string) {
    const target=new URL(url);
    // Never send migration credentials to an unrelated host or a URL supplied by HTTP.
    if(target.hostname!==base.hostname||target.port!==base.port)throw new Error();
    const connection=new URL(base);connection.pathname=target.pathname;
    const pool=new Pool({connectionString:connection.toString(),max:2,connectionTimeoutMillis:15000,options:"-c statement_timeout=5000"});pools.push(pool);return pool;
  }
  try {
    const control=migration(config.controlDatabaseUrl);
    if(action!=="--prepare-slot") {
      await configurePlatformAdministrator(control,value,action==="--grant-admin");
      console.log(JSON.stringify({success:true,action:action==="--grant-admin"?"administrator-granted":"administrator-revoked",userId:value}));return;
    }
    if(!Object.hasOwn(config.tenantDatabaseUrls,value))throw new Error();
    const used=await control.query<{database_key:string}>("SELECT database_key FROM tenants");
    if(used.rows.some(row=>row.database_key===value))throw new Error();
    const target=migration(config.tenantDatabaseUrls[value]);
    const identitySql="SELECT oid::text AS id,datname AS name FROM pg_database WHERE datname=current_database()";
    const identity=(await target.query(identitySql)).rows[0];
    for(const row of used.rows) {
      const url=config.tenantDatabaseUrls[row.database_key];if(!url)throw new Error();
      const assigned=(await migration(url).query(identitySql)).rows[0];
      // Conservative across aliases: matching PostgreSQL database OID/name is never a new vacancy.
      if(identity.id===assigned.id&&identity.name===assigned.name)throw new Error();
    }
    await prepareCompanySlot(target);
    console.log(JSON.stringify({success:true,action:"vacancy-prepared",databaseKey:value}));
  } finally {await Promise.all(pools.map(pool=>pool.end()));}
}
void main().catch(()=>{console.error("Administração não aplicada. Confira a ação, conta existente, migrações, conexão administrativa e vaga vazia não associada. Nenhuma substituição ou limpeza automática foi executada.");process.exitCode=1;});
