import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { readConfig } from "../src/config.js";
import { readBootstrapOwner } from "../src/bootstrap.js";
import { provisionFirstOwner } from "../src/first-owner.js";
import { validateNeonOwnerTarget, verifyNeonControlMarker } from "./neon-target.js";

async function main() {
  const owner = readBootstrapOwner(process.env);
  const root = resolve(import.meta.dirname, "../..");
  const link = JSON.parse(await readFile(resolve(root, ".neon"), "utf8"));
  if (link.projectId !== "round-wind-47684434" || link.branch !== "production") throw new Error("Destino não autorizado.");
  const state = JSON.parse(await readFile(resolve(root, "server/.local/neon", link.projectId, "state.json"), "utf8"));
  const prefix = `sistem_${createHash("sha256").update(link.projectId).digest("hex").slice(0, 10)}`;
  const adminUrl = validateNeonOwnerTarget(process.env.DATABASE_URL_UNPOOLED ?? "", process.env.CONTROL_DATABASE_URL ?? "", state.host, `${prefix}_control`);
  const pool = new Pool({ connectionString: adminUrl.toString(), max: 2, connectionTimeoutMillis: 15000 });
  try {
    await verifyNeonControlMarker(pool, prefix);
    const config = readConfig({ ...process.env, NODE_ENV: "development", API_BASE_URL: "http://127.0.0.1:4000", FRONTEND_ORIGIN: "http://127.0.0.1:4000" });
    await provisionFirstOwner(pool, config, state.tenantId, "main", owner);
    console.log("Gestor preparado. Repetição preserva conta, senha e empresa. Entre em /operacao/ com as credenciais informadas.");
  } finally { await pool.end(); delete process.env.SISTEM_OWNER_PASSWORD; }
}

void main().catch(() => {
  delete process.env.SISTEM_OWNER_PASSWORD;
  console.error("Não foi possível preparar o gestor. Confira dados explícitos, bancos e configuração privada. Nenhuma conta existente foi promovida ou redefinida.");
  process.exitCode = 1;
});
