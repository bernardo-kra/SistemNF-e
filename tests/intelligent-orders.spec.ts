import { expect, test } from "@playwright/test";
import { findOrderByCode, orderCode } from "../src/lib/order-code";
import { intelligentFixture } from "./intelligent-helpers";

test("LEI-02/10 código estável contém apenas referência e resolve a situação atual", () => {
  const state = intelligentFixture();
  const original = state.orders[0];
  const code = orderCode(original);
  expect(code).toBe(`SISTEM-OS:${original.id}`);
  expect(code).not.toContain(state.customers[0].name);
  expect(code).not.toContain(state.customers[0].phone);
  expect(code).not.toContain(original.equipment);
  const updated = { ...original, diagnosis: "Diagnóstico revisado", stage: "in_progress" as const };
  expect(orderCode(updated)).toBe(code);
  expect(findOrderByCode([updated], code)).toEqual(updated);
});

test("LEI-08 código inválido, URL, comando e referência desconhecida não executam ou localizam outra OS", () => {
  const state = intelligentFixture();
  const before = structuredClone(state.orders);
  for (const code of ["javascript:alert(1)", "https://example.com/?os=o1042", "SISTEM-OS:../o1042", "SISTEM-OS:o1042?cpf=123", "SISTEM-OS:missing", "SISTEM-OS:" + "A".repeat(65), "o1042"]) {
    expect(findOrderByCode(state.orders, code)).toBeUndefined();
  }
  expect(state.orders).toEqual(before);
});
