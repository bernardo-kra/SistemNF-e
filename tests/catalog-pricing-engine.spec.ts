import { expect, test } from "@playwright/test";
import { applyProductPrices, priceWithMarkup, type ProductPriceChange } from "../src/lib/catalog-pricing";
import { contextualFixture } from "./contextual-helpers";

function setup() {
  const state = contextualFixture();
  Object.assign(state.products.find((product) => product.id === "p3")!, { cost: 2000, price: 0, pricePending: true });
  Object.assign(state.products.find((product) => product.id === "p4")!, { cost: 1999, price: 0, pricePending: true });
  const changes: ProductPriceChange[] = [
    { productId: "p3", expectedCost: 2000, expectedPrice: 0, expectedPricePending: true, price: 3000 },
    { productId: "p4", expectedCost: 1999, expectedPrice: 0, expectedPricePending: true, price: 2999 },
  ];
  return { state, changes };
}

test("LPR-D01 acréscimo é percentual sobre compra, com centavos e meio centavo arredondados", () => {
  expect(priceWithMarkup(2000, 5000)).toBe(3000);
  expect(priceWithMarkup(1999, 1250)).toBe(2249);
  expect(priceWithMarkup(5, 1000)).toBe(6);
  expect(priceWithMarkup(18990, 0)).toBe(18990);
  expect(priceWithMarkup(0, 5000)).toBe(0);
});

test("LPR-D02 atribui conjunto sem alterar custo, estoque, operações ou estado de entrada", () => {
  const { state, changes } = setup();
  const before = structuredClone(state);
  const next = applyProductPrices(state, changes);
  const expected = { ...before, products: before.products.map((product) => {
    const change = changes.find((entry) => entry.productId === product.id);
    return change ? { ...product, price: change.price, pricePending: false } : product;
  }) };
  expect(next).toEqual(expected);
  expect(state).toEqual(before);
});

test("LPR-D03 mesma atribuição repetida é inócua e aceita zero explícito", () => {
  const { state, changes } = setup();
  changes[0].price = 0;
  const first = applyProductPrices(state, changes);
  expect(first.products.find((product) => product.id === "p3")).toMatchObject({ price: 0, pricePending: false });
  const beforeRetry = structuredClone(first);
  expect(applyProductPrices(first, changes)).toEqual(beforeRetry);
  expect(first).toEqual(beforeRetry);
});

for (const scenario of [
  { name: "ID ausente", patch: { productId: "nao-existe" } },
  { name: "preço negativo", patch: { price: -1 } },
  { name: "centavos fracionários", patch: { price: 123.45 } },
  { name: "preço acima do limite", patch: { price: 999999901 } },
]) test(`LPR-D04 lote recusa ${scenario.name} sem alteração parcial`, () => {
  const { state, changes } = setup();
  Object.assign(changes[1], scenario.patch);
  const before = structuredClone(state);
  expect(() => applyProductPrices(state, changes)).toThrow();
  expect(state).toEqual(before);
});

test("LPR-D05 lote vazio ou ID repetido é recusado", () => {
  const { state, changes } = setup();
  expect(() => applyProductPrices(state, [])).toThrow();
  expect(() => applyProductPrices(state, [changes[0], { ...changes[0], price: 3500 }])).toThrow();
});

for (const scenario of [
  { name: "custo", patch: { cost: 2300 } },
  { name: "preço", patch: { price: 3500 } },
  { name: "pendência", patch: { pricePending: false } },
]) test(`LPR-D06 alteração concorrente de ${scenario.name} recusa todo o lote`, () => {
  const { state, changes } = setup();
  Object.assign(state.products.find((product) => product.id === "p4")!, scenario.patch);
  const before = structuredClone(state);
  expect(() => applyProductPrices(state, changes)).toThrow();
  expect(state).toEqual(before);
});

test("LPR-D07 repetição revalida custo mesmo se preço de destino já foi atribuído", () => {
  const { state, changes } = setup();
  const first = applyProductPrices(state, changes);
  first.products.find((product) => product.id === "p3")!.cost = 2500;
  const before = structuredClone(first);
  expect(() => applyProductPrices(first, changes)).toThrow();
  expect(first).toEqual(before);
});

test("LPR-D08 limites válidos e entradas inválidas da fórmula não produzem valor inexato", () => {
  expect(priceWithMarkup(999999900, 0)).toBe(999999900);
  expect(priceWithMarkup(1, 999999)).toBe(101);
  for (const [cost, markup] of [[-1, 0], [1.1, 5000], [100, -1], [100, 1.1], [100, 1000000], [999999900, 1], [NaN, 0], [1, Infinity]]) {
    expect(() => priceWithMarkup(cost, markup)).toThrow();
  }
});
