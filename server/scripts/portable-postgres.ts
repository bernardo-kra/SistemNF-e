import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { Pool } from "pg";

const run = promisify(execFile);
export const serverRoot = fileURLToPath(new URL("../", import.meta.url));
export const localRoot = resolve(serverRoot, ".local");
export const secret = () => randomBytes(32).toString("base64url");
const identifier = (value: string) => {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error("Identificador local inválido.");
  return `"${value}"`;
};
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

export function assertLocalPath(target: string) {
  const absolute = resolve(target);
  if (!absolute.startsWith(`${localRoot}\\`) && !absolute.startsWith(`${localRoot}/`)) {
    throw new Error("O cluster precisa ficar dentro de server/.local.");
  }
  return absolute;
}

export async function freePort() {
  const listener = createServer();
  await new Promise<void>((done, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", done);
  });
  const address = listener.address();
  if (!address || typeof address === "string") throw new Error("Porta local indisponível.");
  await new Promise<void>((done, reject) => listener.close((error) => error ? reject(error) : done()));
  return address.port;
}

export type LocalCredentials = { port: number; user: string; password: string };
export function databaseUrl(credentials: LocalCredentials, database: string, user = credentials.user, password = credentials.password) {
  const url = new URL(`postgresql://127.0.0.1:${credentials.port}/${database}`);
  url.username = user;
  url.password = password;
  return url.toString();
}

async function binaries(): Promise<{ initdb: string; pg_ctl: string }> {
  const platform = process.platform === "win32" ? "windows" : process.platform;
  const nativePackage = `@embedded-postgres/${platform}-${process.arch}`;
  const requireBinary = createRequire(import.meta.resolve("embedded-postgres"));
  return import(pathToFileURL(requireBinary.resolve(nativePackage)).href);
}

/** Development/test tools only; no OS service, global role or production credential. */
export async function startPortablePostgres(directory: string, credentials: LocalCredentials) {
  const dataDir = assertLocalPath(resolve(directory, "data"));
  if (process.platform !== "win32" && process.getuid?.() === 0) {
    throw new Error("Execute PostgreSQL local com usuário comum; esta ferramenta não cria usuários do sistema.");
  }
  await mkdir(directory, { recursive: true });
  const binary = await binaries();
  const options = { windowsHide: true, timeout: 60_000, maxBuffer: 1024 * 1024 };
  try { await access(resolve(dataDir, "PG_VERSION")); }
  catch {
    const passwordFile = assertLocalPath(resolve(directory, "bootstrap-password"));
    await writeFile(passwordFile, `${credentials.password}\n`, { mode: 0o600, flag: "wx" });
    try {
      await run(binary.initdb, ["-D", dataDir, "--auth=scram-sha-256", `--username=${credentials.user}`,
        `--pwfile=${passwordFile}`, "--locale=C", "--encoding=UTF8"], options);
    } finally { await rm(passwordFile, { force: true }); }
  }
  // Do not attach to or stop a cluster owned by a different process.
  let alreadyRunning = false;
  try { await run(binary.pg_ctl, ["status", "-D", dataDir], options); alreadyRunning = true; } catch { /* stopped */ }
  if (alreadyRunning) throw new Error("Este cluster local já está em execução. Use o processo que o iniciou.");
  await run(binary.pg_ctl, ["start", "-D", dataDir, "-l", resolve(directory, "postgres.log"), "-w", "-t", "30",
    "-o", `-h 127.0.0.1 -p ${credentials.port} -c max_connections=60 -c shared_buffers=16MB -c timezone=UTC`], options);
  let stopped = false;
  return {
    async stop() {
      if (stopped) return;
      await run(binary.pg_ctl, ["stop", "-D", dataDir, "-m", "fast", "-w", "-t", "30"], options);
      stopped = true;
    },
  };
}

export async function loadLocalCredentials() {
  const directory = resolve(localRoot, "development");
  await mkdir(directory, { recursive: true });
  const credentialPath = resolve(directory, "cluster.json");
  try { return { directory, credentials: JSON.parse(await readFile(credentialPath, "utf8")) as LocalCredentials }; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const credentials: LocalCredentials = { port: await freePort(), user: "sistem_local_admin", password: secret() };
    await writeFile(credentialPath, JSON.stringify(credentials), { flag: "wx", mode: 0o600 });
    return { directory, credentials };
  }
}

export async function createLocalDatabase(admin: Pool, credentials: LocalCredentials, key: string) {
  const databaseName = `sistem_${key}`;
  const runtimeUser = `sistem_${key}_app`;
  const password = secret();
  // Names are tool-generated/validated; SQL values are quoted, never sourced from HTTP.
  await admin.query(`CREATE ROLE ${identifier(runtimeUser)} LOGIN PASSWORD ${literal(password)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`);
  await admin.query(`CREATE DATABASE ${identifier(databaseName)}`);
  await admin.query(`REVOKE ALL ON DATABASE ${identifier(databaseName)} FROM PUBLIC`);
  await admin.query(`GRANT CONNECT ON DATABASE ${identifier(databaseName)} TO ${identifier(runtimeUser)}`);
  const migrationPool = new Pool({ connectionString: databaseUrl(credentials, databaseName), max: 2 });
  await migrationPool.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
  await migrationPool.query(`GRANT USAGE ON SCHEMA public TO ${identifier(runtimeUser)}`);
  const grantRuntime = async () => {
    await migrationPool.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${identifier(runtimeUser)}`);
    await migrationPool.query(`GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${identifier(runtimeUser)}`);
  };
  return { databaseName, migrationPool, runtimeUser,
    runtimeUrl: databaseUrl(credentials, databaseName, runtimeUser, password), grantRuntime };
}
