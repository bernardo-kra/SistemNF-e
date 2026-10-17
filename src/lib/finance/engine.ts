import { TODAY, sumOrder, type DemoState, type ServiceOrder } from "../domain";
import type {
  AgreementInput,
  CloseShiftInput,
  FinanceSource,
  FinanceState,
  Installment,
  OpenShiftInput,
  PaymentInput,
  PaymentMethod,
} from "./types";

export const methodLabels: Record<PaymentMethod, string> = {
  cash: "Dinheiro",
  pix: "Pix",
  transfer: "Transferência",
};
export const MAX_INSTALLMENTS = 36;
export function financialDate(at = new Date().toISOString()): string {
  timestamp(at);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(at));
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return [part("year"), part("month"), part("day")].join("-");
}
export function defaultFinance(): FinanceState {
  return {
    accounts: [
      {
        id: "cash-demo",
        name: "Caixa da loja · demonstração",
        type: "cash",
        active: true,
        openingBalance: 0,
        openingDate: TODAY,
      },
      {
        id: "bank-demo",
        name: "Banco · demonstração",
        type: "bank",
        active: true,
        openingBalance: 0,
        openingDate: TODAY,
      },
    ],
    shifts: [],
    agreements: [],
    installments: [],
    payments: [],
    allocations: [],
    movements: [],
  };
}
function nonnegative(value: number, label = "Valor") {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(
      `${label} deve ser um número inteiro de centavos não negativo.`,
    );
}
function positive(value: number, label = "Valor") {
  nonnegative(value, label);
  if (!value) throw new Error(`${label} deve ser maior que zero.`);
}
function exactSum(values: number[]) {
  const total = values.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(total))
    throw new Error("A soma ultrapassa o limite seguro de valores.");
  return total;
}
export function isCivilDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T12:00:00Z`);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    Number(value.slice(0, 4)) >= 1900
  );
}
function civilDate(value: string, label: string) {
  if (!isCivilDate(value))
    throw new Error(`${label}: informe uma data válida.`);
}
function timestamp(value: string) {
  const parts =
    typeof value === "string" &&
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (
    !parts ||
    !isCivilDate(parts[1]) ||
    Number(parts[2]) > 23 ||
    Number(parts[3]) > 59 ||
    Number(parts[4]) > 59 ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error(
      "Instante de auditoria inválido; use data e hora ISO com fuso.",
    );
}
export function parseMoney(value: string): number {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized))
    throw new Error(
      "Informe um valor com até duas casas decimais, sem separador de milhar.",
    );
  const [whole, fraction = ""] = normalized.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  nonnegative(cents);
  return cents;
}
export const installmentLabel = (
  item: Pick<Installment, "kind" | "number" | "count">,
) =>
  item.kind === "down_payment"
    ? "Entrada"
    : `Parcela ${item.number}/${item.count}`;
export const sourceAgreement = (state: DemoState, source: FinanceSource) =>
  state.finance.agreements.find(
    (a) => a.source.type === source.type && a.source.id === source.id,
  );
export function installmentBalance(
  state: DemoState,
  installmentId: string,
  asOf?: string,
) {
  if (asOf) civilDate(asOf, "Data-base");
  const item = state.finance.installments.find((i) => i.id === installmentId);
  if (!item) throw new Error("Parcela não encontrada.");
  const payments = asOf
    ? new Set(
        state.finance.payments
          .filter((p) => p.receivedOn <= asOf)
          .map((p) => p.id),
      )
    : null;
  return (
    item.amount -
    exactSum(
      state.finance.allocations
        .filter(
          (a) =>
            a.installmentId === item.id &&
            (!payments || payments.has(a.paymentId)),
        )
        .map((a) => a.amount),
    )
  );
}
export function orderReceived(state: DemoState, order: ServiceOrder) {
  const agreement = sourceAgreement(state, { type: "order", id: order.id });
  const ids = new Set(
    state.finance.installments
      .filter((i) => i.agreementId === agreement?.id)
      .map((i) => i.id),
  );
  return exactSum([
    order.received,
    ...state.finance.allocations
      .filter((a) => ids.has(a.installmentId))
      .map((a) => a.amount),
  ]);
}
export function accountBalance(
  state: DemoState,
  accountId: string,
  asOf = financialDate(),
) {
  civilDate(asOf, "Data-base");
  const account = state.finance.accounts.find((a) => a.id === accountId);
  if (!account) throw new Error("Conta não encontrada.");
  if (asOf < account.openingDate) return 0;
  return exactSum([
    account.openingBalance,
    ...state.finance.movements
      .filter((m) => m.accountId === accountId && m.date <= asOf)
      .map((m) => m.amount),
  ]);
}
export function financeSummary(state: DemoState, asOf = financialDate()) {
  civilDate(asOf, "Data-base");
  const agreements = new Set(
    state.finance.agreements
      .filter((a) => financialDate(a.createdAt) <= asOf)
      .map((a) => a.id),
  );
  const balances = state.finance.installments
    .filter((i) => agreements.has(i.agreementId))
    .map((i) => ({ ...i, balance: installmentBalance(state, i.id, asOf) }));
  const open = exactSum(balances.map((i) => i.balance));
  return {
    available: exactSum(
      state.finance.accounts
        .filter((a) => a.active)
        .map((a) => accountBalance(state, a.id, asOf)),
    ),
    received: exactSum(
      state.finance.movements
        .filter((m) => m.date <= asOf)
        .map((m) => m.amount),
    ),
    open,
    overdue: exactSum(
      balances.filter((i) => i.due < asOf).map((i) => i.balance),
    ),
    future: exactSum(
      balances.filter((i) => i.due >= asOf).map((i) => i.balance),
    ),
    legacy: exactSum(state.orders.map((o) => o.received)),
  };
}
export function financeSource(state: DemoState, source: FinanceSource) {
  if (!source || !["order", "sale"].includes(source.type))
    throw new Error("Origem financeira inválida.");
  let total: number;
  let customerId: string;
  let legacyReceived = 0;
  let label: string;
  if (source.type === "order") {
    const order = state.orders.find((o) => o.id === source.id);
    if (!order || !order.approved)
      throw new Error("Selecione uma OS com orçamento aprovado.");
    total = sumOrder(order);
    customerId = order.customerId;
    legacyReceived = order.received;
    label = `OS #${order.number}`;
  } else {
    const sale = state.sales.find((s) => s.id === source.id);
    if (!sale || !["confirmed", "delivered"].includes(sale.status))
      throw new Error("Selecione uma venda confirmada.");
    total = sale.total;
    customerId = sale.customerId;
    label = `Venda #${sale.number}`;
    const calculated = exactSum(
      sale.items.map((i) => {
        positive(i.quantity, "Quantidade");
        nonnegative(i.unitPrice, "Preço");
        const amount = i.quantity * i.unitPrice;
        nonnegative(amount);
        return amount;
      }),
    );
    if (calculated !== total)
      throw new Error("O total da venda diverge dos itens.");
  }
  positive(total, "Total comercial");
  nonnegative(legacyReceived, "Legado");
  if (legacyReceived > total)
    throw new Error(
      "O valor legado supera o total. Revise a origem antes de criar o acordo.",
    );
  const customer = state.customers.find((c) => c.id === customerId);
  if (!customer) throw new Error("Cliente da origem não encontrado.");
  return {
    sourceLabel: label,
    customerId,
    customerName: customer.name,
    commercialTotal: total,
    legacyReceived,
    principal: total - legacyReceived,
  };
}
export function previewAgreement(state: DemoState, input: AgreementInput) {
  const origin = financeSource(state, input.source);
  positive(origin.principal, "Saldo a parcelar");
  nonnegative(input.downPayment, "Entrada");
  if (input.downPayment > origin.principal)
    throw new Error("A entrada ultrapassa o saldo a parcelar.");
  const schedule: Omit<Installment, "id" | "agreementId">[] = [];
  if (input.downPayment) {
    civilDate(input.downPaymentDue, "Vencimento da entrada");
    schedule.push({
      kind: "down_payment",
      number: 0,
      count: 1,
      amount: input.downPayment,
      due: input.downPaymentDue,
    });
  }
  const remaining = origin.principal - input.downPayment;
  if (
    !Number.isSafeInteger(input.installmentCount) ||
    input.installmentCount < 0 ||
    input.installmentCount > MAX_INSTALLMENTS
  )
    throw new Error(
      `Use de 0 a ${MAX_INSTALLMENTS} parcelas; este é um limite técnico da demonstração.`,
    );
  if (remaining) {
    if (!input.installmentCount || input.installmentCount > remaining)
      throw new Error(
        "Escolha parcelas de pelo menos um centavo para cobrir o saldo.",
      );
    civilDate(input.firstDue, "Primeiro vencimento");
    if (input.downPayment && input.firstDue < input.downPaymentDue)
      throw new Error("O primeiro vencimento não pode anteceder a entrada.");
    const [year, month, day] = input.firstDue.split("-").map(Number);
    const base = Math.floor(remaining / input.installmentCount);
    const residual = remaining % input.installmentCount;
    for (let index = 0; index < input.installmentCount; index++) {
      const start = new Date(Date.UTC(year, month - 1 + index, 1, 12));
      const lastDay = new Date(
        Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0, 12),
      ).getUTCDate();
      start.setUTCDate(Math.min(day, lastDay));
      const due = start.toISOString().slice(0, 10);
      civilDate(due, "Vencimento");
      schedule.push({
        kind: "installment",
        number: index + 1,
        count: input.installmentCount,
        amount: base + (index < residual ? 1 : 0),
        due,
      });
    }
  } else if (input.installmentCount !== 0)
    throw new Error(
      "A entrada cobre o saldo; selecione zero parcelas adicionais.",
    );
  if (input.installmentDueDates !== undefined) {
    if (
      !Array.isArray(input.installmentDueDates) ||
      input.installmentDueDates.length !== input.installmentCount
    )
      throw new Error("Informe um vencimento por parcela adicional.");
    let previous = input.downPayment ? input.downPaymentDue : "";
    for (const item of schedule.filter((i) => i.kind === "installment")) {
      const due = input.installmentDueDates[item.number - 1];
      civilDate(due, "Vencimento ajustado");
      if (due < previous)
        throw new Error(
          "Os vencimentos devem seguir uma ordem não decrescente e respeitar a entrada.",
        );
      item.due = due;
      previous = due;
    }
  }
  if (exactSum(schedule.map((i) => i.amount)) !== origin.principal)
    throw new Error("A soma das parcelas deve corresponder ao saldo.");
  return { ...origin, schedule };
}
export function prepareAgreement(
  state: DemoState,
  input: AgreementInput,
  id: string,
  at: string,
): DemoState {
  timestamp(at);
  if (!id || state.finance.agreements.some((a) => a.id === id))
    throw new Error("Identificador de acordo inválido ou repetido.");
  if (sourceAgreement(state, input.source))
    throw new Error(
      "Esta origem já possui um acordo. Abra as parcelas existentes.",
    );
  const { schedule, ...origin } = previewAgreement(state, input);
  return {
    ...state,
    finance: {
      ...state.finance,
      agreements: [
        { ...origin, id, source: { ...input.source }, createdAt: at },
        ...state.finance.agreements,
      ],
      installments: [
        ...schedule.map((i, index) => ({
          ...i,
          id: `${id}:item:${index}`,
          agreementId: id,
        })),
        ...state.finance.installments,
      ],
    },
  };
}
export function openCashShift(
  state: DemoState,
  input: OpenShiftInput,
  id: string,
  at: string,
): DemoState {
  timestamp(at);
  const asOf = financialDate(at);
  const openedOn = asOf;
  const account = state.finance.accounts.find(
    (a) => a.id === input.accountId && a.active && a.type === "cash",
  );
  if (!account) throw new Error("Selecione uma conta ativa de caixa físico.");
  if (!input.operator.trim()) throw new Error("Informe o operador do caixa.");
  if (openedOn < account.openingDate || openedOn > asOf)
    throw new Error(
      "A abertura deve estar entre o corte da conta e a data-base.",
    );
  if (
    state.finance.shifts.some(
      (s) => s.accountId === account.id && s.status === "open",
    )
  )
    throw new Error("Esta conta já possui um turno aberto.");
  if (!id || state.finance.shifts.some((s) => s.id === id))
    throw new Error("Identificador de turno inválido ou repetido.");
  if (
    state.finance.shifts.some(
      (s) => s.accountId === account.id && s.closedOn && s.closedOn > openedOn,
    )
  )
    throw new Error("A abertura não pode anteceder o último fechamento.");
  if (
    state.finance.shifts.some(
      (s) =>
        s.accountId === account.id &&
        s.closedAt &&
        Date.parse(s.closedAt) > Date.parse(at),
    )
  )
    throw new Error(
      "O instante da abertura não pode anteceder o último fechamento.",
    );
  return {
    ...state,
    finance: {
      ...state.finance,
      shifts: [
        {
          id,
          accountId: account.id,
          operator: input.operator.trim(),
          openedOn: openedOn,
          openedAt: at,
          openingBalance: accountBalance(state, account.id, openedOn),
          status: "open",
        },
        ...state.finance.shifts,
      ],
    },
  };
}
export function closeCashShift(
  state: DemoState,
  input: CloseShiftInput,
  at: string,
): DemoState {
  timestamp(at);
  const asOf = financialDate(at);
  const closedOn = asOf;
  nonnegative(input.counted, "Contagem");
  const shift = state.finance.shifts.find((s) => s.id === input.shiftId);
  if (!shift || shift.status !== "open")
    throw new Error("Selecione um turno aberto.");
  if (!input.closedBy.trim())
    throw new Error("Informe quem conferiu o fechamento.");
  if (closedOn < shift.openedOn || closedOn > asOf)
    throw new Error("Data de fechamento fora do período permitido.");
  if (
    Date.parse(at) < Date.parse(shift.openedAt) ||
    state.finance.payments.some(
      (p) => p.shiftId === shift.id && Date.parse(p.createdAt) > Date.parse(at),
    )
  )
    throw new Error(
      "O fechamento não pode anteceder a abertura ou os recebimentos do turno.",
    );
  const expected = exactSum([
    shift.openingBalance,
    ...state.finance.movements
      .filter((m) => m.shiftId === shift.id)
      .map((m) => m.amount),
  ]);
  return {
    ...state,
    finance: {
      ...state.finance,
      shifts: state.finance.shifts.map((s) =>
        s.id === shift.id
          ? {
              ...s,
              status: "closed",
              counted: input.counted,
              expected,
              difference: input.counted - expected,
              closedOn: closedOn,
              closedAt: at,
              closedBy: input.closedBy.trim(),
            }
          : s,
      ),
    },
  };
}
function canonicalPayment(input: PaymentInput) {
  return {
    installmentId: input.installmentId,
    amount: input.amount,
    method: input.method,
    accountId: input.accountId,
    shiftId: input.shiftId || undefined,
    confirmedBy: input.confirmedBy.trim(),
    reference: input.reference?.trim() || "",
    tendered: input.tendered ?? input.amount,
    creditConfirmed: input.creditConfirmed === true,
  };
}
export function recordPayment(
  state: DemoState,
  input: PaymentInput,
  id: string,
  at: string,
): DemoState {
  timestamp(at);
  const asOf = financialDate(at);
  if (!input.idempotencyKey?.trim())
    throw new Error("Informe a chave de identificação desta tentativa.");
  const request = { ...canonicalPayment(input), receivedOn: asOf };
  const fingerprint = JSON.stringify(canonicalPayment(input));
  const existing = state.finance.payments.find(
    (p) => p.idempotencyKey === input.idempotencyKey,
  );
  if (existing) {
    if (existing.requestFingerprint !== fingerprint)
      throw new Error(
        "Esta chave já foi usada com dados diferentes. Consulte o recebimento antes de repetir.",
      );
    return state;
  }
  if (!id || state.finance.payments.some((p) => p.id === id))
    throw new Error("Identificador de pagamento inválido ou repetido.");
  const item = state.finance.installments.find(
    (i) => i.id === input.installmentId,
  );
  if (!item) throw new Error("Parcela não encontrada.");
  const agreement = state.finance.agreements.find(
    (a) => a.id === item.agreementId,
  );
  if (!agreement) throw new Error("Acordo não encontrado.");
  if (Date.parse(at) < Date.parse(agreement.createdAt))
    throw new Error("O recebimento não pode anteceder o acordo.");
  const before = installmentBalance(state, item.id);
  positive(request.amount);
  if (request.amount > before)
    throw new Error("O valor ultrapassa o saldo da parcela.");
  if (!Object.hasOwn(methodLabels, request.method))
    throw new Error("Forma de pagamento não disponível neste recorte.");
  civilDate(request.receivedOn, "Recebimento");
  const account = state.finance.accounts.find(
    (a) => a.id === request.accountId && a.active,
  );
  if (!account) throw new Error("Selecione uma conta ativa.");
  if (request.receivedOn < account.openingDate || request.receivedOn > asOf)
    throw new Error(
      "O recebimento deve estar entre o corte da conta e a data-base; não pode ser futuro.",
    );
  if (!request.confirmedBy)
    throw new Error("Informe o responsável pela conferência manual.");
  let shiftId: string | undefined;
  let change = 0;
  if (request.method === "cash") {
    if (account.type !== "cash")
      throw new Error("Dinheiro deve entrar em uma conta de caixa físico.");
    const shift = state.finance.shifts.find(
      (s) =>
        s.id === request.shiftId &&
        s.accountId === account.id &&
        s.status === "open",
    );
    if (!shift)
      throw new Error("Abra um turno nesta conta para receber em dinheiro.");
    if (Date.parse(at) < Date.parse(shift.openedAt))
      throw new Error("O recebimento não pode anteceder a abertura do turno.");
    if (request.receivedOn !== shift.openedOn)
      throw new Error(
        "Neste recorte, o recebimento em dinheiro deve ocorrer no dia da abertura do turno.",
      );
    nonnegative(request.tendered, "Valor entregue");
    if (request.tendered < request.amount)
      throw new Error("O valor entregue não cobre a aplicação na parcela.");
    change = request.tendered - request.amount;
    shiftId = shift.id;
  } else {
    if (account.type !== "bank")
      throw new Error("Pix e transferência exigem conta bancária.");
    if (!request.creditConfirmed || !request.reference)
      throw new Error(
        "Confira o crédito e informe referência e responsável; agendamento ou comprovante não confirmam o recebimento.",
      );
    if (request.shiftId)
      throw new Error(
        "Pix e transferência não movimentam um turno de dinheiro.",
      );
    if (request.tendered !== request.amount)
      throw new Error("Pix e transferência não admitem troco.");
  }
  const receipt = {
    code: `REC-DEMO-${String(state.finance.payments.length + 1).padStart(5, "0")}`,
    companyName: state.fiscalProfile.legalName || "Loja · demonstração",
    customerName: agreement.customerName,
    sourceLabel: agreement.sourceLabel,
    installmentLabel: installmentLabel(item),
    due: item.due,
    amount: request.amount,
    remaining: before - request.amount,
    method: request.method,
    accountName: account.name,
    receivedOn: request.receivedOn,
    confirmedBy: request.confirmedBy,
    reference: request.reference,
    tendered: request.tendered,
    change,
  };
  const next: DemoState = {
    ...state,
    finance: {
      ...state.finance,
      payments: [
        {
          id,
          idempotencyKey: input.idempotencyKey,
          requestFingerprint: fingerprint,
          amount: request.amount,
          method: request.method,
          accountId: account.id,
          shiftId,
          receivedOn: request.receivedOn,
          confirmedBy: request.confirmedBy,
          reference: request.reference,
          tendered: request.tendered,
          change,
          createdAt: at,
          receipt,
        },
        ...state.finance.payments,
      ],
      allocations: [
        {
          id: `${id}:allocation`,
          paymentId: id,
          installmentId: item.id,
          amount: request.amount,
        },
        ...state.finance.allocations,
      ],
      movements: [
        {
          id: `${id}:movement`,
          accountId: account.id,
          paymentId: id,
          shiftId,
          date: request.receivedOn,
          amount: request.amount,
          kind: "receipt",
          createdAt: at,
        },
        ...state.finance.movements,
      ],
    },
  };
  // Verify overflow before returning the atomic local update.
  accountBalance(next, account.id, asOf);
  return next;
}
