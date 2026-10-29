import { expect, test, type Page, type Locator } from "@playwright/test";
import { writeFile } from "node:fs/promises";

// PSEL/OS-CSEL: requisitos e testes anteriores às fontes; nenhuma conta real.
const tenantId = "30000000-0000-4000-8000-000000000001";
const customer = { id: "30000000-0000-4000-8000-000000000010", name: "Pessoa Alfa QA", phone: "11933333333", active: true };
const betaCustomer = { ...customer, id: "30000000-0000-4000-8000-000000000011", name: "Pessoa Beta QA", phone: "11944444444" };
const alpha = { id: "30000000-0000-4000-8000-000000000020", name: "Produto Alfa QA", sku: "ALFA-QA", gtin: "7890000000011", version: 1, active: true, serialized: false, salePriceCents: 10000, stock: { available: 10, physical: 10, reserved: 0 } };
const beta = { ...alpha, id: "30000000-0000-4000-8000-000000000021", name: "Produto Beta QA", sku: "BETA-QA", salePriceCents: 5000 };
const technician = { id: "30000000-0000-4000-8000-000000000030", name: "Técnico QA" };
const rights = ["customers.read", "customers.create", "products.read", "products.create", "stock.read", "sales.read", "sales.create", "sales.discount", "sales.deliver", "finance.read", "finance.agreements.create", "orders.read", "orders.create"];
type Result = { items?: any[]; total?: number; status?: number; tenant?: string };
async function api(page: Page, options: { financial?: boolean; search?: (q: string, n: number) => Result | Promise<Result>; customers?: (q: string) => Result | Promise<Result> } = {}) {
  const commands: any[] = [], queries: URL[] = [];
  await page.route("http://127.0.0.1:4000/**", async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const headers = { "access-control-allow-origin": "http://127.0.0.1:3000", "access-control-allow-credentials": "true", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST,OPTIONS" };
    if (request.method() === "OPTIONS") { await route.fulfill({ status: 204, headers }); return; }
    const pageData = (items: any[]) => ({ tenantId, items, total: items.length, limit: 20, offset: 0 });
    let status = 200, body: any = pageData([]);
    if (path.endsWith("/me")) body = { user: { id: "selection-manager", name: "Gestor QA", email: "selection@example.test" }, tenants: [{ id: tenantId, name: "Empresa QA", role: "owner", permissions: rights.filter((p) => options.financial !== false || !p.startsWith("finance.")) }] };
    else if (path.endsWith("/branding")) body = { tenantId, branding: { version: 0, backgroundOpacity: 10, logo: null, background: null, updatedAt: null, updatedBy: null } };
    else if (path.endsWith("/customers") && request.method() === "POST") body = { tenantId, customer: { ...betaCustomer, name: request.postDataJSON().name } };
    else if (path.endsWith("/customers")) {
      const q = url.searchParams.get("q") ?? "", result = options.customers ? await options.customers(q) : { items: [customer, betaCustomer].filter((row) => `${row.name} ${row.phone}`.toLowerCase().includes(q.toLowerCase())) };
      status = result.status ?? 200; body = status === 200 ? { ...pageData(result.items ?? []), total: result.total ?? result.items?.length ?? 0 } : { error: { code: "SERVICE_UNAVAILABLE" } };
    } else if (path.endsWith("/products")) {
      queries.push(url); const q = url.searchParams.get("q") ?? "";
      const result = url.searchParams.has("code") ? { items: [alpha] } : options.search ? await options.search(q, queries.length) : { items: [alpha, beta].filter((row) => `${row.name} ${row.sku}`.toLowerCase().includes(q.toLowerCase())) };
      status = result.status ?? 200; body = status === 200 ? { ...pageData(result.items ?? []), tenantId: result.tenant ?? tenantId, total: result.total ?? result.items?.length ?? 0 } : { error: { code: "SERVICE_UNAVAILABLE" } };
    } else if (path.endsWith("/technicians")) body = pageData([technician]);
    else if (path.endsWith("/overview")) body = { ...pageData([]), accounts: [], shifts: [] };
    else if (path.endsWith("/commands")) {
      const input = request.postDataJSON(); commands.push(input);
      body = { tenantId, entity: input.type === "product.create" ? { ...beta, name: input.data.name, salePriceCents: null, stock: { available: 0 } } : { id: "selection-saved", version: 1 } };
    }
    await route.fulfill({ status, headers, json: body }).catch(() => {});
  });
  return { commands, queries };
}
const productField = (dialog: Locator, index = 1) => dialog.getByRole("combobox", { name: `Produto ${index}`, exact: true });
async function chooseProduct(dialog: Locator, name = alpha.name, index = 1) {
  await productField(dialog, index).fill(name); await dialog.getByRole("listbox", { name: `Resultados de produtos ${index}`, exact: true }).getByRole("option", { name: new RegExp(name) }).click();
}
async function open(page: Page, kind: "sale" | "order" = "sale") {
  await page.goto(kind === "sale" ? "/vendas/" : "/ordens/");
  await page.getByRole("button", { name: kind === "sale" ? "Nova venda" : "Nova OS", exact: true }).click();
  return page.getByRole("dialog", { name: kind === "sale" ? "Nova venda" : "Nova OS", exact: true });
}
async function chooseCustomer(dialog: Locator) {
  await dialog.getByRole("combobox", { name: "Cliente", exact: true }).fill(customer.name);
  await dialog.getByRole("option", { name: new RegExp(customer.name) }).click();
}

