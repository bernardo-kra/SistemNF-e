import { expect, test } from "@playwright/test";
import {
  accountBalance,
  closeCashShift,
  financeSummary,
  financialDate,
  installmentBalance,
  openCashShift,
  orderReceived,
  parseMoney,
  prepareAgreement,
  previewAgreement,
  recordPayment,
  sourceAgreement,
} from "../src/lib/finance/engine";
import type { AgreementInput, PaymentInput } from "../src/lib/finance/types";
import { restoreDemoState } from "../src/lib/demo-persistence";
import { financeAt, financeFixture } from "./finance-fixtures";
import type { DemoState } from "../src/lib/domain";

const agreementInput = (
  overrides: Partial<AgreementInput> = {},
): AgreementInput => ({
  source: { type: "sale", id: "s400" },
  downPayment: 30000,
  downPaymentDue: "2026-10-16",
  installmentCount: 3,
  firstDue: "2026-11-16",
  ...overrides,
});
function withAgreement(input = agreementInput(), state = financeFixture()) {
  return prepareAgreement(state, input, "qa-agreement", financeAt);
}
function paymentInput(
  state: DemoState,
  overrides: Partial<PaymentInput> = {},
): PaymentInput {
  return {
    installmentId: state.finance.installments[0].id,
    amount: 20000,
    method: "pix",
    accountId: "bank-demo",
    confirmedBy: "Operadora QA",
    reference: "CREDITO-FICTICIO-001",
    creditConfirmed: true,
    idempotencyKey: "qa-attempt-1",
    ...overrides,
  };
}

test("parcelamento cria entrada e parcelas sem gerar dinheiro ou alterar operação", () => {
  const original = financeFixture();
  const before = structuredClone(original);
  const state = withAgreement(agreementInput(), original);
  const agreement = sourceAgreement(state, { type: "sale", id: "s400" })!;
  expect(agreement).toMatchObject({
    commercialTotal: 120000,
    legacyReceived: 0,
    principal: 120000,
  });
  expect(state.finance.installments.map((item) => item.amount)).toEqual([
    30000, 30000, 30000, 30000,
  ]);
  expect(
    state.finance.installments.reduce((sum, item) => sum + item.amount, 0),
  ).toBe(agreement.principal);
  expect(state.finance.movements).toEqual([]);
  expect(state.finance.payments).toEqual([]);
  expect(financeSummary(state, "2026-10-16").available).toBe(0);
  expect({
    products: state.products,
    orders: state.orders,
    sales: state.sales,
    documents: state.documents,
  }).toEqual({
    products: before.products,
    orders: before.orders,
    sales: before.sales,
    documents: before.documents,
  });
  expect(original).toEqual(before);
});

test("rateio conserva centavos e âncora mensal atravessando fevereiro e ano bissexto", () => {
  const input = agreementInput({
    downPayment: 0,
    installmentCount: 3,
    firstDue: "2027-01-31",
  });
  const preview = previewAgreement(financeFixture(10000), input);
  expect(preview.schedule.map((item) => item.amount)).toEqual([
    3334, 3333, 3333,
  ]);
  expect(preview.schedule.map((item) => item.due)).toEqual([
    "2027-01-31",
    "2027-02-28",
    "2027-03-31",
  ]);
  expect(
    previewAgreement(financeFixture(10000), {
      ...input,
      firstDue: "2028-01-31",
    }).schedule.map((item) => item.due),
  ).toEqual(["2028-01-31", "2028-02-29", "2028-03-31"]);
  expect(
    previewAgreement(financeFixture(10000), {
      ...input,
      firstDue: "2026-12-31",
    }).schedule.map((item) => item.due),
  ).toEqual(["2026-12-31", "2027-01-31", "2027-02-28"]);
});

