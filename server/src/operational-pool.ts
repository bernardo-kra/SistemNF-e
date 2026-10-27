import type { PoolConfig } from "pg";

export function operationalPoolOptions(connectionString: string): PoolConfig {
  return { connectionString, max: 2, connectionTimeoutMillis: 15000, idleTimeoutMillis: 10000, statement_timeout: 5000 };
}