for (const financial of [true, false]) test(`PSEL01 campo único e confirmação preservam SKU, versão e quantidade (${financial ? "checkout" : "sem financeiro"})`, async ({ page }) => {
  const state = await api(page, { financial }), dialog = await open(page);
  expect(state.queries).toHaveLength(0); await expect(dialog.getByLabel("Buscar produto", { exact: true })).toHaveCount(0);
  await chooseProduct(dialog); await chooseCustomer(dialog); await dialog.getByLabel("Quantidade 1", { exact: true }).fill("2");
  const requests = state.queries.length;
  await dialog.getByRole("button", { name: "Dar desconto ao item 1", exact: true }).click(); await dialog.getByLabel("Desconto total do item 1 (R$)", { exact: true }).fill("10,00");
  await expect(dialog.getByTestId("sale-item-total-1")).toContainText("190,00"); expect(state.queries).toHaveLength(requests);
  await dialog.getByRole("button", { name: financial ? "Concluir venda" : "Confirmar venda", exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect(state.commands).toHaveLength(1); expect(state.commands[0].data.items).toEqual([{ productId: alpha.id, version: 1, quantity: 2, discountCents: 1000 }]);
});

test("PSEL02 pesquisa atual não acumula opções e mantém produto da outra linha no carrinho", async ({ page }) => {
  const state = await api(page), dialog = await open(page); await chooseCustomer(dialog); await chooseProduct(dialog);
  await dialog.getByRole("button", { name: "Dar desconto ao item 1", exact: true }).click(); await dialog.getByLabel("Desconto total do item 1 (R$)", { exact: true }).fill("5,00");
  await dialog.getByRole("button", { name: "Adicionar produto", exact: true }).click(); await productField(dialog, 2).fill("Alfa");
  const list = dialog.getByRole("listbox", { name: "Resultados de produtos 2", exact: true }); await expect(list.getByRole("option", { name: /Produto Alfa QA/ })).toBeVisible();
  await productField(dialog, 2).fill("Beta"); await expect(list.getByRole("option", { name: /Produto Beta QA/ })).toBeVisible(); await expect(list.getByRole("option", { name: /Produto Alfa QA/ })).toHaveCount(0);
  await list.getByRole("option", { name: /Produto Beta QA/ }).click(); await expect(productField(dialog)).toHaveValue(alpha.name); await expect(dialog.getByTestId("sale-totals")).toContainText("145,00");
  await dialog.getByRole("button", { name: "Concluir venda", exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect(state.commands[0].data.items.map((row: any) => row.productId)).toEqual([alpha.id, beta.id]);
});

test("PSEL03 editar produto limpa identidade e desconto daquela linha sem alterar quantidade", async ({ page }) => {
  const state = await api(page), dialog = await open(page); await chooseCustomer(dialog); await chooseProduct(dialog);
  await dialog.getByLabel("Quantidade 1", { exact: true }).fill("2"); await dialog.getByRole("button", { name: "Dar desconto ao item 1", exact: true }).click(); await dialog.getByLabel("Desconto total do item 1 (R$)", { exact: true }).fill("10,00");
  await productField(dialog).fill("Beta"); await expect(dialog.getByRole("button", { name: "Concluir venda", exact: true })).toBeDisabled(); await expect(dialog.getByLabel("Quantidade 1", { exact: true })).toHaveValue("2");
  await dialog.getByRole("option", { name: /Produto Beta QA/ }).click(); await expect(dialog.getByLabel("Desconto total do item 1 (R$)", { exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Concluir venda", exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect(state.commands[0].data.items).toEqual([{ productId: beta.id, quantity: 2, version: 1 }]);
});

test("PSEL04 resposta antiga e empresa incompatível não viram seleção", async ({ page }) => {
  let release!: () => void, mark!: () => void; const wait = new Promise<void>((r) => { release = r; }), started = new Promise<void>((r) => { mark = r; });
  await api(page, { search: async (q) => { if (q === "Alfa") { mark(); await wait; return { items: [alpha] }; } return q === "Outra" ? { items: [alpha], tenant: "other-company" } : { items: [beta] }; } });
  const dialog = await open(page);
  try {
    await productField(dialog).fill("Alfa"); await started; await productField(dialog).fill("Beta"); await dialog.getByRole("option", { name: /Produto Beta QA/ }).click(); release();
    await expect(productField(dialog)).toHaveValue(beta.name); await productField(dialog).fill("Outra"); await expect(dialog.getByText("Não foi possível buscar produtos.", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("option", { name: /Produto Alfa QA/ })).toHaveCount(0);
  } finally { release(); }
});

test("PSEL05 nomes iguais exigem escolha por SKU; Enter não envia a venda", async ({ page }) => {
  const state = await api(page, { search: () => ({ items: [{ ...alpha, name: "Capa QA" }, { ...beta, name: "Capa QA" }] }) }), dialog = await open(page), input = productField(dialog);
  await input.fill("Capa"); const list = dialog.getByRole("listbox", { name: "Resultados de produtos 1", exact: true }); await expect(list.getByRole("option")).toHaveCount(2);
  await expect(list).toContainText(alpha.sku); await expect(list).toContainText(beta.sku); await input.press("Enter"); expect(state.commands).toHaveLength(0);
  await input.press("ArrowDown"); await input.press("ArrowDown"); await input.press("Enter"); await expect(input).toHaveValue("Capa QA");
  await chooseCustomer(dialog); await dialog.getByRole("button", { name: "Concluir venda", exact: true }).click(); await expect(dialog).toHaveCount(0); expect(state.commands[0].data.items[0].productId).toBe(beta.id);
});

test("PSEL06 erro permite retentar e quantidade/desconto não disparam pesquisa", async ({ page }) => {
  const state = await api(page, { search: (_q, n) => n === 1 ? { status: 503 } : { items: [alpha] } }), dialog = await open(page);
  await productField(dialog).fill("Alfa"); await expect(dialog.getByText("Não foi possível buscar produtos.", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Tentar buscar produtos novamente", exact: true }).click(); await dialog.getByRole("option", { name: /Produto Alfa QA/ }).click();
  await dialog.getByLabel("Quantidade 1", { exact: true }).fill("3"); await chooseCustomer(dialog); expect(state.queries).toHaveLength(2); expect(state.queries.every((url) => url.searchParams.get("limit") === "20")).toBe(true); expect(state.commands).toHaveLength(0);
});

test("PSEL07 cadastro contextual acrescenta produto sem substituir linha confirmada", async ({ page }) => {
  const state = await api(page, { financial: false }), dialog = await open(page); await chooseProduct(dialog); await dialog.getByLabel("Quantidade 1", { exact: true }).fill("3");
  await dialog.getByRole("button", { name: "Cadastrar produto aqui", exact: true }).click(); let child = page.getByRole("dialog", { name: "Cadastrar produto", exact: true }); await child.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(productField(dialog)).toHaveValue(alpha.name); await dialog.getByRole("button", { name: "Cadastrar produto aqui", exact: true }).click(); child = page.getByRole("dialog", { name: "Cadastrar produto", exact: true });
  await child.getByLabel("Nome", { exact: true }).fill("Novo produto QA"); await child.getByRole("button", { name: "Salvar cadastro", exact: true }).click(); await expect(child).toHaveCount(0);
  await expect(productField(dialog)).toHaveValue(alpha.name); await expect(dialog.getByLabel("Quantidade 1", { exact: true })).toHaveValue("3"); await expect(productField(dialog, 2)).toHaveValue("Novo produto QA"); expect(state.commands).toHaveLength(1); expect(state.commands[0].type).toBe("product.create");
});

test("PSEL08 scanner continua agregando SKU e não precisa pré-carregar opções", async ({ page }) => {
  const state = await api(page), dialog = await open(page), reader = dialog.getByLabel("Ler código ou SKU", { exact: true });
  expect(state.queries).toHaveLength(0); await reader.fill(alpha.sku); await reader.press("Enter"); await expect(productField(dialog)).toHaveValue(alpha.name);
  await reader.fill(alpha.sku); await reader.press("Enter"); await expect(dialog.getByLabel("Quantidade 1", { exact: true })).toHaveValue("2"); expect(state.queries).toHaveLength(2); expect(state.queries.every((url) => url.searchParams.get("code") === alpha.sku)).toBe(true); expect(state.commands).toHaveLength(0);
});

test("PSEL09 inativo não aparece; pendência de preço e falta de saldo continuam explícitas", async ({ page }) => {
  await api(page, { search: () => ({ items: [{ ...alpha, active: false }, { ...beta, salePriceCents: null, stock: { available: 0 } }] }) }); const dialog = await open(page); await chooseCustomer(dialog);
  await productField(dialog).fill("Produto"); const list = dialog.getByRole("listbox", { name: "Resultados de produtos 1", exact: true }); await expect(list.getByRole("option")).toHaveCount(1); await expect(list).toContainText("Preço pendente"); await expect(list).toContainText("0 disponíveis"); await list.getByRole("option").click();
  await expect(dialog.getByRole("button", { name: "Concluir venda", exact: true })).toBeDisabled(); await expect(dialog).toContainText("preço de venda pendente");
});

test("PSEL10 teclado mantém realce visível e Escape fecha somente sugestões", async ({ page }) => {
  await api(page, { search: () => ({ items: Array.from({ length: 20 }, (_, index) => ({ ...alpha, id: `product-${index}`, name: `Produto QA ${index}`, sku: `QA-${index}` })), total: 30 }) }); const dialog = await open(page), input = productField(dialog);
  await input.fill("QA"); const list = dialog.getByRole("listbox", { name: "Resultados de produtos 1", exact: true }); await expect(list.getByRole("option")).toHaveCount(20); await expect(dialog).toContainText("Há mais resultados");
  for (let i = 0; i < 9; i++) await input.press("ArrowDown");
  await expect.poll(async () => { const id = await input.getAttribute("aria-activedescendant"), a = await list.boundingBox(), b = id ? await page.locator(`[id="${id}"]`).boundingBox() : null; return Boolean(a && b && b.y >= a.y && b.y + b.height <= a.y + a.height + 1); }).toBe(true);
  await input.press("Escape"); await expect(list).toHaveCount(0); await expect(dialog).toBeVisible(); await expect(input).toBeFocused();
});

for (const width of [320, 390]) test(`PSEL11 ${width}px: nome extenso não transborda`, async ({ page }) => {
  await page.setViewportSize({ width, height: 850 }); await api(page, { search: () => ({ items: [{ ...alpha, name: "Produto " + "A".repeat(140) }] }) }); const dialog = await open(page); await productField(dialog).fill("Produto"); const option = dialog.getByRole("option", { name: /Produto A/ }); await expect(option).toBeVisible();
  const box = await option.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width); await option.click(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

async function fillOrder(dialog: Locator) {
  await dialog.getByLabel("Equipamento", { exact: true }).fill("Aparelho QA"); await dialog.getByLabel("Serviço solicitado", { exact: true }).fill("Troca de tela QA"); await dialog.getByLabel("Técnico responsável", { exact: true }).selectOption(technician.id); await dialog.getByLabel("Mão de obra", { exact: true }).fill("120,00");
}
test("OS-CSEL01 cliente no mesmo campo e criação correta sem apagar atendimento", async ({ page }) => {
  const state = await api(page), dialog = await open(page, "order"); await fillOrder(dialog); await expect(dialog.getByLabel("Buscar cliente", { exact: true })).toHaveCount(0);
  await chooseCustomer(dialog); await dialog.getByRole("button", { name: "Salvar OS", exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect(state.commands).toHaveLength(1); expect(state.commands[0]).toMatchObject({ type: "order.create", data: { customerId: customer.id, technicianId: technician.id, equipment: "Aparelho QA", issue: "Troca de tela QA", laborCents: 12000 } });
});

test("PSEL12 refocar seleção e Enter preserva o produto, mesmo com resultado diferente", async ({ page }) => {
  const state = await api(page, { search: (_q, n) => ({ items: n === 1 ? [alpha] : [beta] }) }), dialog = await open(page);
  await chooseProduct(dialog); await dialog.getByLabel("Quantidade 1", { exact: true }).focus(); await productField(dialog).focus();
  await expect(dialog.getByRole("option", { name: /Produto Beta QA/ })).toBeVisible(); await page.screenshot({ path: "server/.local/validation/selection-desktop.png", fullPage: true }); await productField(dialog).press("Enter"); await expect(productField(dialog)).toHaveValue(alpha.name);
  await chooseCustomer(dialog); await dialog.getByRole("button", { name: "Concluir venda", exact: true }).click(); await expect(dialog).toHaveCount(0); expect(state.commands[0].data.items[0].productId).toBe(alpha.id);
});

test("PSEL13 toque móvel seleciona e conclui sem navegação ou consulta por quantidade", async ({ browser }, info) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 850 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage(), state = await api(page), dialog = await open(page);
    let navigations = 0; page.on("request", (request) => { if (request.isNavigationRequest() && request.resourceType() === "document") navigations++; });
    const started = performance.now(); await productField(dialog).fill("Alfa"); const option = dialog.getByRole("option", { name: /Produto Alfa QA/ }); await expect(option).toBeVisible(); const searchToResultMs = Math.round(performance.now() - started);
    await page.screenshot({ path: "server/.local/validation/selection-mobile.png", fullPage: true }); await option.tap(); await dialog.getByLabel("Quantidade 1", { exact: true }).fill("2"); await chooseCustomer(dialog);
    await dialog.getByRole("button", { name: "Concluir venda", exact: true }).tap(); await expect(dialog).toHaveCount(0);
    expect(state.queries).toHaveLength(1); expect(navigations).toBe(0); expect(state.commands).toHaveLength(1); expect(state.commands[0].data.items[0]).toMatchObject({ productId: alpha.id, quantity: 2 });
    const effort = { environment: "Chrome headless, 390px/touch, API controlada local, debounce250ms, Next aquecido", searchToResultMs, productSearchRequests: state.queries.length, writes: state.commands.length, documentNavigations: navigations, observation: "Automacao; nao representa produtividade humana, INP ou SLO." };
    await writeFile("server/.local/validation/selection-effort.json", JSON.stringify(effort, null, 2));
    await info.attach("selection-effort", { body: JSON.stringify(effort, null, 2), contentType: "application/json" });
  } finally { await context.close(); }
});
test("OS-CSEL02 texto sem escolha ou editado não confirma pessoa; dados ficam preservados", async ({ page }) => {
  const state = await api(page), dialog = await open(page, "order"); await fillOrder(dialog); await chooseCustomer(dialog);
  const input = dialog.getByRole("combobox", { name: "Cliente", exact: true }); await input.fill("Beta"); await expect(dialog.getByRole("button", { name: "Salvar OS", exact: true })).toBeDisabled(); await expect(dialog.getByLabel("Equipamento", { exact: true })).toHaveValue("Aparelho QA"); await expect(dialog.getByLabel("Mão de obra", { exact: true })).toHaveValue("120,00");
  await dialog.getByRole("option", { name: /Pessoa Beta QA/ }).click(); await dialog.getByRole("button", { name: "Salvar OS", exact: true }).click(); await expect(dialog).toHaveCount(0); expect(state.commands[0].data.customerId).toBe(betaCustomer.id);
});
test("OS-CSEL03 cadastro e cancelamento preservam técnico, equipamento e valor", async ({ page }) => {
  const state = await api(page), dialog = await open(page, "order"); await fillOrder(dialog); await chooseCustomer(dialog);
  await dialog.getByRole("button", { name: "Cadastrar cliente aqui", exact: true }).click(); let child = page.getByRole("dialog", { name: "Cadastrar cliente", exact: true }); await child.getByRole("button", { name: "Cancelar", exact: true }).click(); await expect(dialog.getByRole("combobox", { name: "Cliente", exact: true })).toHaveValue(customer.name);
  await dialog.getByRole("button", { name: "Cadastrar cliente aqui", exact: true }).click(); child = page.getByRole("dialog", { name: "Cadastrar cliente", exact: true }); await child.getByLabel("Nome", { exact: true }).fill("Nova pessoa QA"); await child.getByRole("button", { name: "Salvar cadastro", exact: true }).click(); await expect(child).toHaveCount(0);
  await expect(dialog.getByRole("combobox", { name: "Cliente", exact: true })).toHaveValue("Nova pessoa QA"); await expect(dialog.getByLabel("Técnico responsável", { exact: true })).toHaveValue(technician.id); await expect(dialog.getByLabel("Equipamento", { exact: true })).toHaveValue("Aparelho QA"); await expect(dialog.getByLabel("Mão de obra", { exact: true })).toHaveValue("120,00");
  await dialog.getByRole("button", { name: "Salvar OS", exact: true }).click(); await expect(dialog).toHaveCount(0); expect(state.commands[0].data.customerId).toBe(betaCustomer.id);
});
