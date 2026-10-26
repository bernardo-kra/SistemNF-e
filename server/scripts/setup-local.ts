import { randomUUID } from "node:crypto";
import { readFile, writeFile, rename, rm, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { readBootstrapOwner, type BootstrapOwner } from "../src/bootstrap.js";
import { readConfig } from "../src/config.js";
import { createAuth } from "../src/auth.js";
import { migrateControl, migrateTenant } from "../src/migrations.js";
import { assertLocalPath, createLocalDatabase, databaseUrl, loadLocalCredentials, secret, type LocalCredentials } from "./portable-postgres.js";

export type SetupInput = { directory: string; credentials: LocalCredentials; owner: BootstrapOwner };
type Manifest = { version: 1; tenantId: string; controlPassword: string; tenantPassword: string; authSecret: string };

async function manifestAt(directory: string): Promise<Manifest> {
  const file = assertLocalPath(resolve(directory, "setup.json"));
  try {
    const value = JSON.parse(await readFile(file, "utf8")) as Manifest;
    if (value.version !== 1 || !/^[0-9a-f-]{36}$/i.test(value.tenantId) ||
        ![value.controlPassword, value.tenantPassword, value.authSecret].every((item) => typeof item === "string" && /^[A-Za-z0-9_-]{40,128}$/.test(item)))
      throw new Error("Manifesto local incompatível. Preserve o arquivo antes de corrigir.");
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const value: Manifest = { version: 1, tenantId: randomUUID(), controlPassword: secret(), tenantPassword: secret(), authSecret: secret() };
    // Persist generated infrastructure credentials before creating roles, so interrupted setup can be resumed.
    await writeFile(file, JSON.stringify(value), { flag: "wx", mode: 0o600 });
    return value;
  }
}

export async function setupLocal(input: SetupInput): Promise<{ tenantId: string; envPath: string }> {
  const owner = readBootstrapOwner({ SISTEM_OWNER_NAME: input.owner.name, SISTEM_OWNER_EMAIL: input.owner.email,
    SISTEM_OWNER_PASSWORD: input.owner.password, SISTEM_COMPANY_NAME: input.owner.companyName });
  const directory = assertLocalPath(resolve(input.directory));
  const admin = new Pool({ connectionString: databaseUrl(input.credentials, "postgres"), max: 2, connectionTimeoutMillis: 1000 });
  const databases: Awaited<ReturnType<typeof createLocalDatabase>>[] = [];
  try {
    const actual = (await admin.query("SHOW data_directory")).rows[0].data_directory as string;
    const actualPath = assertLocalPath(await realpath(actual));
    const expectedPath = assertLocalPath(await realpath(resolve(directory, "data")));
    const comparable = (path: string) => process.platform === "win32" ? path.toLowerCase() : path;
    if (comparable(actualPath) !== comparable(expectedPath)) throw new Error("O cluster conectado não pertence à pasta de desenvolvimento informada.");
    const state = await manifestAt(directory);
    const control = await createLocalDatabase(admin, input.credentials, "control", { reuse: true, runtimePassword: state.controlPassword });
    databases.push(control);
    const main = await createLocalDatabase(admin, input.credentials, "main", { reuse: true, runtimePassword: state.tenantPassword });
    databases.push(main);
    await migrateControl(control.migrationPool);
    await migrateTenant(main.migrationPool);
    const config = readConfig({ NODE_ENV: "development", API_HOST: "127.0.0.1", API_PORT: "4000",
      API_BASE_URL: "http://127.0.0.1:4000", FRONTEND_ORIGIN: "http://127.0.0.1:3000", BETTER_AUTH_SECRET: state.authSecret,
      CONTROL_DATABASE_URL: control.runtimeUrl, TENANT_DATABASE_URLS: JSON.stringify({ main: main.runtimeUrl }) });
    const existingTenant = await control.migrationPool.query("SELECT id FROM tenants WHERE id=$1", [state.tenantId]);
    const existing = await control.migrationPool.query<{ id: string }>('SELECT id FROM "user" WHERE lower(email)=lower($1)', [owner.email]);
    if (existingTenant.rowCount && !existing.rows.length)
      throw new Error("A empresa já foi preparada com outra conta. Nenhuma conta adicional será criada por repetição.");
    let userId: string;
    if (existing.rows.length) {
      userId = existing.rows[0].id;
      const membership = await control.migrationPool.query("SELECT role,active FROM memberships WHERE user_id=$1 AND tenant_id=$2", [userId, state.tenantId]);
      if (membership.rows[0]?.role !== "owner" || membership.rows[0]?.active !== true)
        throw new Error("A conta existente não é o gestor ativo desta preparação. Nenhuma promoção ou reativação foi aplicada.");
      const tenant = await control.migrationPool.query("SELECT name,active,database_key FROM tenants WHERE id=$1", [state.tenantId]);
      if (tenant.rows[0]?.name !== owner.companyName || !tenant.rows[0]?.active || tenant.rows[0]?.database_key !== "main")
        throw new Error("A empresa existente difere da preparação informada. Seus dados foram preservados.");
    } else {
      const auth = createAuth(control.migrationPool, config, true);
      const created = await auth.api.signUpEmail({ body: { name: owner.name, email: owner.email, password: owner.password } });
      userId = created.user.id;
      const client = await control.migrationPool.connect();
      try {
        await client.query("BEGIN");
        const tenants = await client.query("SELECT id FROM tenants WHERE id=$1 FOR UPDATE", [state.tenantId]);
        if (tenants.rowCount) throw new Error("A empresa já possui uma preparação. Não será criado outro gestor por repetição.");
        await client.query("INSERT INTO tenants(id,name,database_key,active) VALUES($1,$2,'main',true)", [state.tenantId, owner.companyName]);
        await client.query("INSERT INTO memberships(user_id,tenant_id,role,active) VALUES($1,$2,'owner',true)", [userId, state.tenantId]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    }
    await control.grantRuntime();
    await main.grantRuntime();
    for (const connectionString of [control.runtimeUrl, main.runtimeUrl]) {
      const runtime = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 1000 });
      try { await runtime.query("SELECT 1"); }
      catch { throw new Error("A conexão de runtime não foi validada. Preserve a configuração e confira a credencial interna antes de iniciar a API."); }
      finally { await runtime.end(); }
    }
    const envPath = assertLocalPath(resolve(directory, "api.env"));
    const temporary = assertLocalPath(resolve(directory, `api-env-${randomUUID()}.tmp`));
    const raw = `NODE_ENV=development\nAPI_HOST=127.0.0.1\nAPI_PORT=4000\nAPI_BASE_URL=http://127.0.0.1:4000\nFRONTEND_ORIGIN=http://127.0.0.1:3000\nBETTER_AUTH_SECRET=${state.authSecret}\nCONTROL_DATABASE_URL=${control.runtimeUrl}\nTENANT_DATABASE_URLS='${JSON.stringify({ main: main.runtimeUrl })}'\n`;
    try {
      await writeFile(temporary, raw, { flag: "wx", mode: 0o600 });
      await rename(temporary, envPath);
    } finally { await rm(temporary, { force: true }); }
    return { tenantId: state.tenantId, envPath };
  } finally {
    const closed = await Promise.allSettled(databases.map((database) => database.migrationPool.end()));
    await admin.end();
    if (closed.some((result) => result.status === "rejected")) throw new Error("Não foi possível encerrar os pools da preparação local.");
  }
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log("Com o db:local ativo, informe SISTEM_OWNER_NAME, SISTEM_OWNER_EMAIL, SISTEM_OWNER_PASSWORD e SISTEM_COMPANY_NAME no ambiente. A preparação gera api.env privado e não imprime senhas. Repetir não redefine senha nem promove conta existente.");
    return;
  }
  const owner = readBootstrapOwner(process.env);
  const { directory, credentials } = await loadLocalCredentials();
  await setupLocal({ directory, credentials, owner });
  delete process.env.SISTEM_OWNER_PASSWORD;
  console.log("Preparação local concluída. Configuração privada em server/.local/development/api.env. Credenciais de conta existente foram preservadas. Execute npm.cmd run dev neste diretório.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch(() => {
    delete process.env.SISTEM_OWNER_PASSWORD;
    console.error("Não foi possível preparar a API local. Confira os dados explícitos do gestor, a pasta e o cluster iniciado por db:local. Nenhuma credencial foi impressa.");
    process.exitCode = 1;
  });
}
