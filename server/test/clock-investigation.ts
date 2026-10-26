import assert from "node:assert/strict";
import { createFixture, createCustomer, authHeaders, login, tenantPath, type TestApp } from "./helpers.ts";

const fixture = await createFixture();
let app: TestApp | undefined;
try {
  app = await fixture.app();
  const user = await fixture.user();
  const { cookie } = await login(app, user);
  const column = (await fixture.a.migrationPool.query("SELECT data_type,datetime_precision,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='audit_events' AND column_name='at'")).rows[0];
  const clockSamples: { dbMinusNodeBeforeMs: number; dbMinusNodeAfterMs: number }[] = [];
  async function databaseClock() {
    const before = Date.now();
    const value = Number((await fixture.a.migrationPool.query("SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint::text AS value")).rows[0].value);
    const after = Date.now();
    assert.ok(Number.isSafeInteger(value));
    clockSamples.push({ dbMinusNodeBeforeMs: value - before, dbMinusNodeAfterMs: value - after });
    return value;
  }
  const samples: { sample: number; version: number; parsedMinusExactMs: number; auditMinusNodeStartMs: number; auditMinusNodeEndMs: number; auditMinusPgStartMs: number; auditMinusPgEndMs: number }[] = [];
  for (let sample = 0; sample < 50; sample++) {
    const pgStart = await databaseClock();
    const nodeStart = Date.now();
    const customer = await createCustomer(app, cookie, undefined, { name: `Clock investigation ${sample}` });
    const changed: { statusCode: number } = await app.instance.inject({ method: "PATCH", url: `${tenantPath()}/${customer.id}`, headers: authHeaders(cookie), payload: { version: 1, phone: "11000000000" } });
    assert.equal(changed.statusCode, 200);
    const nodeEnd = Date.now();
    const pgEnd = await databaseClock();
    const events = await fixture.a.migrationPool.query("SELECT at,entity_version,floor(extract(epoch FROM at)*1000)::bigint::text AS exact_ms FROM audit_events WHERE entity_id=$1 ORDER BY entity_version", [customer.id]);
    assert.equal(events.rowCount, 2);
    for (const event of events.rows) {
      const exact = Number(event.exact_ms), parsed = new Date(event.at).getTime();
      samples.push({ sample, version: event.entity_version, parsedMinusExactMs: parsed - exact,
        auditMinusNodeStartMs: parsed - nodeStart, auditMinusNodeEndMs: parsed - nodeEnd,
        auditMinusPgStartMs: exact - pgStart, auditMinusPgEndMs: exact - pgEnd });
    }
  }
  const nodeOutside = samples.filter((sample) => sample.auditMinusNodeStartMs < 0 || sample.auditMinusNodeEndMs > 0);
  const pgOutside = samples.filter((sample) => sample.auditMinusPgStartMs < 0 || sample.auditMinusPgEndMs > 0);
  console.log(JSON.stringify({ kind: "CLOCK_INVESTIGATION", column, requests: 50, events: samples.length,
    outsideNodeInterval: nodeOutside.length, outsidePgInterval: pgOutside.length,
    driverOffsetsMs: [...new Set(samples.map((sample) => sample.parsedMinusExactMs))],
    databaseClockOutsideNodeInterval: clockSamples.filter((sample) => sample.dbMinusNodeBeforeMs < 0 || sample.dbMinusNodeAfterMs > 0).slice(0, 10),
    anomalousEvents: samples.filter((sample) => sample.parsedMinusExactMs !== 0 || sample.auditMinusNodeStartMs < 0 || sample.auditMinusNodeEndMs > 0 || sample.auditMinusPgStartMs < 0 || sample.auditMinusPgEndMs > 0).slice(0, 10) }, null, 2));
} finally {
  try { await app?.close(); } finally { await fixture.close(); }
}
