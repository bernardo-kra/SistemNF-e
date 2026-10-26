import { expect, test } from "@playwright/test";
import { restoreDemoState } from "../src/lib/demo-persistence";
import { contextualFixture, contextualKey, contextualSaved, openAuxiliary, openOrder, startContextual, type ContextualState } from "./contextual-helpers";

test("CAD-07 migra técnicos legados sem reescrever OS, financeiro, fiscal ou versão", () => {
  const original = contextualFixture();
  original.orders[0].technician = "Luís da assistência antiga";
  const before = structuredClone(original);
  const restored = restoreDemoState(original) as ContextualState;
  expect(restored.technicians?.map((t) => t.name)).toContain("Luís da assistência antiga");
  expect(restored.technicians?.some((t) => t.name === "Não atribuído")).toBe(false);
  expect(restored.version).toBe(3);
  expect(restored.orders).toEqual(before.orders);
  expect(restored.finance).toEqual(before.finance);
  expect(original).toEqual(before);
});

test("CAD-07 extensão válida mantém técnicos sem OS e incorpora nomes legados faltantes", () => {
  const original = contextualFixture();
  original.technicians = [{ id: "tech-new", name: "Técnica sem atendimento" }];
  original.orders[0].technician = "Nome histórico único";
  const restored = restoreDemoState(original) as ContextualState;
  expect(restored.technicians).toContainEqual({ id: "tech-new", name: "Técnica sem atendimento" });
  expect(restored.technicians?.map((t) => t.name)).toContain("Nome histórico único");
  expect(restored.orders).toEqual(original.orders);
});

test("CAD-07 nome legado longo permanece recuperável depois da migração e de nova recarga", () => {
  // A versão anterior aceitava qualquer string de técnico nas OS recuperadas.
  // Migrar um dado válido não pode torná-lo inválido no próximo carregamento.
  const original = contextualFixture();
  const legacyName = "Técnico legado " + "L".repeat(140);
  original.orders[0].technician = legacyName;
  const migrated = restoreDemoState(original) as ContextualState;
  expect(migrated.technicians?.map((t) => t.name)).toContain(legacyName);
  const reloaded = restoreDemoState(JSON.parse(JSON.stringify(migrated))) as ContextualState;
  expect(reloaded.technicians).toEqual(migrated.technicians);
  expect(reloaded.orders).toEqual(original.orders);
  expect(reloaded.finance).toEqual(original.finance);
});

test("CAD-07 extensão inválida e duplicada é rejeitada sem corrigir silenciosamente", () => {
  const invalidValues: unknown[] = [null, {}, [{ id: "t1", name: " " }], [{ id: "", name: "Nome" }], [{ id: "t1", name: "Não atribuído" }], [{ id: "t1", name: "João Silva" }, { id: "t2", name: "  JOAO   SILVA  " }], [{ id: "t1", name: "Ana" }, { id: "t1", name: "Beatriz" }]];
  for (const invalid of invalidValues) {
    const input = { ...contextualFixture(), technicians: invalid };
    const bytes = JSON.stringify(input);
    expect(() => restoreDemoState(input)).toThrow();
    expect(JSON.stringify(input)).toBe(bytes);
  }
});

test("CAD-07 técnico legado continua selecionável na nova OS após restauração", async ({ page }) => {
  const original = contextualFixture();
  original.orders[0].technician = "Luís da assistência antiga";
  await startContextual(page, "/ordens/", original);
  const parent = await openOrder(page);
  await expect(parent.getByRole("combobox", { name: /^Técnico responsável/ })).toContainText("Luís da assistência antiga");
  await parent.getByRole("combobox", { name: /^Técnico responsável/ }).selectOption({ label: "Luís da assistência antiga" });
  await parent.getByRole("button", { name: "Cancelar", exact: true }).click();
  expect((await contextualSaved(page)).orders).toEqual(original.orders);
});

test("CAD-07 recuperação inválida preserva bytes e bloqueia cadastro operacional", async ({ page }) => {
  const original = { ...contextualFixture(), technicians: [{ id: "bad-tech", name: 123 }] };
  const raw = await startContextual(page, "/ordens/", original, false);
  await expect(page.getByRole("status")).toContainText("gravação está bloqueada");
  const parent = await openOrder(page);
  const child = await openAuxiliary(page, parent, "Cadastrar técnico", "Novo técnico");
  await child.getByLabel(/^Nome/).fill("Não pode substituir original");
  await child.getByRole("button", { name: "Salvar técnico", exact: true }).click();
  await expect(child.getByRole("alert")).toContainText("preservados");
  expect(await page.evaluate((key) => localStorage.getItem(key), contextualKey)).toBe(raw);
});