test("vencimentos individuais preservam soma e rejeitam data inválida, faltante ou fora de ordem", () => {
  const state = financeFixture(10000);
  const input = agreementInput({
    downPayment: 1000,
    installmentCount: 3,
    firstDue: "2026-11-16",
    installmentDueDates: ["2026-11-20", "2026-12-10", "2027-01-25"],
  });
  const preview = previewAgreement(state, input);
  expect(preview.schedule.map((item) => item.due)).toEqual([
    "2026-10-16",
    "2026-11-20",
    "2026-12-10",
    "2027-01-25",
  ]);
  expect(preview.schedule.map((item) => item.amount)).toEqual([
    1000, 3000, 3000, 3000,
  ]);
  for (const installmentDueDates of [
    ["2026-11-20"],
    ["2026-11-20", "2026-11-19", "2027-01-25"],
    ["2026-10-15", "2026-12-10", "2027-01-25"],
    ["2026-11-31", "2026-12-10", "2027-01-25"],
  ])
    expect(() =>
      previewAgreement(state, { ...input, installmentDueDates }),
    ).toThrow();
});

test("datas inválidas, parcelas sem centavo e valores inseguros são rejeitados atomicamente", () => {
  const state = financeFixture(10000);
  const before = structuredClone(state);
  for (const change of [
    { downPayment: -1 },
    { downPayment: 0.5 },
    { downPayment: NaN },
    { downPayment: Number.MAX_SAFE_INTEGER + 1 },
    { downPayment: 10001 },
    { downPayment: 0, installmentCount: 0 },
    { downPayment: 0, installmentCount: 1.5 },
    { downPayment: 9999, installmentCount: 2 },
    { downPayment: 0, firstDue: "2027-02-30" },
    { downPayment: 0, firstDue: "2027-2-01" },
    { downPayment: 100, downPaymentDue: "2026-02-29" },
    { downPayment: 100, downPaymentDue: "2026-12-01", firstDue: "2026-11-30" },
  ]) {
    expect(() =>
      prepareAgreement(state, agreementInput(change), "invalid", financeAt),
    ).toThrow();
    expect(state).toEqual(before);
  }
  expect(
    previewAgreement(
      state,
      agreementInput({ downPayment: 10000, installmentCount: 0 }),
    ).schedule,
  ).toEqual([
    {
      kind: "down_payment",
      number: 0,
      count: 1,
      amount: 10000,
      due: "2026-10-16",
    },
  ]);
});

test("valor digitado usa centavos exatos e rejeita ambiguidade ou arredondamento silencioso", () => {
  expect(parseMoney("0,01")).toBe(1);
  expect(parseMoney("100.10")).toBe(10010);
  expect(parseMoney(" 333,34 ")).toBe(33334);
  for (const value of [
    "",
    "1.005",
    "1e2",
    "-1",
    "1.000,00",
    "NaN",
    "Infinity",
    "90071992547410.00",
  ])
    expect(() => parseMoney(value)).toThrow();
});

test("OS exige aprovação e parcela somente saldo após legado congelado", () => {
  const state = financeFixture();
  expect(() =>
    withAgreement(
      agreementInput({ source: { type: "order", id: "o1042" } }),
      state,
    ),
  ).toThrow(/aprovado/i);
  const result = withAgreement(
    agreementInput({
      source: { type: "order", id: "o1041" },
      downPayment: 0,
      installmentCount: 1,
    }),
    state,
  );
  const agreement = result.finance.agreements[0];
  expect(agreement).toMatchObject({
    commercialTotal: 19500,
    legacyReceived: 10000,
    principal: 9500,
  });
  const paid = recordPayment(
    result,
    paymentInput(result, { amount: 2000 }),
    "qa-payment",
    financeAt,
  );
  const order = paid.orders.find((item) => item.id === "o1041")!;
  expect(order.received).toBe(10000);
  expect(orderReceived(paid, order)).toBe(12000);
  expect(installmentBalance(paid, paid.finance.installments[0].id)).toBe(7500);
  expect(accountBalance(paid, "bank-demo", "2026-10-16")).toBe(2000);
  expect(paid.orders).toEqual(state.orders);
});

test("origem única, total divergente, cliente ausente e OS quitada bloqueiam novo acordo", () => {
  const state = withAgreement();
  expect(() =>
    prepareAgreement(state, agreementInput(), "another", financeAt),
  ).toThrow(/acordo/i);
  expect(() =>
    withAgreement(agreementInput({ source: { type: "sale", id: "missing" } })),
  ).toThrow();
  expect(() =>
    withAgreement(
      agreementInput({
        source: { type: "order", id: "o1040" },
        downPayment: 0,
      }),
    ),
  ).toThrow();
  const wrongTotal = financeFixture();
  wrongTotal.sales.find((item) => item.id === "s400")!.total++;
  expect(() => withAgreement(agreementInput(), wrongTotal)).toThrow(/total/i);
  const missingCustomer = financeFixture();
  missingCustomer.customers = missingCustomer.customers.filter(
    (item) => item.id !== "c3",
  );
  expect(() => withAgreement(agreementInput(), missingCustomer)).toThrow(
    /cliente/i,
  );
});

