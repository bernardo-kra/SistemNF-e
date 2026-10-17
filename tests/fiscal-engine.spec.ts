import { test, expect } from "@playwright/test";
import { isValidCnpj, isValidCpf } from "../src/lib/fiscal/identifiers";
import {
  prepareFiscalDocument,
  reviewPreparation,
  transitionFiscalDocument,
} from "../src/lib/fiscal/engine";
import { restoreDemoState } from "../src/lib/demo-persistence";
import { seed } from "../src/lib/seed";
import type { DemoState } from "../src/lib/domain";
import type {
  FiscalAction,
  FiscalModel,
  FiscalSource,
} from "../src/lib/fiscal/types";
import { fiscalFixture } from "./fiscal-fixtures";

const at = "2026-10-16T12:00:00.000Z";
const sale: FiscalSource = { type: "sale", id: "s400" };
function prepare(state: DemoState, source = sale, model: FiscalModel = "NF-e") {
  const document = prepareFiscalDocument(
    state,
    source,
    model,
    "qa-document",
    at,
  );
  state.documents.unshift(document);
  return document;
}
function act(state: DemoState, action: FiscalAction, reason?: string) {
  const document = transitionFiscalDocument(
    state,
    "qa-document",
    action,
    at,
    reason,
  );
  state.documents = state.documents.map((d) =>
    d.id === document.id ? document : d,
  );
  return document;
}

test("CPF e CNPJ conferem dígitos, inclusive CNPJ alfanumérico, sem aceitar caracteres disfarçados", () => {
  expect(isValidCnpj("12.ABC.345/01DE-35")).toBe(true);
  expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
  expect(isValidCnpj("12ABC34501DE36")).toBe(false);
  expect(isValidCnpj("00000000000000")).toBe(false);
  expect(isValidCnpj("１２ABC34501DE35")).toBe(false);
  expect(isValidCnpj("12ABC34501DE35!")).toBe(false);
  expect(isValidCpf("123.456.789-09")).toBe(true);
  expect(isValidCpf("12345678900")).toBe(false);
  expect(isValidCpf("11111111111")).toBe(false);
});

test("migração v1 preserva dados operacionais e diferencia exemplos de simulações", () => {
  const {
    fiscalProfile: _profile,
    serviceFiscal: _service,
    ...legacy
  } = structuredClone(seed);
  const restored = restoreDemoState({
    ...legacy,
    version: 1,
    customers: [
      { ...legacy.customers[0], name: "Cadastro anterior" },
      ...legacy.customers.slice(1),
    ],
  });
  expect(restored.version).toBe(3);
  expect(restored.customers[0].name).toBe("Cadastro anterior");
  expect(restored.sales).toEqual(legacy.sales);
  expect(restored.orders).toEqual(legacy.orders);
  expect(restored.products).toEqual(legacy.products);
  expect(restored.fiscalProfile.cnpj).toBe("");
  expect(restored.finance.movements).toEqual([]);
  expect(restored.finance.payments).toEqual([]);
  expect(restored.documents.every((d) => d.mode === "example")).toBe(true);
});

test("preparação bloqueia dados ausentes, totais divergentes e origem incompatível", () => {
  expect(reviewPreparation(seed, sale, "NF-e").snapshot).toBeNull();
  const state = fiscalFixture();
  expect(
    reviewPreparation(state, sale, "NFS-e").issues.some(
      (i) => i.code === "source.model",
    ),
  ).toBe(true);
  state.sales.find((s) => s.id === "s400")!.total++;
  expect(
    reviewPreparation(state, sale, "NF-e").issues.some(
      (i) => i.code === "source.total",
    ),
  ).toBe(true);
  expect(() => prepare(state)).toThrow(/total/i);
});

test("OS exige aprovação na demonstração e separa serviço de peças", () => {
  const state = fiscalFixture();
  const unapproved = reviewPreparation(
    state,
    { type: "order", id: "o1042" },
    "NFS-e",
  );
  expect(unapproved.issues.some((i) => i.code === "source.approval")).toBe(
    true,
  );
  const result = reviewPreparation(
    state,
    { type: "order", id: "o1040" },
    "NFS-e",
  );
  expect(result.issues).toEqual([]);
  expect(result.snapshot!.total).toBe(12000);
  expect(result.snapshot!.excludedParts).toBe(22000);
  expect(result.snapshot!.lines).toHaveLength(1);
  expect(result.snapshot!.taxCalculation).toBe("not_calculated");
});

