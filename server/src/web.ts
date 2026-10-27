import Fastify from "fastify";
import { Pool } from "pg";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { readConfig } from "./config.js";
import { registerFrontend, webEnvironment } from "./web-host.js";

async function main() {
  const env = process.env;
  const root = fileURLToPath(new URL("../../out/", import.meta.url));
  const apiConfigured = Boolean(env.CONTROL_DATABASE_URL || env.TENANT_DATABASE_URLS);
  if (!apiConfigured && env.DATABASE_URL) throw new Error("Banco Neon recebido, mas a preparação remota da aplicação ainda não foi executada.");
  const { port, host, publicUrl, nodeEnv } = webEnvironment(env);
  let pool: Pool | undefined;
  const app = apiConfigured ? await (async () => {
    const config = readConfig({ ...env, NODE_ENV: nodeEnv, API_PORT: String(port), API_HOST: host,
      API_BASE_URL: env.API_BASE_URL ?? publicUrl, FRONTEND_ORIGIN: env.FRONTEND_ORIGIN ?? publicUrl });
    pool = new Pool({ connectionString: config.controlDatabaseUrl, max: 2, connectionTimeoutMillis: 15000 });
    return buildApp({ config, controlPool: pool, frontendRoot: root });
  })() : Fastify({ logger: false });
  if (!apiConfigured) {
    app.get("/health/live", async () => ({ status: "ok", mode: "demonstration" }));
    app.get("/health/ready", async (_, reply) => reply.code(503).send({ error: { code: "API_NOT_CONFIGURED" } }));
    app.all("/api/*", async (_, reply) => reply.code(503).send({ error: { code: "API_NOT_CONFIGURED" } }));
    await registerFrontend(app, root);
  }
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await app.close();
    await pool?.end();
  };
  process.once("SIGTERM", () => { void close(); });
  process.once("SIGINT", () => { void close(); });
  try { await app.listen({ host, port }); }
  catch (error) { await close(); throw error; }
  console.log(apiConfigured ? "Sistem iniciado: interface e API na mesma origem." : "Sistem iniciado em modo demonstrativo; API e login compartilhado não configurados.");
}

void main().catch(() => {
  console.error("Não foi possível iniciar o Sistem. Confira o build, a porta e a preparação/configuração privada do backend.");
  process.exitCode = 1;
});