test("Pix/transferência exigem crédito conferido, referência, responsável e conta bancária", () => {
  const state = withAgreement();
  for (const method of ["pix", "transfer"] as const) {
    for (const change of [
      { creditConfirmed: false },
      { reference: "" },
      { confirmedBy: " " },
      { accountId: "cash-demo" },
      { accountId: "missing" },
      { shiftId: "shift-irrelevant" },
      { tendered: 30000 },
    ])
      expect(() =>
        recordPayment(
          state,
          paymentInput(state, { method, ...change }),
          "invalid",
          financeAt,
        ),
      ).toThrow();
    const result = recordPayment(
      state,
      paymentInput(state, { method }),
      "qa-payment",
      financeAt,
    );
    expect(result.finance.payments[0].method).toBe(method);
    expect(result.finance.movements[0]).toMatchObject({
      amount: 20000,
      accountId: "bank-demo",
    });
    expect(installmentBalance(result, state.finance.installments[0].id)).toBe(
      10000,
    );
    expect(result.finance.shifts).toEqual([]);
  }
  const inactive = structuredClone(state);
  inactive.finance.accounts.find((item) => item.id === "bank-demo")!.active =
    false;
  expect(() =>
    recordPayment(inactive, paymentInput(inactive), "invalid", financeAt),
  ).toThrow(/ativa/i);
});

test("dinheiro exige turno da mesma conta e registra somente aplicado após troco", () => {
  const state = withAgreement();
  const input = paymentInput(state, {
    method: "cash",
    accountId: "cash-demo",
    amount: 15000,
    tendered: 20000,
    creditConfirmed: false,
    reference: "",
  });
  expect(() => recordPayment(state, input, "missing-shift", financeAt)).toThrow(
    /turno/i,
  );
  expect(() =>
    openCashShift(
      state,
      { accountId: "bank-demo", operator: "QA" },
      "shift",
      financeAt,
    ),
  ).toThrow(/caixa/i);
  const opened = openCashShift(
    state,
    { accountId: "cash-demo", operator: "QA" },
    "qa-shift",
    financeAt,
  );
  expect(() =>
    openCashShift(
      opened,
      { accountId: "cash-demo", operator: "QA" },
      "second",
      financeAt,
    ),
  ).toThrow(/aberto/i);
  expect(() =>
    recordPayment(
      opened,
      { ...input, shiftId: "other" },
      "wrong-shift",
      financeAt,
    ),
  ).toThrow(/turno/i);
  expect(() =>
    recordPayment(
      opened,
      { ...input, shiftId: "qa-shift", tendered: 14999 },
      "short",
      financeAt,
    ),
  ).toThrow();
  const paid = recordPayment(
    opened,
    { ...input, shiftId: "qa-shift" },
    "qa-payment",
    financeAt,
  );
  expect(paid.finance.payments[0]).toMatchObject({
    amount: 15000,
    tendered: 20000,
    change: 5000,
    shiftId: "qa-shift",
  });
  expect(paid.finance.movements).toHaveLength(1);
  expect(paid.finance.movements[0].amount).toBe(15000);
  expect(accountBalance(paid, "cash-demo", "2026-10-16")).toBe(15000);
  expect(installmentBalance(paid, state.finance.installments[0].id)).toBe(
    15000,
  );
  expect(accountBalance(paid, "bank-demo", "2026-10-16")).toBe(0);
});

test("repetição no mesmo dia ou depois devolve original; chave conflitante não altera saldo", () => {
  const state = withAgreement();
  const input = paymentInput(state);
  const paid = recordPayment(state, input, "qa-payment", financeAt);
  const before = structuredClone(paid);
  expect(recordPayment(paid, input, "duplicate-id", financeAt)).toEqual(before);
  expect(
    recordPayment(paid, input, "another-id", "2026-10-17T12:00:00.000Z"),
  ).toEqual(before);
  expect(() =>
    recordPayment(paid, { ...input, amount: 10000 }, "conflict", financeAt),
  ).toThrow(/chave/i);
  expect(paid).toEqual(before);
  expect(paid.finance.payments).toHaveLength(1);
  expect(paid.finance.allocations).toHaveLength(1);
  expect(paid.finance.movements).toHaveLength(1);
});

