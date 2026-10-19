import { expect, type Download, type Page } from "@playwright/test";
import { reportsFixture } from "./reports-fixtures";
import { restoreDemoState } from "../src/lib/demo-persistence";

export const operationalKey = "sistem:prototype:v1";
export const diagnosticKey = "sistem:diagnostics:v1";

export async function seedDiagnosticsBrowser(page: Page, state: unknown = reportsFixture()) {
  // Preparar o estado já restaurado evita medir a migração inicial como comando.
  const normalized = restoreDemoState(state);
  await page.clock.install({ time: new Date("2026-10-17T12:00:00.000Z") });
  await page.addInitScript((initial) => {
    if (!localStorage.getItem("sistem:prototype:v1"))
      localStorage.setItem("sistem:prototype:v1", JSON.stringify(initial));
  }, normalized);
}
export async function downloadedText(download: Download) {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Arquivo exportado indisponível.");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, "");
}
export async function savedOperational(page: Page) {
  return page.evaluate(() => localStorage.getItem("sistem:prototype:v1"));
}
export async function diagnosticsPackage(page: Page) {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar diagnóstico", exact: true }).click();
  return JSON.parse(await downloadedText(await download));
}
export async function rejectedStockCommand(page: Page) {
  await page.goto("/estoque/?token=SEGREDO-URL-123");
  const row = page.getByRole("row").filter({ hasText: "MOU-LOG" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Entrada", exact: true }).click();
  await page.getByLabel("Quantidade recebida", { exact: false }).fill("1");
  await page.getByLabel("Motivo / referência", { exact: false }).fill(" ");
  await page.getByRole("button", { name: "Confirmar entrada", exact: true }).click();
}
