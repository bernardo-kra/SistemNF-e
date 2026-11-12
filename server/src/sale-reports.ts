import type { SaleFilters, SaleReport } from "../../shared/sale-report.js";
import { invalidInput, unavailable } from "./errors.js";
import { financeNeed, type FinanceAccess } from "./finance.js";
import { reportExportLimit, reportInteger, reportQuery, reportTransaction } from "./report-query.js";

function filters(raw: unknown, exporting: boolean) {
  const { input, common, limit, offset } = reportQuery(raw, ["status"], exporting);
  const status = input.status ?? "all";
  if (status !== "all" && status !== "confirmed" && status !== "delivered") throw invalidInput();
  const selected: SaleFilters = { ...common, status };
  return { selected, limit, offset };
}

// One record per sale. Do not join items, agreements or payments: those multiply commercial values.
// Both breakdown fields were absent in the original, undiscounted sale contract.
const selection = `WITH selected AS (
  SELECT id,created_at,body,
    CASE WHEN jsonb_typeof(body->'totalCents')='number' THEN (body->>'totalCents')::numeric END AS net,
    CASE WHEN NOT body ? 'grossCents' AND NOT body ? 'discountCents' THEN body->'totalCents' ELSE body->'grossCents' END AS raw_gross,
    CASE WHEN NOT body ? 'grossCents' AND NOT body ? 'discountCents' THEN '0'::jsonb ELSE body->'discountCents' END AS raw_discount
  FROM operational_records WHERE entity_type='sale'
    AND created_at >= ($1::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
    AND created_at < (($2::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
    AND ($3='' OR strpos(lower(body->>'customerName'),lower($3))>0)
    AND ($4='all' OR body->>'status'=$4)
), amounts AS (
  SELECT *,CASE WHEN jsonb_typeof(raw_gross)='number' THEN raw_gross::text::numeric END AS gross,
    CASE WHEN jsonb_typeof(raw_discount)='number' THEN raw_discount::text::numeric END AS discount,
    CASE WHEN jsonb_typeof(body->'number')='number' THEN (body->>'number')::numeric END AS number
  FROM selected
)`;

export async function readSaleReport(access: FinanceAccess, raw: unknown, exporting = false): Promise<SaleReport> {
  financeNeed(access, "finance.read"); financeNeed(access, "sales.read");
  const { selected, limit, offset } = filters(raw, exporting);
  const values = [selected.from, selected.to, selected.q, selected.status];
  return reportTransaction(access, async client => {
    const aggregate = (await client.query<{ count: string; gross: string; discount: string; net: string; invalid: string; at: Date }>(
      `${selection} SELECT count(*)::text AS count,COALESCE(sum(gross),0)::text AS gross,
        COALESCE(sum(discount),0)::text AS discount,COALESCE(sum(net),0)::text AS net,
        count(*) FILTER(WHERE gross IS NULL OR discount IS NULL OR net IS NULL
          OR gross<0 OR discount<0 OR net<0 OR trunc(gross)<>gross OR trunc(discount)<>discount OR trunc(net)<>net
          OR gross-discount<>net OR number IS NULL OR number<1 OR trunc(number)<>number OR number>2147483646
          OR jsonb_typeof(body->'customerName') IS DISTINCT FROM 'string'
          OR COALESCE(body->>'status','') NOT IN ('confirmed','delivered'))::text AS invalid,
        transaction_timestamp() AS at FROM amounts`, values)).rows[0];
    if (reportInteger(aggregate.invalid)) throw unavailable();
    const totals = { count: reportInteger(aggregate.count), grossCents: reportInteger(aggregate.gross), discountCents: reportInteger(aggregate.discount), totalCents: reportInteger(aggregate.net) };
    reportExportLimit(totals.count, exporting);
    const rows = (await client.query<{
      id: string; created_at: Date; date: string; number: string; customer_name: string; status: SaleReport["items"][number]["status"];
      gross: string; discount: string; net: string;
    }>(`${selection} SELECT id,created_at,(created_at AT TIME ZONE 'America/Sao_Paulo')::date::text AS date,
      number::text,body->>'customerName' AS customer_name,body->>'status' AS status,
      gross::text,discount::text,net::text FROM amounts ORDER BY created_at DESC,id DESC LIMIT $5 OFFSET $6`, [...values, limit, offset])).rows;
    const items = rows.map(row => ({ id: row.id, number: reportInteger(row.number), at: row.created_at.toISOString(), date: row.date,
      customerName: row.customer_name, status: row.status, grossCents: reportInteger(row.gross), discountCents: reportInteger(row.discount), totalCents: reportInteger(row.net) }));
    return { tenantId: access.tenantId, filters: selected, generatedAt: aggregate.at.toISOString(), limit, offset, totals, items };
  });
}