test("zero, negativos, frações, excesso e baixa posterior à quitação são rejeitados", () => {
  const state = withAgreement();
  for (const amount of [0, -1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1, 30001])
    expect(() =>
      recordPayment(
        state,
        paymentInput(state, { amount }),
        "invalid",
        financeAt,
      ),
    ).toThrow();
  const paid = recordPayment(
    state,
    paymentInput(state, { amount: 30000 }),
    "full",
    financeAt,
  );
  expect(installmentBalance(paid, state.finance.installments[0].id)).toBe(0);
  expect(() =>
    recordPayment(
      paid,
      paymentInput(paid, { amount: 1, idempotencyKey: "another" }),
      "extra",
      financeAt,
    ),
  ).toThrow(/saldo/i);
});

test("recibo é cópia histórica e segunda baixa não altera valor/saldo do primeiro", () => {
  const state = withAgreement();
  const paid = recordPayment(state, paymentInput(state), "first", financeAt);
  const receipt = structuredClone(paid.finance.payments[0].receipt);
  expect(receipt).toMatchObject({
    sourceLabel: "Venda #400",
    customerName: "Rafael Almeida",
    amount: 20000,
    remaining: 10000,
    method: "pix",
    receivedOn: "2026-10-16",
    confirmedBy: "Operadora QA",
  });
  const changed = structuredClone(paid);
  changed.customers.find((item) => item.id === "c3")!.name =
    "Nome alterado depois";
  changed.fiscalProfile.legalName = "Outra razão social";
  changed.finance.accounts.find((item) => item.id === "bank-demo")!.name =
    "Conta renomeada";
  const final = recordPayment(
    changed,
    paymentInput(changed, {
      amount: 10000,
      idempotencyKey: "second",
      reference: "CREDITO-002",
    }),
    "second",
    financeAt,
  );
  expect(
    final.finance.payments.find((item) => item.id === "first")!.receipt,
  ).toEqual(receipt);
  expect(
    final.finance.payments.find((item) => item.id === "second")!.receipt
      .remaining,
  ).toBe(0);
  expect(final.documents).toEqual(state.documents);
  expect(final.products).toEqual(state.products);
  expect(final.sales).toEqual(state.sales);
});

test("dia financeiro deriva de São Paulo; relógio técnico não usa TODAY nem fuso do host", () => {
  const state = withAgreement();
  expect(financialDate("2026-10-17T01:30:00.000Z")).toBe("2026-10-16");
  expect(financialDate("2026-10-17T03:30:00.000Z")).toBe("2026-10-17");
  const paid = recordPayment(
    state,
    paymentInput(state),
    "qa-payment",
    "2026-10-17T01:30:00.000Z",
  );
  expect(paid.finance.movements[0].date).toBe("2026-10-16");
  expect(paid.finance.payments[0].createdAt).toBe("2026-10-17T01:30:00.000Z");
  const later = recordPayment(
    state,
    paymentInput(state),
    "later",
    "2026-10-17T03:30:00.000Z",
  );
  expect(accountBalance(later, "bank-demo", "2026-10-16")).toBe(0);
  expect(accountBalance(later, "bank-demo", "2026-10-17")).toBe(20000);
});

