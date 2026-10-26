import type { Pool } from "pg";
import { getMigrations } from "better-auth/db/migration";
import { authSchemaOptions } from "./auth.js";

async function migrate(pool: Pool, scope: "control" | "tenant", sql: string, version = `${scope}_001`) {
  // Introspection must not borrow a second connection while another migration waits for our lock.
  // The version is rechecked under the lock, so concurrently compiled DDL is executed only once.
  let generated = "";
  if (scope === "control" && version === "control_001") {
    const migration = await getMigrations(authSchemaOptions(pool));
    generated = await migration.compileMigrations();
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [scope === "control" ? 731241 : 731242]);
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT clock_timestamp())");
    const existing = await client.query("SELECT version FROM schema_migrations WHERE version=$1", [version]);
    if (!existing.rowCount) {
      // Execute the installed library's compiled schema with the same transaction as our version marker.
      if (generated && generated.trim() !== ";") await client.query(generated);
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
    }
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* Preserve the original migration error. */ }
    throw error;
  } finally { client.release(); }
}

export async function migrateControl(pool: Pool): Promise<void> {
  await migrate(pool, "control", `
    CREATE TABLE tenants (
      id uuid PRIMARY KEY, name text NOT NULL, database_key text NOT NULL UNIQUE,
      active boolean NOT NULL DEFAULT true
    );
    CREATE TABLE memberships (
      user_id text NOT NULL REFERENCES "user"(id), tenant_id uuid NOT NULL REFERENCES tenants(id),
      role text NOT NULL CHECK (role IN ('owner','operator','viewer')), active boolean NOT NULL DEFAULT true,
      PRIMARY KEY (user_id,tenant_id)
    );
    CREATE INDEX memberships_tenant_idx ON memberships (tenant_id,active);
  `);
  await migrate(pool, "control", `
    ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "provisioningKey" text;
    CREATE UNIQUE INDEX user_provisioning_key_idx ON "user" ("provisioningKey") WHERE "provisioningKey" IS NOT NULL;
    ALTER TABLE memberships ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version > 0);
    ALTER TABLE memberships ADD COLUMN permission_overrides jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(permission_overrides)='object');
    ALTER TABLE memberships ADD COLUMN created_at timestamptz;
    ALTER TABLE memberships ADD COLUMN updated_at timestamptz;
    CREATE TABLE access_audit_events (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
      actor_id text NOT NULL REFERENCES "user"(id), target_user_id text NOT NULL REFERENCES "user"(id),
      action text NOT NULL, entity_version integer NOT NULL CHECK(entity_version > 0),
      field_names text[] NOT NULL DEFAULT '{}', at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(tenant_id,target_user_id,entity_version)
    );
    CREATE INDEX access_audit_tenant_idx ON access_audit_events(tenant_id,at DESC,id DESC);
    CREATE FUNCTION prevent_access_audit_changes() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN RAISE EXCEPTION 'access audit events are append-only' USING ERRCODE='42501'; END; $body$;
    CREATE TRIGGER access_audit_append_only BEFORE UPDATE OR DELETE ON access_audit_events FOR EACH ROW EXECUTE FUNCTION prevent_access_audit_changes();
    CREATE TABLE account_provisioning (
      request_id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), actor_id text NOT NULL REFERENCES "user"(id),
      fingerprint text NOT NULL, provisioning_key uuid NOT NULL UNIQUE,
      user_id text REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
  `, "control_002");
}

export async function migrateTenant(pool: Pool): Promise<void> {
  await migrate(pool, "tenant", `
    CREATE TABLE customers (
      id uuid PRIMARY KEY, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
      email text NOT NULL DEFAULT '', phone text NOT NULL DEFAULT '',
      type text NOT NULL CHECK(type IN ('Pessoa física','Empresa')), active boolean NOT NULL DEFAULT true,
      version integer NOT NULL DEFAULT 1 CHECK(version > 0),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE INDEX customers_name_idx ON customers (lower(name),id);
    CREATE TABLE audit_events (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, actor_id text NOT NULL,
      action text NOT NULL, entity_type text NOT NULL, entity_id uuid NOT NULL,
      entity_version integer NOT NULL, at timestamptz NOT NULL DEFAULT clock_timestamp(),
      field_names text[] NOT NULL DEFAULT '{}', UNIQUE(entity_type,entity_id,entity_version)
    );
    CREATE INDEX audit_events_entity_idx ON audit_events(entity_type,entity_id,at DESC);
    CREATE FUNCTION prevent_audit_changes() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN RAISE EXCEPTION 'audit events are append-only' USING ERRCODE='42501'; END; $body$;
    CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION prevent_audit_changes();
  `);
  await migrate(pool, "tenant", `
    ALTER TABLE audit_events ADD COLUMN before_values jsonb NOT NULL DEFAULT '{}';
    ALTER TABLE audit_events ADD COLUMN after_values jsonb NOT NULL DEFAULT '{}';
    CREATE TABLE operational_records (
      entity_type text NOT NULL CHECK(entity_type IN ('product','sale','order','purchase','technician','link')),
      id uuid NOT NULL, body jsonb NOT NULL CHECK(jsonb_typeof(body)='object'), version integer NOT NULL CHECK(version>0),
      created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, created_by text NOT NULL, updated_by text NOT NULL,
      PRIMARY KEY(entity_type,id)
    );
    CREATE TABLE stock_balances (
      product_id uuid PRIMARY KEY, physical bigint NOT NULL DEFAULT 0 CHECK(physical>=0 AND physical<=1000000000),
      reserved bigint NOT NULL DEFAULT 0 CHECK(reserved>=0 AND reserved<=physical), version integer NOT NULL DEFAULT 0 CHECK(version>=0), updated_at timestamptz,updated_by text
    );
    CREATE TABLE operational_requests (id uuid PRIMARY KEY,command text NOT NULL,fingerprint text NOT NULL,entity_type text NOT NULL,entity_id uuid NOT NULL,at timestamptz NOT NULL DEFAULT clock_timestamp());
    CREATE TABLE stock_movements (id uuid PRIMARY KEY,request_id uuid NOT NULL,product_id uuid NOT NULL,physical_delta bigint NOT NULL,reserved_delta bigint NOT NULL,reference text NOT NULL,at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(request_id,product_id));
    CREATE TRIGGER movements_append_only BEFORE UPDATE OR DELETE ON stock_movements FOR EACH ROW EXECUTE FUNCTION prevent_audit_changes();
    CREATE TABLE operational_coordination (id integer PRIMARY KEY CHECK(id=1),sale_number integer NOT NULL DEFAULT 0,order_number integer NOT NULL DEFAULT 0);
    INSERT INTO operational_coordination(id) VALUES(1);
    CREATE TABLE customer_requests(request_id uuid PRIMARY KEY,fingerprint text NOT NULL,customer_id uuid NOT NULL REFERENCES customers(id));
  `, "tenant_002");
}
