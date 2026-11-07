import type { InstallmentFilters, InstallmentReport, InstallmentStatus } from "../../shared/installment-report.js";
import { invalidInput, unavailable } from "./errors.js";
import { financeNeed, type FinanceAccess } from "./finance.js";
import { reportDate, reportExportLimit, reportInteger, reportQuery, reportTransaction } from "./report-query.js";

function filters(raw: unknown, exporting: boolean) {
  const { input, common, limit, offset } = reportQuery(raw, ["asOf", "status"], exporting);
  const asOf = reportDate(input.asOf), status = input.status ?? "all";
  if (status !== "all" && status !== "open" && status !== "overdue" && status !== "paid") throw invalidInput();
  const selected: InstallmentFilters = { ...common, asOf, status };
  return { selected, limit, offset };
}

// Cut the immutable ledger at the end of the selected local day, not at today's balance.
const candidates = `WITH paid AS (
  SELECT a.installment_id,sum(a.amount_cents) AS amount
  FROM finance_allocations a JOIN finance_payments p ON p.id=a.payment_id
  WHERE p.at < (($3::date+1)::timestamp AT TIME ZONE 'America/Sao_Paulo') GROUP BY a.installment_id
), balances AS (
  SELECT i.id,i.agreement_id,i.kind,i.number,i.count,i.due,i.created_at,i.amount_cents,
    g.customer_id,g.customer_name,g.source_type,g.source_id,g.source_label,
    COALESCE(paid.amount,0) AS paid_cents,i.amount_cents-COALESCE(paid.amount,0) AS balance_cents
  FROM finance_installments i JOIN finance_agreements g ON g.id=i.agreement_id
  LEFT JOIN paid ON paid.installment_id=i.id
  WHERE i.due BETWEEN $1::date AND $2::date
    AND i.created_at < (($3::date+1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
    AND g.created_at < (($3::date+1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
    AND strpos(lower(g.customer_name),lower($4))>0
), candidates AS (
  SELECT *,CASE WHEN balance_cents=0 THEN 'paid' WHEN due<$3::date THEN 'overdue' ELSE 'open' END AS status
  FROM balances
)`;
const selectedRows = `($5='all' OR ($5='open' AND balance_cents>0) OR ($5='overdue' AND status='overdue') OR ($5='paid' AND status='paid'))`;
type Row = {
  id: string; agreement_id: string; kind: "down_payment" | "installment"; number: number; count: number; due: string;
  customer_id: string; customer_name: string; source_type: "sale" | "order"; source_id: string; source_label: string;
  amount: string; paid: string; balance: string; status: InstallmentStatus;
};
export async function readInstallmentReport(access: FinanceAccess, raw: unknown, exporting = false): Promise<InstallmentReport> {
  financeNeed(access, "finance.read");
  const { selected, limit, offset } = filters(raw, exporting);
  const values = [selected.from, selected.to, selected.asOf, selected.q, selected.status];
  return reportTransaction(access, async client => {
    const aggregate = (await client.query<{ count: string; principal: string; paid: string; balance: string; overdue: string; invalid: boolean; at: Date }>(`${candidates}
      SELECT count(*) FILTER(WHERE ${selectedRows})::text AS count,
        COALESCE(sum(amount_cents) FILTER(WHERE ${selectedRows}),0)::text AS principal,
        COALESCE(sum(paid_cents) FILTER(WHERE ${selectedRows}),0)::text AS paid,
        COALESCE(sum(balance_cents) FILTER(WHERE ${selectedRows}),0)::text AS balance,
        COALESCE(sum(balance_cents) FILTER(WHERE ${selectedRows} AND status='overdue'),0)::text AS overdue,
        COALESCE(bool_or(paid_cents<0 OR balance_cents<0),false) AS invalid,transaction_timestamp() AS at
      FROM candidates`, values)).rows[0];
    // Check inconsistencies before status filtering so an overpayment cannot disappear as "paid".
    if (aggregate.invalid) throw unavailable();
    const totals = { count: reportInteger(aggregate.count), principalCents: reportInteger(aggregate.principal), paidCents: reportInteger(aggregate.paid), balanceCents: reportInteger(aggregate.balance), overdueCents: reportInteger(aggregate.overdue) };
    reportExportLimit(totals.count, exporting);
    const rows = (await client.query<Row>(`${candidates}
      SELECT id,agreement_id,kind,number,count,due::text,customer_id,customer_name,source_type,source_id,source_label,
        amount_cents::text AS amount,paid_cents::text AS paid,balance_cents::text AS balance,status
      FROM candidates WHERE ${selectedRows} ORDER BY due,created_at,id LIMIT $6 OFFSET $7`, [...values, limit, offset])).rows;
    const items = rows.map(row => ({ id: row.id, agreementId: row.agreement_id, customerId: row.customer_id, customerName: row.customer_name,
      sourceType: row.source_type, sourceId: row.source_id, sourceLabel: row.source_label, kind: row.kind, number: row.number, count: row.count,
      due: row.due, amountCents: reportInteger(row.amount), paidCents: reportInteger(row.paid), balanceCents: reportInteger(row.balance),
      overdueCents: row.status === "overdue" ? reportInteger(row.balance) : 0, status: row.status }));
    return { tenantId: access.tenantId, filters: selected, generatedAt: aggregate.at.toISOString(), limit, offset, totals, items };
  });
}