test("turno de dia anterior não recebe; fechamento e reabertura não criam receita nem ajuste", () => {
  const state = withAgreement();
  // Um fundo confirmado é saldo inicial, nunca um movimento de recebimento.
  state.finance.accounts.find(
    (item) => item.id === "cash-demo",
  )!.openingBalance = 10000;
  const opened = openCashShift(
    state,
    { accountId: "cash-demo", operator: "QA" },
    "shift-1",
    financeAt,
  );
  expect(opened.finance.shifts[0].openingBalance).toBe(10000);
  expect(opened.finance.movements).toEqual([]);
  const input = paymentInput(opened, {
    method: "cash",
    accountId: "cash-demo",
    shiftId: "shift-1",
    amount: 2000,
    tendered: 2000,
    creditConfirmed: false,
  });
  expect(() =>
    recordPayment(opened, input, "late", "2026-10-17T12:00:00.000Z"),
  ).toThrow(/dia/i);
  const paid = recordPayment(opened, input, "payment", financeAt);
  const closed = closeCashShift(
    paid,
    { shiftId: "shift-1", counted: 11900, closedBy: "Gestora QA" },
    financeAt,
  );
  expect(closed.finance.shifts[0]).toMatchObject({
    expected: 12000,
    counted: 11900,
    difference: -100,
    status: "closed",
  });
  expect(closed.finance.movements).toEqual(paid.finance.movements);
  expect(() =>
    recordPayment(
      closed,
      { ...input, amount: 1, idempotencyKey: "closed" },
      "closed-payment",
      financeAt,
    ),
  ).toThrow(/turno/i);
  expect(() =>
    closeCashShift(
      closed,
      { shiftId: "shift-1", counted: 12000, closedBy: "QA" },
      financeAt,
    ),
  ).toThrow();
  const reopened = openCashShift(
    closed,
    { accountId: "cash-demo", operator: "QA2" },
    "shift-2",
    "2026-10-17T12:00:00.000Z",
  );
  expect(reopened.finance.shifts[0].openingBalance).toBe(12000);
  expect(
    reopened.finance.shifts.find((item) => item.id === "shift-1")!.difference,
  ).toBe(-100);
  expect(accountBalance(reopened, "cash-demo", "2026-10-17")).toBe(12000);
  expect(financeSummary(reopened, "2026-10-17").received).toBe(2000);
  expect(reopened.finance.movements).toEqual(paid.finance.movements);
});

test("relógio que retrocede não gera recebimento/fechamento impossível de restaurar", () => {
  const state = withAgreement();
  expect(() =>
    recordPayment(
      state,
      paymentInput(state),
      "early",
      "2026-10-16T11:00:00.000Z",
    ),
  ).toThrow(/anteceder/i);
  const opened = openCashShift(
    state,
    { accountId: "cash-demo", operator: "QA" },
    "shift",
    "2026-10-16T13:00:00.000Z",
  );
  const input = paymentInput(opened, {
    method: "cash",
    accountId: "cash-demo",
    shiftId: "shift",
    tendered: 20000,
  });
  expect(() =>
    recordPayment(opened, input, "early-cash", "2026-10-16T12:30:00.000Z"),
  ).toThrow(/anteceder/i);
  expect(() =>
    closeCashShift(
      opened,
      { shiftId: "shift", counted: 0, closedBy: "QA" },
      "2026-10-16T12:30:00.000Z",
    ),
  ).toThrow(/anteceder/i);
  const paid = recordPayment(
    opened,
    input,
    "payment",
    "2026-10-16T14:00:00.000Z",
  );
  expect(() =>
    closeCashShift(
      paid,
      { shiftId: "shift", counted: 20000, closedBy: "QA" },
      "2026-10-16T13:30:00.000Z",
    ),
  ).toThrow(/anteceder/i);
  const closed = closeCashShift(
    paid,
    { shiftId: "shift", counted: 20000, closedBy: "QA" },
    "2026-10-16T15:00:00.000Z",
  );
  expect(() =>
    openCashShift(
      closed,
      { accountId: "cash-demo", operator: "QA" },
      "too-early",
      "2026-10-16T14:30:00.000Z",
    ),
  ).toThrow(/anteceder/i);
  expect(restoreDemoState(JSON.parse(JSON.stringify(closed))).finance).toEqual(
    closed.finance,
  );
});

test("resumo separa atrasado e previsão futura; recebido não duplica saldo remanescente", () => {
  const state = withAgreement();
  const paid = recordPayment(
    state,
    paymentInput(state),
    "qa-payment",
    "2026-10-17T12:00:00.000Z",
  );
  expect(financeSummary(paid, "2026-10-17")).toMatchObject({
    available: 20000,
    received: 20000,
    open: 100000,
    overdue: 10000,
    future: 90000,
  });
  expect(financeSummary(paid, "2026-10-17").legacy).toBe(44000);
  expect(() => financeSummary(paid, "2026-02-30")).toThrow();
});

