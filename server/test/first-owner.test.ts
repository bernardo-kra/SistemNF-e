import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createFixture } from "./helpers.ts";
import { migrateTenant } from "../src/migrations.ts";

test("NEON02 primeiro gestor explícito, repetição sem redefinir senha e recusa de promoção por e-mail", async () => {
  const { provisionFirstOwner } = await import("../src/first-owner.js");
  const fixture = await createFixture();
  try {
    const tenantId = randomUUID();
    // A fixture já ocupa as chaves a/b; a nova empresa precisa do próprio banco.
    const database = await fixture.cluster.createDatabase("first_owner");
    await migrateTenant(database.migrationPool); await database.grantRuntime();
    const config = { ...fixture.config, tenantDatabaseUrls: { ...fixture.config.tenantDatabaseUrls, c: database.runtimeUrl } };
    const owner = { name: "Gestor remoto QA", companyName: "Homologação QA", email: `qa-${randomUUID()}@example.test`, password: "QA-neon-original-password!" };
    const id = await provisionFirstOwner(fixture.control.migrationPool, config, tenantId, "c", owner);
    const repeated = await provisionFirstOwner(fixture.control.migrationPool, config, tenantId, "c", { ...owner, password: "QA-changed-password-refused!" });
    assert.equal(repeated, id);
    const app = await fixture.app();
    try {
      const login = await app.instance.inject({ method: "POST", url: "/api/auth/sign-in/email", headers: { origin: fixture.config.frontendOrigin }, payload: { email: owner.email, password: owner.password } });
      assert.equal(login.statusCode, 200);
      assert.ok(login.headers["set-cookie"]);
    } finally { await app.close(); }
    const existing = await fixture.user("viewer");
    await assert.rejects(provisionFirstOwner(fixture.control.migrationPool, config, randomUUID(), "c", { ...owner, email: existing.email }));
    await assert.rejects(provisionFirstOwner(fixture.control.migrationPool, config, tenantId, "c", { ...owner, email: `another-${randomUUID()}@example.test` }));
    assert.equal((await fixture.control.migrationPool.query("SELECT role FROM memberships WHERE user_id=$1", [existing.id])).rows[0].role, "viewer");
  } finally { await fixture.close(); }
});
