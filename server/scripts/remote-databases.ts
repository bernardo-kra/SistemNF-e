import { Pool } from "pg";
import { migrateControl, migrateTenant } from "../src/migrations.js";

type Input = { adminUrl: string; prefix: string; credentials: { controlPassword: string; tenantPassword: string } };
const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

export async function prepareRemoteDatabases(input: Input) {
  if (!/^[a-z][a-z0-9_]{0,35}$/.test(input.prefix)) throw new Error("Prefixo de preparação inválido.");
  if (![input.credentials.controlPassword, input.credentials.tenantPassword].every((value) => /^[A-Za-z0-9_-]{40,128}$/.test(value))) {
    throw new Error("Credenciais de runtime inválidas.");
  }
  const adminUrl = new URL(input.adminUrl);
  if (adminUrl.hostname.includes("-pooler")) throw new Error("A preparação exige conexão direta.");
  const admin = new Pool({ connectionString: input.adminUrl, max: 1, connectionTimeoutMillis: 15000 });
  const results: string[] = [];
  try {
    for (const [scope, password] of [["control", input.credentials.controlPassword], ["main", input.credentials.tenantPassword]] as const) {
      const database = `${input.prefix}_${scope}`, role = `${database}_app`;
      const db = await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [database]);
      const existingRole = await admin.query("SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=$1", [role]);
      if (existingRole.rows.some((row) => row.rolsuper || row.rolcreatedb || row.rolcreaterole)) throw new Error("Role existente possui privilégios incompatíveis.");
      if (!db.rowCount) await admin.query(`CREATE DATABASE ${identifier(database)}`);
      const migrationUrl = new URL(adminUrl); migrationUrl.pathname = `/${database}`;
      const migration = new Pool({ connectionString: migrationUrl.toString(), max: 2, connectionTimeoutMillis: 15000 });
      try {
        const marker = await migration.query("SELECT to_regclass('public.sistem_environment') AS marker");
        if (!marker.rows[0].marker) {
          const tables = await migration.query("SELECT 1 FROM information_schema.tables WHERE table_schema='public' LIMIT 1");
          if (tables.rowCount) throw new Error("Banco existente não pertence a esta preparação. Dados preservados.");
          const client = await migration.connect();
          try {
            await client.query("BEGIN");
            await client.query("CREATE TABLE sistem_environment(id boolean PRIMARY KEY CHECK(id),scope text NOT NULL)");
            await client.query("INSERT INTO sistem_environment VALUES(true,$1)", [`${input.prefix}:${scope}`]);
            await client.query("COMMIT");
          } catch (error) { await client.query("ROLLBACK"); throw error; }
          finally { client.release(); }
        }
        const check = await migration.query("SELECT scope FROM sistem_environment WHERE id=true");
        if (check.rows[0]?.scope !== `${input.prefix}:${scope}`) throw new Error("Marcador de ambiente incompatível.");
        if (!existingRole.rowCount) await admin.query(`CREATE ROLE ${identifier(role)} LOGIN PASSWORD ${literal(password)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`);
        await admin.query(`REVOKE ALL ON DATABASE ${identifier(database)} FROM PUBLIC`);
        await admin.query(`GRANT CONNECT ON DATABASE ${identifier(database)} TO ${identifier(role)}`);
        await migration.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
        if (scope === "control") await migrateControl(migration); else await migrateTenant(migration);
        await migration.query(`GRANT USAGE ON SCHEMA public TO ${identifier(role)}`);
        await migration.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${identifier(role)}`);
        await migration.query(`GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${identifier(role)}`);
        for (const table of ["schema_migrations", "sistem_environment"]) {
          await migration.query(`REVOKE INSERT,UPDATE,DELETE ON ${identifier(table)} FROM ${identifier(role)}`);
        }
        for (const table of scope === "control" ? ["access_audit_events"] : ["audit_events", "finance_agreements", "finance_installments", "finance_payments", "finance_allocations", "finance_movements"]) {
          await migration.query(`REVOKE UPDATE,DELETE ON ${identifier(table)} FROM ${identifier(role)}`);
        }
        if (scope === "control") {
          for (const table of ["platform_administrator", "platform_administrator_events"]) await migration.query(`REVOKE INSERT,UPDATE,DELETE ON ${identifier(table)} FROM ${identifier(role)}`);
          await migration.query(`REVOKE UPDATE,DELETE ON company_admission_events FROM ${identifier(role)}`);
        } else {
          await migration.query(`REVOKE INSERT,UPDATE,DELETE ON tenant_admission FROM ${identifier(role)}`);
          await migration.query(`GRANT UPDATE(tenant_id,claimed_at) ON tenant_admission TO ${identifier(role)}`);
        }
        const runtimeUrl = new URL(migrationUrl); runtimeUrl.username = role; runtimeUrl.password = password;
        const runtime = new Pool({ connectionString: runtimeUrl.toString(), max: 1, connectionTimeoutMillis: 15000 });
        try { await runtime.query("SELECT 1"); } finally { await runtime.end(); }
        results.push(runtimeUrl.toString());
      } finally { await migration.end(); }
    }
    return { controlUrl: results[0], tenantUrl: results[1] };
  } finally { await admin.end(); }
}
