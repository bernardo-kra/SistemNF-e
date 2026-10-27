import type { Pool } from "pg";

export function validateNeonOwnerTarget(adminText: string, runtimeText: string, expectedHost: string, expectedDatabase: string) {
  const admin = new URL(adminText), runtime = new URL(runtimeText);
  if (!expectedHost.endsWith(".neon.tech") || expectedHost.includes("-pooler") ||
      admin.hostname !== expectedHost || runtime.hostname !== expectedHost || runtime.pathname !== `/${expectedDatabase}` ||
      ![admin, runtime].every((url) => ["postgresql:", "postgres:"].includes(url.protocol))) {
    throw new Error("Destino administrativo diferente do banco de controle esperado.");
  }
  admin.pathname = runtime.pathname;
  admin.searchParams.set("sslmode", "verify-full");
  return admin;
}

export async function verifyNeonControlMarker(pool: Pool, prefix: string) {
  const result = await pool.query("SELECT scope FROM public.sistem_environment WHERE id=true");
  if (result.rows.length !== 1 || result.rows[0].scope !== `${prefix}:control`) throw new Error("Marcador do banco de controle incompatível.");
}