test("cópia do rascunho não muda com o cadastro e exemplos não aceitam transições", () => {
  const state = fiscalFixture();
  const doc = prepare(state);
  const original = structuredClone(doc.snapshot);
  state.products.find((p) => p.id === "p3")!.name = "Produto alterado depois";
  state.customers.find((c) => c.id === "c3")!.name = "Cliente alterado depois";
  state.fiscalProfile.legalName = "Emitente alterado depois";
  expect(doc.snapshot).toEqual(original);
  expect(() => transitionFiscalDocument(state, "f1", "queue", at)).toThrow(
    /exemplo/,
  );
  expect(() => act(state, "authorize")).toThrow(/estado atual/);
});

test("documento ativo bloqueia duplicidade entre modelos e timeout exige consulta", () => {
  const state = fiscalFixture();
  prepare(state);
  act(state, "queue");
  act(state, "begin");
  act(state, "unknown");
  expect(() =>
    prepareFiscalDocument(state, sale, "NFC-e", "duplicate", at),
  ).toThrow(/documento ativo/);
  expect(() => act(state, "retry")).toThrow(/estado atual/);
  expect(() => act(state, "queue")).toThrow(/estado atual/);
  const recovered = restoreDemoState(JSON.parse(JSON.stringify(state)));
  expect(
    transitionFiscalDocument(
      recovered,
      "qa-document",
      "reconcile_authorized",
      at,
    ).status,
  ).toBe("authorized");
});

test("rejeição permite nova tentativa no mesmo documento e preserva as cópias anteriores", () => {
  const state = fiscalFixture();
  prepare(state);
  act(state, "queue");
  act(state, "begin");
  act(state, "reject");
  const oldName = state.products.find((p) => p.id === "p3")!.name;
  state.products.find((p) => p.id === "p3")!.name = "Nova descrição QA";
  const retry = act(state, "retry");
  expect(retry.id).toBe("qa-document");
  expect(retry.snapshot!.lines[0].description).toBe("Nova descrição QA");
  expect(retry.history![0].snapshot!.lines[0].description).toBe(oldName);
  act(state, "queue");
  act(state, "begin");
  expect(act(state, "authorize").attempts).toBe(2);
  expect(state.documents.filter((d) => d.source?.id === sale.id)).toHaveLength(
    1,
  );
});

test("cancelamento exige confirmação e não altera estoque nem financeiro", () => {
  const state = fiscalFixture();
  const products = structuredClone(state.products);
  const orders = structuredClone(state.orders);
  const sales = structuredClone(state.sales);
  prepare(state);
  act(state, "queue");
  act(state, "begin");
  act(state, "authorize");
  expect(() => act(state, "request_cancel", "curto")).toThrow(/justificativa/);
  expect(
    act(state, "request_cancel", "Cancelamento de teste para conferência")
      .status,
  ).toBe("cancellation_pending");
  expect(() =>
    prepareFiscalDocument(state, sale, "NF-e", "duplicate", at),
  ).toThrow(/documento ativo/);
  expect(act(state, "confirm_cancel").status).toBe("cancelled");
  expect(state.products).toEqual(products);
  expect(state.orders).toEqual(orders);
  expect(state.sales).toEqual(sales);
  expect(
    prepareFiscalDocument(state, sale, "NF-e", "new-document", at).number,
  ).toBe("SIM-000002");
});

test("processamento interrompido por reload pode ser reconciliado sem reenvio", () => {
  const state = fiscalFixture();
  prepare(state);
  act(state, "queue");
  act(state, "begin");
  const restored = restoreDemoState(JSON.parse(JSON.stringify(state)));
  expect(
    transitionFiscalDocument(restored, "qa-document", "reconcile_rejected", at)
      .status,
  ).toBe("rejected");
  expect(() =>
    transitionFiscalDocument(restored, "qa-document", "begin", at),
  ).toThrow(/estado atual/);
});