test("consulta histórica não usa pagamentos nem acordos criados depois da data-base", () => {
  const state = withAgreement();
  const paid = recordPayment(
    state,
    paymentInput(state),
    "qa-payment",
    "2026-10-17T12:00:00.000Z",
  );
  expect(financeSummary(paid, "2026-10-16")).toMatchObject({
    available: 0,
    received: 0,
    open: 120000,
  });
  expect(
    installmentBalance(paid, paid.finance.installments[0].id, "2026-10-16"),
  ).toBe(30000);
  expect(
    installmentBalance(paid, paid.finance.installments[0].id, "2026-10-17"),
  ).toBe(10000);
  const future = prepareAgreement(
    financeFixture(),
    agreementInput(),
    "future",
    "2026-10-18T12:00:00.000Z",
  );
  expect(financeSummary(future, "2026-10-17")).toMatchObject({
    open: 0,
    overdue: 0,
    future: 0,
  });
});

test("instantes sem fuso ou com calendário impossível não produzem registros financeiros", () => {
  for (const at of [
    "2026-10-16",
    "2026-10-16T12:00:00",
    "2026-02-30T12:00:00Z",
    "2026-10-16T25:00:00Z",
    "invalid",
  ]) {
    expect(() => financialDate(at)).toThrow();
    expect(() =>
      prepareAgreement(financeFixture(), agreementInput(), "invalid", at),
    ).toThrow();
  }
});

test("migração v1/v2 preserva legado sem atribuir conta, data ou dinheiro fictício", () => {
  for (const version of [1, 2]) {
    const { finance: _finance, ...legacy } = financeFixture();
    const restored = restoreDemoState({ ...legacy, version });
    expect(restored.version).toBe(3);
    expect(restored.orders).toEqual(legacy.orders);
    expect(restored.products).toEqual(legacy.products);
    expect(restored.sales).toEqual(legacy.sales);
    expect(restored.customers).toEqual(legacy.customers);
    expect(restored.finance.agreements).toEqual([]);
    expect(restored.finance.payments).toEqual([]);
    expect(restored.finance.movements).toEqual([]);
    expect(financeSummary(restored, "2026-10-17")).toMatchObject({
      available: 0,
      received: 0,
      legacy: 44000,
    });
  }
});

test("restauração v3 preserva acordo, pagamento, recibo e saldos calculados", () => {
  const state = withAgreement();
  const paid = recordPayment(
    state,
    paymentInput(state),
    "qa-payment",
    financeAt,
  );
  const restored = restoreDemoState(JSON.parse(JSON.stringify(paid)));
  expect(restored.finance).toEqual(paid.finance);
  expect(financeSummary(restored, "2026-10-16")).toEqual(
    financeSummary(paid, "2026-10-16"),
  );
  expect(
    orderReceived(
      restored,
      restored.orders.find((item) => item.id === "o1041")!,
    ),
  ).toBe(10000);
});

test("ledger v3 inconsistente é recusado em vez de ser convertido para caixa vazio", () => {
  const state = withAgreement();
  const paid = recordPayment(state, paymentInput(state), "payment", financeAt);
  for (const change of [
    (broken: DemoState) => {
      broken.finance.movements = [];
    },
    (broken: DemoState) => {
      broken.finance.payments[0].amount = -1;
    },
    (broken: DemoState) => {
      broken.finance.allocations.push({
        ...broken.finance.allocations[0],
        id: "duplicated-allocation",
      });
    },
    (broken: DemoState) => {
      broken.finance.installments[0].due = "2026-02-30";
    },
  ]) {
    const broken = structuredClone(paid);
    change(broken);
    const before = structuredClone(broken);
    expect(() => restoreDemoState(broken)).toThrow();
    expect(broken).toEqual(before);
  }
});

test("restauração não aceita origem de OS alterada depois de firmado o acordo", () => {
  const state = withAgreement(
    agreementInput({
      source: { type: "order", id: "o1041" },
      downPayment: 0,
      installmentCount: 1,
    }),
  );
  for (const change of [
    { customerId: "c1" },
    { parts: 4501 },
    { labor: 15001 },
    { received: 10001 },
    { approved: false },
  ]) {
    const broken = structuredClone(state);
    Object.assign(
      broken.orders.find((item) => item.id === "o1041")!,
      change,
    );
    expect(() => restoreDemoState(broken)).toThrow();
  }
});
