import type { ReceiptFilters, ReceiptReport } from "../../shared/receipt-report.js";
import { invalidInput, unavailable } from "./errors.js";
import { financeNeed, type FinanceAccess } from "./finance.js";
import { reportExportLimit, reportInteger, reportQuery, reportTransaction } from "./report-query.js";

function filters(raw: unknown, exporting: boolean) {
  const { input, common, limit, offset } = reportQuery(raw, ["method"], exporting);
  const method = input.method ?? "";
  if (method !== "" && method !== "cash" && method !== "pix" && method !== "transfer") throw invalidInput();
  const selected: ReceiptFilters = { ...common, method };
  return { selected, limit, offset };
}

// Read the immutable payment, not its allocations/movements: one receipt can settle many titles.
const selection = `FROM finance_payments p
  WHERE p.at >= ($1::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
    AND p.at < (($2::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
    AND strpos(lower(p.receipt->>'customerName'),lower($3))>0
    AND ($4='' OR p.method=$4)`;

export async function readReceiptReport(access: FinanceAccess, raw: unknown, exporting = false): Promise<ReceiptReport> {
  financeNeed(access, "finance.read");
  const { selected, limit, offset } = filters(raw, exporting);
  const values = [selected.from, selected.to, selected.q, selected.method];
  return reportTransaction(access, async client => {
    const aggregate = (await client.query<{ count: string; amount: string; at: Date }>(
      `SELECT count(*)::text AS count,COALESCE(sum(p.amount_cents),0)::text AS amount,transaction_timestamp() AS at ${selection}`, values)).rows[0];
    const totals = { count: reportInteger(aggregate.count), amountCents: reportInteger(aggregate.amount) };
    reportExportLimit(totals.count, exporting);
    const rows = (await client.query<{
      id: string; at: Date; date: string; customer_name: string; account_name: string; actor_name: string;
      method: ReceiptReport["items"][number]["method"]; amount: string;
    }>(`SELECT p.id,p.at,(p.at AT TIME ZONE 'America/Sao_Paulo')::date::text AS date,
      p.receipt->>'customerName' AS customer_name,p.receipt->>'accountName' AS account_name,
      p.receipt->>'receivedByName' AS actor_name,p.method,p.amount_cents::text AS amount
      ${selection} ORDER BY p.at DESC,p.id DESC LIMIT $5 OFFSET $6`, [...values, limit, offset])).rows;
    const items = rows.map(row => {
      if ([row.customer_name, row.account_name, row.actor_name].some(name => typeof name !== "string")) throw unavailable();
      return { id: row.id, at: row.at.toISOString(), date: row.date, customerName: row.customer_name, accountName: row.account_name,
        receivedByName: row.actor_name, method: row.method, amountCents: reportInteger(row.amount) };
    });
    return { tenantId: access.tenantId, filters: selected, generatedAt: aggregate.at.toISOString(), limit, offset, totals, items };
  });
}
