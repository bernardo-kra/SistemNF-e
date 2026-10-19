import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { assertLocalPath, createLocalDatabase, databaseUrl, freePort, localRoot, secret, startPortablePostgres } from "./portable-postgres.js";

export async function createTestCluster() {
  const root = resolve(localRoot, "tests");
  await mkdir(root, { recursive: true });
  const directory = assertLocalPath(await mkdtemp(resolve(root, "run-")));
  const credentials = { port: await freePort(), user: "sistem_test_admin", password: secret() };
  const postgres = await startPortablePostgres(directory, credentials);
  const adminDatabaseUrl = databaseUrl(credentials, "postgres");
  const admin = new Pool({ connectionString: adminDatabaseUrl, max: 2 });
  const databases: Awaited<ReturnType<typeof createLocalDatabase>>[] = [];
  let stopped = false;
  return {
    admin, host: "127.0.0.1", port: credentials.port, adminDatabaseUrl,
    async createDatabase(key: string) {
      const database = await createLocalDatabase(admin, credentials, key);
      databases.push(database);
      return database;
    },
    async stop() {
      if (stopped) return;
      await Promise.all(databases.map((database) => database.migrationPool.end()));
      await admin.end();
      await postgres.stop();
      // Absolute target checked again before recursive cleanup; only this run is removed.
      const target = assertLocalPath(directory);
      if (!target.startsWith(`${root}\\run-`) && !target.startsWith(`${root}/run-`)) throw new Error("Diretório de teste inválido.");
      await rm(target, { recursive: true, force: true });
      stopped = true;
    },
  };
}
