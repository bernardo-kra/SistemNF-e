import { expect, test } from "@playwright/test";
import { applySaleConfirmation, applySaleDelivery } from "../src/lib/sales-engine";
import { prepareAgreement } from "../src/lib/finance/engine";
import { prepareFiscalDocument } from "../src/lib/fiscal/engine";
import { buildReport } from "../src/lib/reports/engine";
import { restoreDemoState } from "../src/lib/demo-persistence";
import { cartFixture, cartSale } from "./cart-helpers";

test("CAR-D01 confirmação reserva conjunto exato, atribui número e mantém físico/demais eixos", () => {
  const state = cartFixture(), before = structuredClone(state), sale = cartSale();
  sale.number = 999999;
  const next = applySaleConfirmation(state, sale);
  const saved = next.sales.find((s) => s.id === sale.id)!;
  expect(saved).toEqual({ ...sale, number: Math.max(401, ...before.sales.map((s) => s.number)) + 1 });
  expect(next).toEqual({ ...before, sales: [saved, ...before.sales], products: before.products.map((p) => ({ ...p, reserved: p.reserved + (p.id === "p3" ? 2 : p.id === "p4" ? 1 : 0) })) });
  expect(state).toEqual(before);
});

test("CAR-D02 quantidades repetidas são agregadas para conferir e reservar o mesmo produto", () => {
  const state = cartFixture(), sale = cartSale();
  sale.items.push({ productId: "p3", quantity: 1, unitPrice: 1099 }); sale.total = 5334;
  const next = applySaleConfirmation(state, sale);
  expect(next.products.find((p) => p.id === "p3")).toMatchObject({ stock: 10, reserved: 5 });
  expect(next.products.find((p) => p.id === "p4")).toMatchObject({ stock: 5, reserved: 2 });
  const invalid = cartSale(); invalid.items.push({ productId: "p3", quantity: 7, unitPrice: 1099 }); invalid.total += 7693;
  expect(() => applySaleConfirmation(state, invalid)).toThrow();
});

test("CAR-D03 itens e preços confirmados são cópias, sem referência mutável do formulário/catálogo", () => {
  const state = cartFixture(), sale = cartSale();
  const next = applySaleConfirmation(state, sale);
  sale.items[0].unitPrice = 1; sale.items.push({ productId: "p6", quantity: 3, unitPrice: 699 });
  next.products.find((p) => p.id === "p3")!.price = 99999;
  expect(next.sales.find((s) => s.id === sale.id)).toMatchObject({ total: 4235, items: [{ productId: "p3", quantity: 2, unitPrice: 1099 }, { productId: "p4", quantity: 1, unitPrice: 2037 }] });
});

test("CAR-D04 confirmação repetida preserva venda/número/reserva inclusive após entrega", () => {
  const sale = cartSale(), first = applySaleConfirmation(cartFixture(), sale);
  expect(applySaleConfirmation(first, { ...sale, number: 98765 })).toEqual(first);
  const delivered = applySaleDelivery(first, sale.id);
  expect(applySaleConfirmation(delivered, sale)).toEqual(delivered);
});

test("CAR-D05 mesmo ID com cliente/data/itens/total diferentes gera conflito", () => {
  const sale = cartSale(), first = applySaleConfirmation(cartFixture(), sale), before = structuredClone(first);
  for (const changed of [{ ...sale, customerId: "c2" }, { ...sale, date: "2026-10-25" }, { ...sale, items: [{ productId: "p3", quantity: 1, unitPrice: 1099 }], total: 1099 }, { ...sale, total: 4236 }]) {
    expect(() => applySaleConfirmation(first, changed)).toThrow(); expect(first).toEqual(before);
  }
});

for (const scenario of ["pendente", "serializado", "sem saldo", "produto ausente", "cliente ausente"]) test(`CAR-D06 ${scenario} recusa conjunto sem reserva parcial`, () => {
  const state = cartFixture(), sale = cartSale(), second = state.products.find((p) => p.id === "p4")!;
  if (scenario === "pendente") second.pricePending = true;
  if (scenario === "serializado") second.serialized = true;
  if (scenario === "sem saldo") second.stock = second.reserved;
  if (scenario === "produto ausente") state.products = state.products.filter((p) => p.id !== "p4");
  if (scenario === "cliente ausente") sale.customerId = "cliente-inexistente";
  const before = structuredClone(state);
  expect(() => applySaleConfirmation(state, sale)).toThrow(); expect(state).toEqual(before);
});

