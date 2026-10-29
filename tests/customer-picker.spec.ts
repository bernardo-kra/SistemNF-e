import { selectSaleProduct } from "./helpers/product-choice";
import { expect, test, type Page, type Locator } from "@playwright/test";

// CSEL: cenários do requisito escritos antes do componente; fixtures genéricas e API controlada.
const tenantId = "10000000-0000-4000-8000-000000000001";
const alpha = { id: "10000000-0000-4000-8000-000000000010", name: "Cliente Alfa QA", phone: "11911111111", email: "alpha@example.test", type: "Pessoa física", active: true };
const beta = { ...alpha, id: "10000000-0000-4000-8000-000000000011", name: "Cliente Beta QA", phone: "11922222222", email: "beta@example.test" };
const product = { id: "10000000-0000-4000-8000-000000000020", name: "Produto QA", sku: "QA-1", salePriceCents: 10000, version: 1, active: true, serialized: false, stock: { available: 10, physical: 10, reserved: 0 } };
const rights = ["customers.read", "customers.create", "products.read", "stock.read", "sales.read", "sales.create", "sales.discount", "sales.deliver", "finance.read", "finance.agreements.create"];
type Reply = { items?: any[]; total?: number; status?: number };
async function api(page: Page, options: { financial?: boolean; create?: boolean; search?: (q: string, n: number) => Reply | Promise<Reply> } = {}) {
  const commands: any[] = [], searches: string[] = [];
  await page.route("http://127.0.0.1:4000/**", async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const headers = { "access-control-allow-origin": "http://127.0.0.1:3000", "access-control-allow-credentials": "true", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST,OPTIONS" };
    if (request.method() === "OPTIONS") { await route.fulfill({ status: 204, headers }); return; }
    const pageData = (items: any[]) => ({ tenantId, items, total: items.length, limit: 20, offset: 0 });
    let body: any = pageData([]), status = 200;
    if (path.endsWith("/me")) body = { user: { id: "picker-manager", name: "Gestor QA", email: "picker@example.test" }, tenants: [{ id: tenantId, name: "Empresa QA", role: "owner", permissions: rights.filter((p) => (options.financial !== false || !p.startsWith("finance.")) && (options.create !== false || p !== "customers.create")) }] };
    else if (path.endsWith("/customers") && request.method() === "GET") {
      const q = url.searchParams.get("q") ?? ""; searches.push(q);
      const result = options.search ? await options.search(q, searches.length) : { items: [alpha, beta].filter((c) => `${c.name} ${c.phone} ${c.email}`.toLowerCase().includes(q.toLowerCase())) };
      status = result.status ?? 200; body = status === 200 ? { ...pageData(result.items ?? []), total: result.total ?? result.items?.length ?? 0 } : { error: { code: status === 401 ? "UNAUTHENTICATED" : status === 403 ? "FORBIDDEN" : "SERVICE_UNAVAILABLE" } };
    } else if (path.endsWith("/customers") && request.method() === "POST") body = { tenantId, customer: { ...beta, name: request.postDataJSON().name } };
    else if (path.endsWith("/products")) body = pageData([product]);
    else if (path.endsWith("/overview")) body = { ...pageData([]), accounts: [], shifts: [] };
    else if (path.endsWith("/commands")) { commands.push(request.postDataJSON()); body = { tenantId, entity: { id: "sale-picker-qa", version: 1 } }; }
    await route.fulfill({ status, headers, json: body }).catch(() => {});
  });
  return { commands, searches };
}
async function openSale(page: Page) {
  await page.goto("/vendas/"); await page.getByRole("button", { name: "Nova venda", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Nova venda", exact: true });
  await selectSaleProduct(dialog, product.name, 1);
  return dialog;
}
const field = (dialog: Locator) => dialog.getByRole("combobox", { name: "Cliente", exact: true });
async function selectAlpha(dialog: Locator) { await field(dialog).fill("Alfa"); await dialog.getByRole("option", { name: /Cliente Alfa QA/ }).click(); }

test("CSEL01 um campo pesquisa e escolhe o cliente sem seletor separado ou rede extra", async ({ page }) => {
  const state = await api(page), dialog = await openSale(page), input = field(dialog);
  await expect(input).toHaveAttribute("aria-autocomplete", "list"); await expect(dialog.getByLabel("Buscar cliente", { exact: true })).toHaveCount(0);
  expect(state.searches).toEqual([]);
  await input.fill("Alfa"); const option = dialog.getByRole("option", { name: /Cliente Alfa QA/ }); await expect(option).toContainText(alpha.phone); await option.click();
  await expect(input).toHaveValue(alpha.name); await expect(dialog.getByRole("listbox")).toHaveCount(0); expect(state.searches).toEqual(["Alfa"]);
  await dialog.getByRole("button", { name: "Concluir venda", exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect(state.commands).toHaveLength(1); expect(state.commands[0].data.customerId).toBe(alpha.id);
});
test("CSEL02 texto digitado não é cliente confirmado e editar limpa o ID sem perder desconto", async ({ page }) => {
  const state = await api(page), dialog = await openSale(page);
  await field(dialog).fill(alpha.name); await expect(dialog.getByRole("option", { name: /Cliente Alfa QA/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Concluir venda", exact: true })).toBeDisabled();
  await dialog.getByRole("option", { name: /Cliente Alfa QA/ }).click();
  await dialog.getByRole("button", { name: "Dar desconto ao item 1", exact: true }).click(); await dialog.getByLabel("Desconto total do item 1 (R$)", { exact: true }).fill("10,00");
  await field(dialog).fill("Beta"); await expect(dialog.getByRole("button", { name: "Concluir venda", exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("Desconto total do item 1 (R$)", { exact: true })).toHaveValue("10,00");
  await dialog.getByRole("option", { name: /Cliente Beta QA/ }).click(); await dialog.getByRole("button", { name: "Concluir venda", exact: true }).click();
  await expect(dialog).toHaveCount(0); expect(state.commands[0].data.customerId).toBe(beta.id); expect(state.commands[0].data.items[0].discountCents).toBe(1000);
});
test("CSEL03 homônimos são diferenciados e setas/Enter selecionam sem enviar venda", async ({ page }) => {
  const state = await api(page, { search: () => ({ items: [{ ...alpha, name: "Ana QA" }, { ...beta, name: "Ana QA" }] }) }), dialog = await openSale(page), input = field(dialog);
  await input.fill("Ana"); await expect(dialog.getByRole("listbox", { name: "Resultados de clientes" }).getByRole("option")).toHaveCount(2);
  await input.press("Enter"); expect(state.commands).toHaveLength(0); await expect(dialog.getByRole("button", { name: "Concluir venda", exact: true })).toBeDisabled();
  await input.press("ArrowDown"); await input.press("ArrowDown"); await input.press("Enter");
  await expect(input).toHaveValue("Ana QA"); await expect(dialog.getByRole("listbox")).toHaveCount(0); expect(state.commands).toHaveLength(0);
  await dialog.getByRole("button", { name: "Concluir venda", exact: true }).click(); await expect(dialog).toHaveCount(0); expect(state.commands[0].data.customerId).toBe(beta.id);
});
test("CSEL04 resposta antiga não substitui busca/seleção nova", async ({ page }) => {
  let release!: () => void, mark!: () => void; const wait = new Promise<void>((r) => { release = r; }), requested = new Promise<void>((r) => { mark = r; });
  const state = await api(page, { search: async (q) => { if (q === "Alfa") { mark(); await wait; return { items: [alpha] }; } return { items: [beta] }; } });
  const dialog = await openSale(page);
  try {
    await field(dialog).fill("Alfa"); await requested; await field(dialog).fill("Beta"); await dialog.getByRole("option", { name: /Cliente Beta QA/ }).click(); release();
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    await expect(field(dialog)).toHaveValue(beta.name); await expect(dialog.getByRole("option", { name: /Cliente Alfa QA/ })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Concluir venda", exact: true }).click(); await expect(dialog).toHaveCount(0); expect(state.commands[0].data.customerId).toBe(beta.id);
  } finally { release(); }
});
test("CSEL05 cliente novo/cancelamento preservam carrinho e cadastro salvo fica selecionado", async ({ page }) => {
  const state = await api(page), dialog = await openSale(page); await selectAlpha(dialog);
  await dialog.getByLabel("Quantidade 1", { exact: true }).fill("2");
  await dialog.getByRole("button", { name: "Cadastrar cliente aqui", exact: true }).click();
  let child = page.getByRole("dialog", { name: "Cadastrar cliente", exact: true }); await child.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(field(dialog)).toHaveValue(alpha.name); await expect(dialog.getByLabel("Quantidade 1", { exact: true })).toHaveValue("2");
  await dialog.getByRole("button", { name: "Cadastrar cliente aqui", exact: true }).click(); child = page.getByRole("dialog", { name: "Cadastrar cliente", exact: true });
  await child.getByLabel("Nome", { exact: true }).fill("Cliente recém-criado QA"); await child.getByRole("button", { name: "Salvar cadastro", exact: true }).click();
  await expect(child).toHaveCount(0); await expect(field(dialog)).toHaveValue("Cliente recém-criado QA"); await expect(dialog.getByLabel("Quantidade 1", { exact: true })).toHaveValue("2");
  await dialog.getByRole("button", { name: "Concluir venda", exact: true }).click(); await expect(dialog).toHaveCount(0); expect(state.commands[0].data.customerId).toBe(beta.id);
});
test("CSEL06 falha de pesquisa permite retentar sem cadastro ou venda indevidos", async ({ page }) => {
  const state = await api(page, { create: false, search: (_q, n) => n === 1 ? { status: 503 } : { items: [alpha] } }), dialog = await openSale(page);
  await field(dialog).fill("Alfa"); await expect(dialog.getByText("Não foi possível buscar clientes.", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cadastrar cliente aqui", exact: true })).toHaveCount(0); expect(state.commands).toHaveLength(0);
  await dialog.getByRole("button", { name: "Tentar buscar clientes novamente", exact: true }).click(); await dialog.getByRole("option", { name: /Cliente Alfa QA/ }).click();
  await expect(field(dialog)).toHaveValue(alpha.name); expect(state.searches).toEqual(["Alfa", "Alfa"]);
});
test("CSEL07 sem financeiro usa a mesma busca e só confirma cliente escolhido", async ({ page }) => {
  const state = await api(page, { financial: false }), dialog = await openSale(page); await selectAlpha(dialog);
  await dialog.getByRole("button", { name: "Confirmar venda", exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect(state.commands).toHaveLength(1); expect(state.commands[0].type).toBe("sale.confirm"); expect(state.commands[0].data.customerId).toBe(alpha.id);
});
for (const width of [320, 390]) test(`CSEL08 ${width}px: resultado comprido e Escape mantêm formulário e teclado`, async ({ page }) => {
  await page.setViewportSize({ width, height: 850 }); await api(page, { search: () => ({ items: [{ ...alpha, name: "Cliente com nome extenso " + "A".repeat(80) }] }) });
  const dialog = await openSale(page), input = field(dialog); await input.fill("Cliente"); const option = dialog.getByRole("listbox", { name: "Resultados de clientes" }).getByRole("option"); await expect(option).toBeVisible();
  const bounds = await option.boundingBox(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
  await input.press("Escape"); await expect(dialog).toBeVisible(); await expect(dialog.getByRole("listbox")).toHaveCount(0); await expect(input).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test("CSEL09 nenhum resultado/inativo não vira seleção automática", async ({ page }) => {
  const state = await api(page, { search: () => ({ items: [{ ...alpha, active: false }] }) }), dialog = await openSale(page);
  await field(dialog).fill("Inativo"); await expect(dialog.getByText("Nenhum cliente ativo encontrado.", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("listbox", { name: "Resultados de clientes" }).getByRole("option")).toHaveCount(0); await expect(dialog.getByRole("button", { name: "Concluir venda", exact: true })).toBeDisabled(); expect(state.commands).toHaveLength(0);
});

test("CSEL10 refocar cliente selecionado e pressionar Enter não escolhe outra pessoa", async ({ page }) => {
  const state = await api(page, { search: (_q, n) => ({ items: n === 1 ? [alpha] : [beta] }) }), dialog = await openSale(page);
  await selectAlpha(dialog); await dialog.getByLabel("Quantidade 1", { exact: true }).focus(); await field(dialog).focus();
  await expect(dialog.getByRole("option", { name: /Cliente Beta QA/ })).toBeVisible(); await field(dialog).press("Enter");
  await expect(field(dialog)).toHaveValue(alpha.name); expect(state.searches).toEqual(["Alfa", alpha.name]);
  await dialog.getByRole("button", { name: "Concluir venda", exact: true }).click(); await expect(dialog).toHaveCount(0); expect(state.commands[0].data.customerId).toBe(alpha.id);
});
test("CSEL11 setas mantêm o resultado realçado visível na lista comprida", async ({ page }) => {
  await api(page, { search: () => ({ items: Array.from({ length: 12 }, (_, index) => ({ ...alpha, id: `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`, name: `Cliente opção QA ${index}` })) }) });
  const dialog = await openSale(page), input = field(dialog); await input.fill("Cliente");
  const list = dialog.getByRole("listbox", { name: "Resultados de clientes" }); await expect(list.getByRole("option")).toHaveCount(12);
  for (let index = 0; index < 8; index++) await input.press("ArrowDown");
  await expect.poll(async () => {
    const activeId = await input.getAttribute("aria-activedescendant");
    if (!activeId) return false;
    const bounds = await list.boundingBox(), active = await page.locator(`[id="${activeId}"]`).boundingBox();
    return Boolean(bounds && active && active.y >= bounds.y && active.y + active.height <= bounds.y + bounds.height + 1);
  }).toBe(true);
});

test("CSEL12 toque seleciona o resultado no mesmo campo em contexto móvel", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 850 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage(), state = await api(page), dialog = await openSale(page);
    await field(dialog).fill(alpha.phone); await dialog.getByRole("option", { name: /Cliente Alfa QA/ }).tap();
    await expect(field(dialog)).toHaveValue(alpha.name); await expect(dialog.getByRole("listbox")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Concluir venda", exact: true }).tap(); await expect(dialog).toHaveCount(0);
    expect(state.commands).toHaveLength(1); expect(state.commands[0].data.customerId).toBe(alpha.id); expect(state.searches).toEqual([alpha.phone]);
  } finally { await context.close(); }
});
