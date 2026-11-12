import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import type { Browser, BrowserContext } from "@playwright/test";
import { createFixture, TENANT_A, type Fixture } from "./helpers.ts";

if (!process.argv.includes("--run")) throw Error("Execute com --run após build, porta4000 livre; somente banco genérico isolado.");
const { chromium, expect } = createRequire(new URL("../../package.json", import.meta.url))("@playwright/test") as typeof import("@playwright/test");
const { buildApp } = await import(new URL("../dist/app.js", import.meta.url).href) as typeof import("../src/app.ts");
const origin = "http://127.0.0.1:4000";
let fixture: Fixture | undefined, control: Pool | undefined, app: Awaited<ReturnType<typeof buildApp>> | undefined;
let browser: Browser | undefined, context: BrowserContext | undefined;
let success = false, cleanup = true, stage = "setup", reads = 0, writes = 0;
const nonGetFiscal: { method: string; path: string }[] = [];
try {
  fixture = await createFixture();
  await fixture.a.migrationPool.query("INSERT INTO tenant_admission(singleton,slot_id,tenant_id,claimed_at) VALUES(true,$1,$2,clock_timestamp())", [randomUUID(), TENANT_A]);
  const user = await fixture.user(); control = new Pool({ connectionString: fixture.control.runtimeUrl, max: 2 });
  app = await buildApp({ config: { ...fixture.config, frontendOrigin: origin }, controlPool: control, frontendRoot: fileURLToPath(new URL("../../out/", import.meta.url)), logger: false });
  await app.listen({ host: "127.0.0.1", port: 4000 }); browser = await chromium.launch({ channel: "chrome", headless: true }); context = await browser.newContext();
  assert.equal((await context.request.post(origin + "/api/auth/sign-in/email", { headers: { origin }, data: { email: user.email, password: user.password } })).status(), 200);
  const before = (await fixture.a.migrationPool.query("SELECT count(*)::int n FROM audit_events")).rows[0].n;
  const page = await context.newPage(); page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/fiscal/readiness")) reads++;
    if (path.includes("/fiscal/") && request.method() !== "GET") nonGetFiscal.push({ method: request.method(), path });
    if (path.startsWith("/api/v1/") && path.includes("/fiscal/") && ["POST", "PATCH", "PUT", "DELETE"].includes(request.method())) writes++;
  });
  stage = "readiness"; await page.goto(origin + "/fiscal/");
  await expect(page.getByText("Envio oficial ainda indisponível", { exact: true })).toBeVisible();
  await expect(page.getByText("Cadastro fiscal incompleto", { exact: true })).toBeVisible();
  await expect(page.getByText("Certificado A1 ainda não cadastrado", { exact: true })).toBeVisible();
  assert.equal(reads, 1); assert.equal(writes, 0);
  await page.getByRole("button", { name: "Verificar emissão novamente", exact: true }).click();
  await expect(page.getByRole("button", { name: "Verificar emissão novamente", exact: true })).toBeEnabled(); assert.equal(reads, 2);
  await expect(page.getByRole("button", { name: "Emitir nota", exact: true })).toHaveCount(0);
  const directory = fileURLToPath(new URL("../.local/validation/", import.meta.url)); await mkdir(directory, { recursive: true });
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 1000 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: resolve(directory, `nfse-readiness-real-${width}.png`), fullPage: true });
  }
  assert.equal((await fixture.a.migrationPool.query("SELECT count(*)::int n FROM audit_events")).rows[0].n, before);
  assert.equal(writes, 0);
  assert.equal((await fixture.a.migrationPool.query("SELECT count(*)::int n FROM nfse_dps_requests")).rows[0].n, 0);
  success = true;
} catch { console.error(JSON.stringify({ event: "nfse.readiness.failed", stage, code: "VERIFICATION_FAILED" })); process.exitCode = 1; }
finally {
  for (const close of [() => context?.close(), () => browser?.close(), () => app?.close(), () => control?.end(), () => fixture?.close()]) {
    try { await close(); } catch { cleanup = false; process.exitCode = 1; }
  }
  console.log(JSON.stringify({ event: "nfse.readiness.result", success, cleanup, stage, reads, writes, nonGetFiscal, compiledApi: true, officialTransmission: false }));
}
