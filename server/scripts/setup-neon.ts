import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { prepareRemoteDatabases } from "./remote-databases.js";

export async function setupNeon(env: NodeJS.ProcessEnv, root = resolve(import.meta.dirname, "../..")) {
  const link = JSON.parse(await readFile(resolve(root, ".neon"), "utf8"));
  if (link.projectId !== "round-wind-47684434" || link.branch !== "production") throw new Error("Destino diferente do autorizado para esta preparação.");
  const url = new URL(env.DATABASE_URL_UNPOOLED ?? "");
  if (!url.hostname.endsWith(".neon.tech") || url.hostname.includes("-pooler") || url.searchParams.get("sslmode") === "disable") {
    throw new Error("Informe a conexão direta com SSL recebida do Neon.");
  }
  url.searchParams.set("sslmode", "verify-full");
  const directory = resolve(root, "server/.local/neon", link.projectId);
  await mkdir(directory, { recursive: true });
  const manifestPath = resolve(directory, "state.json");
  type State = { host: string; tenantId: string; controlPassword: string; tenantPassword: string; authSecret: string };
  let state: State;
  try { state = JSON.parse(await readFile(manifestPath, "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const secret = () => randomBytes(48).toString("base64url");
    state = { host: url.hostname, tenantId: randomUUID(), controlPassword: secret(), tenantPassword: secret(), authSecret: secret() };
    await writeFile(manifestPath, JSON.stringify(state), { flag: "wx", mode: 0o600 });
  }
  if (state.host !== url.hostname || !/^[0-9a-f-]{36}$/.test(state.tenantId) ||
      ![state.controlPassword, state.tenantPassword, state.authSecret].every((value) => /^[A-Za-z0-9_-]{40,128}$/.test(value))) {
    throw new Error("Configuração privada incompatível. Preserve os arquivos existentes.");
  }
  const prefix = `sistem_${createHash("sha256").update(link.projectId).digest("hex").slice(0, 10)}`;
  const databases = await prepareRemoteDatabases({ adminUrl: url.toString(), prefix, credentials: state });
  const runtime = `BETTER_AUTH_SECRET=${state.authSecret}\nCONTROL_DATABASE_URL=${databases.controlUrl}\nTENANT_DATABASE_URLS='${JSON.stringify({ main: databases.tenantUrl })}'\n`;
  const target = resolve(root, ".env.neon.local");
  const temporary = resolve(directory, `runtime-${randomUUID()}.tmp`);
  await writeFile(temporary, runtime, { mode: 0o600, flag: "wx" });
  await rename(temporary, target);
  return { ...databases, tenantId: state.tenantId, envPath: target };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void setupNeon(process.env).then(() => {
    console.log("Bancos Neon preparados e conexões de runtime verificadas. Arquivo privado: .env.neon.local. A criação do primeiro gestor é uma etapa separada.");
  }).catch(() => {
    console.error("Preparação Neon falhou. Confira login, projeto/branch, SSL, permissões e configuração privada; nenhum banco ou arquivo existente foi descartado.");
    process.exitCode = 1;
  });
}
