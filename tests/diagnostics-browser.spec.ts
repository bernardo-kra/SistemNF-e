import { expect, test } from "@playwright/test";
import {
  diagnosticKey, diagnosticsPackage, operationalKey, rejectedStockCommand,
  savedOperational, seedDiagnosticsBrowser,
} from "./diagnostics-browser-helpers";

test("LOG-01/02: comando rejeitado preserva estado e código visível corresponde à ocorrência exportada", async ({ page }) => {
  await seedDiagnosticsBrowser(page);
  await page.goto("/demo/estoque/");
  await expect(page.getByRole("row").filter({ hasText: "MOU-LOG" })).toBeVisible();
  const before = await savedOperational(page);
  await rejectedStockCommand(page);
  const alert = page.getByRole("dialog").getByRole("alert");
  await expect(alert).toContainText("Informe o motivo da entrada");
  // Contrato combinado antes do produto: erro original no alerta; ID no status.
  const text = await page.getByRole("status").innerText();
  const match = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  expect(match, "Mensagem deve informar o ID da ocorrência de suporte").not.toBeNull();
  expect(await savedOperational(page)).toBe(before);
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Diagnóstico", exact: true }).click();
  const result = await diagnosticsPackage(page);
  expect(result.events).toHaveLength(1);
  expect(result.events[0]).toMatchObject({ id: match![0], code: "COMMAND_FAILED", operation: "receiveStock", module: "stock", route: "/estoque/" });
  expect(JSON.stringify(result)).not.toMatch(/SEGREDO-URL|Mariana Costa|Rafael Almeida|example\.com|stack|rawError|Motivo/);
  expect(await savedOperational(page)).toBe(before);
});

test("LOG-03/07: erro global e rejeição são controlados uma vez e filtros/recarga não duplicam", async ({ page }) => {
  await seedDiagnosticsBrowser(page);
  await page.goto("/demo/diagnostico/");
  await expect(page.getByRole("heading", { name: "Diagnóstico", exact: true })).toBeVisible();
  // O HTML do título chega antes da hidratação; disparar só com o módulo pronto.
  await expect(page.getByRole("button", { name: "Exportar diagnóstico", exact: true })).toBeEnabled();
  await page.evaluate(() => {
    const errorEvent = new ErrorEvent("error", { cancelable: true, message: "CPF-SEGREDO-GLOBAL", error: new Error("CPF-SEGREDO-GLOBAL") });
    errorEvent.preventDefault();
    window.dispatchEvent(errorEvent);
    const rejection = new PromiseRejectionEvent("unhandledrejection", { cancelable: true, promise: Promise.resolve(), reason: new Error("TOKEN-SEGREDO-ASYNC") });
    rejection.preventDefault();
    window.dispatchEvent(rejection);
  });
  await page.getByRole("combobox", { name: "Nível", exact: true }).selectOption("error");
  await page.getByRole("combobox", { name: "Módulo", exact: true }).selectOption("runtime");
  await page.getByLabel("De", { exact: true }).fill("2026-10-17");
  await page.getByLabel("Até", { exact: true }).fill("2026-10-17");
  const result = await diagnosticsPackage(page);
  expect(result.events.map((event: { code: string }) => event.code).sort()).toEqual(["RUNTIME_ERROR", "UNHANDLED_REJECTION"]);
  expect(JSON.stringify(result)).not.toMatch(/CPF-SEGREDO|TOKEN-SEGREDO|stack/);
  await page.getByLabel("Código ou ID", { exact: true }).fill(result.events[0].id);
  const filtered = await diagnosticsPackage(page);
  expect(filtered.events).toEqual([result.events[0]]);
  await page.reload();
  const reloaded = await diagnosticsPackage(page);
  expect(reloaded.events).toHaveLength(2);
  expect(reloaded.events.map((event: { id: string }) => event.id).sort()).toEqual(result.events.map((event: { id: string }) => event.id).sort());
});

test("LOG-05: diagnóstico sem permissão usa memória e não bloqueia sucesso nem substitui erro operacional", async ({ page }) => {
  await seedDiagnosticsBrowser(page);
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === "sistem:diagnostics:v1") throw new Error("LOGGER-SEGREDO");
      original.call(this, key, value);
    };
  });
  await rejectedStockCommand(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Informe o motivo da entrada");
  await page.getByLabel("Motivo / referência", { exact: false }).fill("Entrada fictícia válida");
  await page.getByRole("button", { name: "Confirmar entrada", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const saved = JSON.parse((await savedOperational(page))!);
  expect(saved.products.find((item: { id: string }) => item.id === "p3").stock).toBe(16);
  await page.getByRole("link", { name: "Diagnóstico", exact: true }).click();
  await expect(page.getByText(/somente em memória/i)).toBeVisible();
  const result = await diagnosticsPackage(page);
  expect(result.events).toHaveLength(1);
  expect(result.events[0].operation).toBe("receiveStock");
  expect(JSON.stringify(result)).not.toContain("LOGGER-SEGREDO");
});

test("LOG-06: recuperação operacional falha preserva bytes, bloqueia mutação e exporta só catálogo", async ({ page }) => {
  const original = '{ arquivo original CPF-SEGREDO-RECUPERACAO';
  await page.addInitScript((raw) => localStorage.setItem("sistem:prototype:v1", raw), original);
  await page.goto("/demo/diagnostico/");
  await expect(page.getByRole("heading", { name: "Diagnóstico", exact: true })).toBeVisible();
  const exported = await diagnosticsPackage(page);
  expect(exported.events.some((event: { code: string }) => event.code === "STORAGE_READ_FAILED")).toBe(true);
  expect(JSON.stringify(exported)).not.toContain("CPF-SEGREDO");
  expect(await savedOperational(page)).toBe(original);
  await rejectedStockCommand(page);
  await page.getByLabel("Motivo / referência", { exact: false }).fill("Entrada que deve ser bloqueada");
  await page.getByRole("button", { name: "Confirmar entrada", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("originais estão preservados");
  expect(await savedOperational(page)).toBe(original);
});

test("LOG-06: gravação operacional negada registra código controlado sem copiar dados", async ({ page }) => {
  await seedDiagnosticsBrowser(page);
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === "sistem:prototype:v1") throw new Error("CPF-SEGREDO-GRAVACAO");
      original.call(this, key, value);
    };
  });
  await page.goto("/demo/diagnostico/");
  await expect(page.getByRole("heading", { name: "Diagnóstico", exact: true })).toBeVisible();
  const result = await diagnosticsPackage(page);
  expect(result.events.some((event: { code: string }) => event.code === "STORAGE_WRITE_FAILED")).toBe(true);
  expect(JSON.stringify(result)).not.toMatch(/CPF-SEGREDO|customers|example\.com/);
  expect(await page.evaluate((key) => localStorage.getItem(key), diagnosticKey)).not.toBeNull();
  expect(await page.evaluate((key) => localStorage.getItem(key), operationalKey)).not.toBeNull();
});
