import type { PoolClient } from "pg";
import { civilDate } from "../../shared/finance-planner.mjs";
import { allowedKeys, inputRecord } from "./customers.js";
import { ApiError, forbidden, invalidInput, unavailable } from "./errors.js";
import { financeNeed, type FinanceAccess } from "./finance.js";

export function reportInteger(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) throw unavailable();
  return value;
}
export function reportDate(raw: unknown): string {
  try { return civilDate(raw); } catch { throw invalidInput(); }
}
function pageNumber(raw: unknown, fallback: number, min: number, max: number): number {
  if (raw === undefined) return fallback;
  if (typeof raw !== "string" || !/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) throw invalidInput();
  return reportInteger(raw);
}
export function reportQuery(raw: unknown, extra: string[], exporting: boolean) {
  const input = inputRecord(raw);
  allowedKeys(input, ["from", "to", "q", ...extra, ...(exporting ? [] : ["limit", "offset"])]);
  const from = reportDate(input.from), to = reportDate(input.to);
  if (from > to || (input.q !== undefined && (typeof input.q !== "string" || input.q.length > 120 || input.q.includes("\u0000")))) throw invalidInput();
  return { input, common: { from, to, q: typeof input.q === "string" ? input.q.trim() : "" },
    limit: exporting ? 10000 : pageNumber(input.limit, 25, 1, 100), offset: exporting ? 0 : pageNumber(input.offset, 0, 0, 1000000) };
}
export function reportExportLimit(count: number, exporting: boolean) {
  if (exporting && count > 10000) throw new ApiError(413, "REPORT_TOO_LARGE", "Refine os filtros para exportar até 10 mil registros.");
}
export async function reportTransaction<T>(access: FinanceAccess, read: (client: PoolClient) => Promise<T>): Promise<T> {
  financeNeed(access, "finance.read");
  let client: PoolClient | undefined, broken = false;
  try {
    client = await access.pool.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const binding = (await client.query("SELECT tenant_id FROM tenant_admission WHERE singleton=true")).rows[0];
    if (binding?.tenant_id !== access.tenantId) throw forbidden();
    const result = await read(client);
    await client.query("COMMIT"); return result;
  } catch (error) {
    if (client) { try { await client.query("ROLLBACK"); } catch { broken = true; } }
    if (error instanceof ApiError) throw error;
    throw unavailable();
  } finally { client?.release(broken); }
}
