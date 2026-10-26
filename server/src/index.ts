import { Pool } from "pg";
import { buildApp } from "./app.js";
import { readConfig } from "./config.js";

async function main() {
  if (process.argv.includes("--help")) {
    console.log("Sistem API: configure o ambiente privado e execute npm.cmd run dev ou npm.cmd start. Use db:local e setup:local somente em desenvolvimento local.");
    return;
  }
  const config = readConfig(process.env);
  const controlPool = new Pool({ connectionString: config.controlDatabaseUrl, max: 2,
    connectionTimeoutMillis: 1000, idleTimeoutMillis: 10000, statement_timeout: 5000 });
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    try { await app?.close(); } finally { await controlPool.end(); }
  };
  try {
    app = await buildApp({ config, controlPool });
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    await close();
    throw error;
  }
  const shutdown = () => { void close().catch(() => { process.exitCode = 1; console.error("Não foi possível encerrar a API de forma regular."); }); };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  console.log("Sistem API iniciada. Consulte /health/live e /health/ready antes do uso.");
}

void main().catch(() => {
  // Connection strings, credentials and raw library errors never belong in terminal output.
  console.error("Não foi possível iniciar a API. Confira a configuração privada, a porta e a disponibilidade dos bancos.");
  process.exitCode = 1;
});