test("CAR-D07 quantidades inválidas, preço, total e carrinho vazio são recusados", () => {
  for (const patch of [{ quantity: 0 }, { quantity: 1.5 }, { quantity: -1 }, { unitPrice: -1 }, { unitPrice: 10.5 }]) {
    const state = cartFixture(), sale = cartSale(); Object.assign(sale.items[1], patch);
    const before = structuredClone(state); expect(() => applySaleConfirmation(state, sale)).toThrow(); expect(state).toEqual(before);
  }
  const state = cartFixture(), sale = cartSale();
  expect(() => applySaleConfirmation(state, { ...sale, items: [], total: 0 })).toThrow();
  expect(() => applySaleConfirmation(state, { ...sale, total: sale.total + 1 })).toThrow();
});

test("CAR-D08 entrega baixa físico/libera reservas uma vez sem pagamento nem fiscal", () => {
  const sale = cartSale(), confirmed = applySaleConfirmation(cartFixture(), sale), before = structuredClone(confirmed);
  const next = applySaleDelivery(confirmed, sale.id);
  expect(next).toEqual({ ...before, sales: before.sales.map((s) => s.id === sale.id ? { ...s, status: "delivered" } : s), products: before.products.map((p) => ({ ...p, stock: p.stock - (p.id === "p3" ? 2 : p.id === "p4" ? 1 : 0), reserved: p.reserved - (p.id === "p3" ? 2 : p.id === "p4" ? 1 : 0) })) });
  expect(confirmed).toEqual(before); expect(applySaleDelivery(next, sale.id)).toEqual(next);
});

for (const scenario of ["produto ausente", "físico insuficiente", "reserva insuficiente", "série legada"]) test(`CAR-D09 entrega com ${scenario} recusa todas as baixas`, () => {
  const state = cartFixture(), sale = { ...cartSale(), number: 900 };
  state.sales.push(sale); state.products.find((p) => p.id === "p3")!.reserved = 4;
  const second = state.products.find((p) => p.id === "p4")!; second.reserved = 2;
  if (scenario === "produto ausente") state.products = state.products.filter((p) => p.id !== "p4");
  if (scenario === "físico insuficiente") second.stock = 0;
  if (scenario === "reserva insuficiente") second.reserved = 0;
  if (scenario === "série legada") second.serialized = true;
  const before = structuredClone(state); expect(() => applySaleDelivery(state, sale.id)).toThrow(); expect(state).toEqual(before);
});

test("CAR-D10 financeiro, preparação fiscal e relatórios consideram todo o conjunto confirmado", () => {
  const sale = cartSale(), confirmed = applySaleConfirmation(cartFixture(), sale);
  const withAgreement = prepareAgreement(confirmed, { source: { type: "sale", id: sale.id }, downPayment: 0, downPaymentDue: "2026-10-24", installmentCount: 2, firstDue: "2026-11-24" }, "qa-cart-agreement", "2026-10-24T12:00:00.000Z");
  expect(withAgreement.finance.agreements.find((a) => a.id === "qa-cart-agreement")).toMatchObject({ commercialTotal: 4235, principal: 4235 });
  expect(withAgreement.finance.installments.filter((i) => i.agreementId === "qa-cart-agreement").map((i) => i.amount)).toEqual([2118, 2117]);
  const document = prepareFiscalDocument(confirmed, { type: "sale", id: sale.id }, "NF-e", "qa-cart-document", "2026-10-24T12:00:00.000Z");
  expect(document.snapshot).toMatchObject({ total: 4235 }); expect(document.snapshot!.lines).toHaveLength(2);
  expect(document.snapshot!.lines.map((line) => line.unitPrice)).toEqual([1099, 2037]);
  const report = buildReport(confirmed, { kind: "sales", from: "2026-10-24", to: "2026-10-24", asOf: "2026-10-24" });
  expect(report.rows.find((row) => row.id === sale.id)).toMatchObject({ commercial: 4235 });
  expect(report.totals).toMatchObject({ commercial: 4235, received: 0 });
  const restored = restoreDemoState(confirmed); expect(restored.sales).toEqual(confirmed.sales); expect(restored.products).toEqual(confirmed.products);
});
