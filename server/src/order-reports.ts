import type { OrderFilters, OrderReport, OrderStage } from "../../shared/order-report.js";
import { invalidInput, unavailable } from "./errors.js";
import { financeNeed, type FinanceAccess } from "./finance.js";
import { reportExportLimit, reportInteger, reportQuery, reportTransaction } from "./report-query.js";

const stages: OrderStage[] = ["received", "diagnosing", "awaiting_approval", "in_progress", "quality_check", "ready_for_pickup", "delivered", "closed_without_repair"];
function filters(raw: unknown, exporting: boolean) {
  const { input, common, limit, offset } = reportQuery(raw, ["stage", "approval"], exporting);
  const stage = input.stage === undefined || input.stage === "all" ? "all" : stages.find(stage => stage === input.stage);
  const approval = input.approval ?? "all";
  if (!stage || (approval !== "all" && approval !== "approved" && approval !== "pending")) throw invalidInput();
  const selected: OrderFilters = { ...common, stage, approval };
  return { selected, limit, offset };
}

// This is a current operational snapshot, selected by creation date. Approval is not a payment or debt.
const selection = `WITH selected AS (
  SELECT id,created_at,body,
    body->'laborCents'='null'::jsonb AS unpriced,
    CASE WHEN jsonb_typeof(body->'laborCents')='number' THEN (body->>'laborCents')::numeric END AS labor,
    CASE WHEN jsonb_typeof(body->'number')='number' THEN (body->>'number')::numeric END AS number
  FROM operational_records WHERE entity_type='order'
    AND created_at >= ($1::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
    AND created_at < (($2::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
    AND ($3='' OR strpos(lower(body->>'customerName'),lower($3))>0)
    AND ($4='all' OR body->>'stage'=$4)
    AND ($5='all' OR ($5='approved' AND body->'approved'='true'::jsonb) OR ($5='pending' AND body->'approved'='false'::jsonb))
)`;

export async function readOrderReport(access: FinanceAccess, raw: unknown, exporting = false): Promise<OrderReport> {
  financeNeed(access, "finance.read"); financeNeed(access, "orders.read");
  const { selected, limit, offset } = filters(raw, exporting);
  const values = [selected.from, selected.to, selected.q, selected.stage, selected.approval];
  return reportTransaction(access, async client => {
    const aggregate = (await client.query<{ count: string; labor: string; approved: string; unapproved: string; unpriced: string; invalid: string; at: Date }>(
      `${selection} SELECT count(*)::text AS count,COALESCE(sum(labor),0)::text AS labor,
        COALESCE(sum(labor) FILTER(WHERE body->'approved'='true'::jsonb),0)::text AS approved,
        COALESCE(sum(labor) FILTER(WHERE body->'approved'='false'::jsonb),0)::text AS unapproved,
        count(*) FILTER(WHERE unpriced)::text AS unpriced,
        count(*) FILTER(WHERE (labor IS NULL AND unpriced IS DISTINCT FROM true) OR labor<0 OR trunc(labor)<>labor
          OR (unpriced AND (body->'approved' IS DISTINCT FROM 'false'::jsonb
            OR COALESCE(body->>'stage','') NOT IN ('received','diagnosing','awaiting_approval','closed_without_repair')))
          OR number IS NULL OR number<1 OR trunc(number)<>number OR number>2147483646
          OR jsonb_typeof(body->'customerName') IS DISTINCT FROM 'string'
          OR (jsonb_typeof(body->'technicianName') IS DISTINCT FROM 'string'
            AND (body->'technicianName' IS DISTINCT FROM 'null'::jsonb
              OR body->'technicianId' IS DISTINCT FROM 'null'::jsonb
              OR COALESCE(body->>'stage','') NOT IN ('received','closed_without_repair')))
          OR jsonb_typeof(body->'equipment') IS DISTINCT FROM 'string'
          OR jsonb_typeof(body->'approved') IS DISTINCT FROM 'boolean'
          OR COALESCE(body->>'stage','') NOT IN ('received','diagnosing','awaiting_approval','in_progress','quality_check','ready_for_pickup','delivered','closed_without_repair'))::text AS invalid,
        transaction_timestamp() AS at FROM selected`, values)).rows[0];
    if (reportInteger(aggregate.invalid)) throw unavailable();
    const totals = { count: reportInteger(aggregate.count), laborCents: reportInteger(aggregate.labor), approvedCents: reportInteger(aggregate.approved), unapprovedCents: reportInteger(aggregate.unapproved), unpricedCount: reportInteger(aggregate.unpriced) };
    reportExportLimit(totals.count, exporting);
    const rows = (await client.query<{
      id: string; created_at: Date; date: string; number: string; customer_name: string; technician_name: string | null; equipment: string;
      stage: OrderStage; approved: boolean; labor: string | null;
    }>(`${selection} SELECT id,created_at,(created_at AT TIME ZONE 'America/Sao_Paulo')::date::text AS date,number::text,
      body->>'customerName' AS customer_name,body->>'technicianName' AS technician_name,body->>'equipment' AS equipment,
      body->>'stage' AS stage,body->'approved'='true'::jsonb AS approved,labor::text
      FROM selected ORDER BY created_at DESC,id DESC LIMIT $6 OFFSET $7`, [...values, limit, offset])).rows;
    const items = rows.map(row => ({ id: row.id, number: reportInteger(row.number), at: row.created_at.toISOString(), date: row.date,
      customerName: row.customer_name, technicianName: row.technician_name, equipment: row.equipment,
      stage: row.stage, approved: row.approved, laborCents: row.labor === null ? null : reportInteger(row.labor) }));
    return { tenantId: access.tenantId, filters: selected, generatedAt: aggregate.at.toISOString(), limit, offset, totals, items };
  });
}
