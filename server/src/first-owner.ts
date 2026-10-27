import type { Pool } from "pg";
import type { ApiConfig } from "./config.js";
import { readBootstrapOwner, type BootstrapOwner } from "./bootstrap.js";
import { createAuth } from "./auth.js";

// Ferramenta administrativa explícita. Nunca chamada pelo servidor HTTP.
export async function provisionFirstOwner(pool: Pool, config: ApiConfig, tenantId: string, databaseKey: string, raw: BootstrapOwner) {
  if (!Object.hasOwn(config.tenantDatabaseUrls, databaseKey)) throw new Error("Banco da empresa não configurado.");
  const owner = readBootstrapOwner({ SISTEM_OWNER_NAME: raw.name, SISTEM_OWNER_EMAIL: raw.email,
    SISTEM_OWNER_PASSWORD: raw.password, SISTEM_COMPANY_NAME: raw.companyName });
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [`sistem:first-owner:${tenantId}`]);
    const existingTenant = await client.query("SELECT name,database_key,active FROM tenants WHERE id=$1", [tenantId]);
    const existing = await client.query<{ id: string }>('SELECT id FROM "user" WHERE lower(email)=lower($1)', [owner.email]);
    if (existing.rows[0]) {
      const id = existing.rows[0].id;
      const membership = await client.query("SELECT role,active FROM memberships WHERE user_id=$1 AND tenant_id=$2", [id, tenantId]);
      const tenant = existingTenant.rows[0];
      if (!tenant || tenant.name !== owner.companyName || tenant.database_key !== databaseKey || !tenant.active ||
          membership.rows[0]?.role !== "owner" || membership.rows[0]?.active !== true) {
        throw new Error("Conta existente não é o gestor ativo desta preparação. Nenhuma promoção ou reativação foi aplicada.");
      }
      return id;
    }
    if (existingTenant.rowCount) throw new Error("Empresa já preparada com outra conta. Nenhum gestor adicional será criado.");
    const auth = createAuth(pool, config, true);
    const account = await auth.api.signUpEmail({ body: { name: owner.name, email: owner.email, password: owner.password } });
    await client.query("BEGIN");
    try {
      await client.query("INSERT INTO tenants(id,name,database_key,active) VALUES($1,$2,$3,true)", [tenantId, owner.companyName, databaseKey]);
      await client.query("INSERT INTO memberships(user_id,tenant_id,role,active) VALUES($1,$2,'owner',true)", [account.user.id, tenantId]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    return account.user.id;
  } finally {
    try { await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [`sistem:first-owner:${tenantId}`]); }
    finally { client.release(); }
  }
}
