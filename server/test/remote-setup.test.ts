import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { createTestCluster } from "../scripts/test-cluster.ts";

test("NEON01 preparação remota reaplicável preserva dados e separa permissões dos dois bancos", async () => {
  const { prepareRemoteDatabases } = await import("../scripts/remote-databases.js");
  const cluster = await createTestCluster();
  const credentials = { controlPassword: randomUUID()+randomUUID(), tenantPassword: randomUUID()+randomUUID() };
  try {
    const first = await prepareRemoteDatabases({ adminUrl: cluster.adminDatabaseUrl, prefix: "sistem_neon_qa", credentials });
    const control = new Pool({ connectionString: first.controlUrl });
    const tenant = new Pool({ connectionString: first.tenantUrl });
    try {
      // ADM/BR preserve previous migrations and add company appearance to the tenant database.
      assert.equal((await control.query("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n, 3);
      assert.equal((await tenant.query("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n, 5);
      await assert.rejects(tenant.query("CREATE TABLE should_fail(id int)"));
      await assert.rejects(control.query("DELETE FROM schema_migrations"));
      await assert.rejects(tenant.query("UPDATE audit_events SET action='forged'"));
      const cross = new URL(first.controlUrl);
      cross.pathname = new URL(first.tenantUrl).pathname;
      const forbidden = new Pool({ connectionString: cross.toString() });
      try { await assert.rejects(forbidden.query("SELECT 1")); } finally { await forbidden.end(); }
      const role = (await tenant.query("SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user")).rows[0];
      assert.deepEqual(role, { rolsuper: false, rolcreatedb: false, rolcreaterole: false });
      await cluster.admin.query("SELECT 1");
      const adminTenant = new URL(cluster.adminDatabaseUrl);
      adminTenant.pathname = new URL(first.tenantUrl).pathname;
      const admin = new Pool({ connectionString: adminTenant.toString() });
      try { await admin.query("INSERT INTO customers(id,name,type) VALUES($1,'Preservar','Pessoa física')", [randomUUID()]); }
      finally { await admin.end(); }
      const again = await prepareRemoteDatabases({ adminUrl: cluster.adminDatabaseUrl, prefix: "sistem_neon_qa", credentials });
      assert.equal(again.tenantUrl, first.tenantUrl);
      assert.equal((await tenant.query("SELECT count(*)::int AS n FROM customers")).rows[0].n, 1);
    } finally { await control.end(); await tenant.end(); }
  } finally { await cluster.stop(); }
});

test("NEON03 falha ao gravar marcador não deixa identificação parcial nem impede reaplicação", async () => {
  const { prepareRemoteDatabases } = await import("../scripts/remote-databases.js");
  const cluster = await createTestCluster();
  let database: Pool | undefined;
  try {
    await cluster.admin.query("CREATE DATABASE sistem_atomic_control");
    const url = new URL(cluster.adminDatabaseUrl); url.pathname = "/sistem_atomic_control";
    database = new Pool({ connectionString: url.toString() });
    // Injeção de falha somente no cluster isolado: o INSERT do marcador falha.
    await database.query(`CREATE FUNCTION qa_fail_marker() RETURNS trigger LANGUAGE plpgsql AS $body$
      BEGIN RAISE EXCEPTION 'QA simulated marker failure'; END; $body$;
      CREATE FUNCTION qa_marker_ddl() RETURNS event_trigger LANGUAGE plpgsql AS $body$
      BEGIN IF TG_TAG='CREATE TABLE' AND to_regclass('public.sistem_environment') IS NOT NULL THEN
        EXECUTE 'CREATE TRIGGER qa_marker_failure BEFORE INSERT ON sistem_environment FOR EACH ROW EXECUTE FUNCTION qa_fail_marker()';
      END IF; END; $body$;
      CREATE EVENT TRIGGER qa_marker_ddl ON ddl_command_end EXECUTE FUNCTION qa_marker_ddl()`);
    const credentials = { controlPassword: randomUUID()+randomUUID(), tenantPassword: randomUUID()+randomUUID() };
    const input = { adminUrl: cluster.adminDatabaseUrl, prefix: "sistem_atomic", credentials };
    await assert.rejects(prepareRemoteDatabases(input));
    assert.equal((await database.query("SELECT to_regclass('public.sistem_environment') AS marker")).rows[0].marker, null,
      "failed marker insert must roll back the identifying table too");
    await database.query("DROP EVENT TRIGGER qa_marker_ddl");
    const result = await prepareRemoteDatabases(input);
    assert.ok(result.controlUrl && result.tenantUrl);
  } finally { await database?.end(); await cluster.stop(); }
});
