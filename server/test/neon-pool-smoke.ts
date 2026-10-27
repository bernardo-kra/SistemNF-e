import assert from "node:assert/strict";
import net from "node:net";
import { performance } from "node:perf_hooks";
import { Pool } from "pg";
import { operationalPoolOptions } from "../src/operational-pool.ts";

// Opt-in, somente leitura: proxy loopback atrasa o handshake em 1s, preservando
// validação TLS do hostname Neon. Não cria registros nem abre a aplicação local.
const source = new URL(JSON.parse(process.env.TENANT_DATABASE_URLS ?? "{}").main);
assert.ok(source.hostname.endsWith(".neon.tech"));
const sockets = new Set<net.Socket>();
const server = net.createServer((client) => {
  sockets.add(client); client.on("close", () => sockets.delete(client)); client.on("error", () => {});
  const timer = setTimeout(() => {
    if (client.destroyed) return;
    const remote = net.connect({ host: source.hostname, port: Number(source.port || 5432) });
    sockets.add(remote); remote.on("close", () => { sockets.delete(remote); client.destroy(); });
    remote.on("error", () => client.destroy()); client.on("close", () => remote.destroy());
    client.pipe(remote); remote.pipe(client);
  }, 1000);
  client.on("close", () => clearTimeout(timer));
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address(); assert.ok(address && typeof address !== "string");
const options = operationalPoolOptions(source.toString());
const pool = new Pool({ ...options, connectionString: undefined, host: "127.0.0.1", port: address.port,
  user: decodeURIComponent(source.username), password: decodeURIComponent(source.password), database: source.pathname.slice(1),
  ssl: { rejectUnauthorized: true, servername: source.hostname } });
const start = performance.now();
try {
  const result = await pool.query("SELECT 1::int AS value");
  assert.equal(result.rows[0].value, 1);
  console.log(JSON.stringify({ success: true, tlsVerified: true, artificialDelayMs: 1000, elapsedMs: Math.round(performance.now()-start) }));
} catch {
  console.error(JSON.stringify({ success: false, artificialDelayMs: 1000, elapsedMs: Math.round(performance.now()-start) }));
  process.exitCode = 1;
} finally {
  await pool.end(); for (const socket of sockets) socket.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
