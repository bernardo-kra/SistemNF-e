import { orderApprovalChannels, type OrderApprovalChannel, type OrderBudgetRevision } from "../../shared/order-budget.mjs";
import { allowedKeys } from "./customers.js";
import { ApiError, conflict, invalidInput, unavailable } from "./errors.js";

type Body = Record<string, any>;
type Context = { at: string; actorId: string; actorName: string };
const maxRevisions = 100;
export function budgetScope(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 2000 || value.includes("\u0000")) throw invalidInput();
  return value.trim();
}
function revision(scope: string, laborCents: number | null, number: number, source: OrderBudgetRevision["source"], context: Context): OrderBudgetRevision {
  return { revision: number, scope, laborCents, source, ...context };
}
export function initialOrderBudget(scope: string, laborCents: number | null, context: Context) {
  return { budgetScope: scope, budgetRevision: 1, budgetHistory: [revision(scope, laborCents, 1, "created", context)] };
}
function history(body: Body, context: Context): OrderBudgetRevision[] {
  if (!(body.laborCents === null || (Number.isSafeInteger(body.laborCents) && body.laborCents >= 0 && body.laborCents <= 1_000_000_000_000))) throw unavailable();
  if (body.budgetRevision === undefined && body.budgetHistory === undefined && body.budgetScope === undefined)
    return [revision(budgetScope(body.issue), body.laborCents ?? null, 1, "legacy_snapshot", context)];
  const values = body.budgetHistory as OrderBudgetRevision[];
  if (!Array.isArray(values) || values.length < 1 || values.length > maxRevisions || body.budgetRevision !== values.length) throw unavailable();
  for (const [index, value] of values.entries()) {
    if (!value || value.revision !== index + 1 || typeof value.scope !== "string" || !value.scope.trim() || value.scope.length > 2000 ||
      !(value.laborCents === null || (Number.isSafeInteger(value.laborCents) && value.laborCents >= 0 && value.laborCents <= 1_000_000_000_000)) ||
      !["created", "revision", "legacy_snapshot"].includes(value.source) || !Number.isFinite(Date.parse(value.at)) || typeof value.actorId !== "string" || typeof value.actorName !== "string") throw unavailable();
  }
  const current = values[values.length - 1];
  if (current.scope !== body.budgetScope || current.laborCents !== body.laborCents) throw unavailable();
  return values;
}
/** Append only material changes; technical notes never rewrite the offered service. */
export function reviseOrderBudget(body: Body, next: Body, context: Context): Body {
  const oldScope = body.budgetScope ?? body.issue, scope = next.budgetScope ?? oldScope;
  if (scope === oldScope && next.laborCents === body.laborCents) {
    // An older client/editor may echo the initial service; do not partially migrate legacy.
    if (body.budgetScope === undefined) { const { budgetScope: _unchanged, ...preserved } = next; return preserved; }
    return next;
  }
  if (body.approved || body.budgetApproval || body.agreementId) throw conflict();
  const previous = history(body, context);
  if (previous.length >= maxRevisions) throw new ApiError(409, "ORDER_BUDGET_LIMIT", "O limite de versões deste orçamento foi atingido. O histórico foi preservado.");
  const number = previous.length + 1;
  return { ...next, budgetScope: scope, budgetRevision: number, budgetHistory: [...previous, revision(scope, next.laborCents, number, "revision", context)] };
}
export function approveOrderBudget(body: Body, data: Body, context: Context): Body {
  allowedKeys(data, ["id", "version", "budgetRevision", "channel", "reference"]);
  if (!Number.isSafeInteger(data.budgetRevision) || data.budgetRevision < 0 || typeof data.channel !== "string" || !Object.hasOwn(orderApprovalChannels, data.channel)) throw invalidInput();
  if (data.reference !== undefined && (typeof data.reference !== "string" || data.reference.trim().length > 500 || data.reference.includes("\u0000"))) throw invalidInput();
  if (body.approved || body.budgetApproval || body.agreementId || body.stage !== "awaiting_approval" || data.budgetRevision !== (body.budgetRevision ?? 0)) throw conflict();
  if (body.laborCents == null) throw new ApiError(409, "ORDER_BUDGET_REQUIRED", "Defina a mão de obra antes de registrar a aprovação. Zero significa serviço gratuito.");
  const values = history(body, context), current = values[values.length - 1];
  return { ...body, budgetRevision: current.revision, budgetScope: current.scope, budgetHistory: values, approved: true,
    budgetApproval: { revision: current.revision, scope: current.scope, laborCents: current.laborCents, customerId: body.customerId, customerName: body.customerName,
      channel: data.channel as OrderApprovalChannel, reference: data.reference?.trim() ?? "", ...context } };
}
