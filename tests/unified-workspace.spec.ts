import { expect, test, type Page } from "@playwright/test";

test.setTimeout(15_000);

// UNI-QA: contratos de login/menu/isolamento definidos antes das fontes UNI.
// Respostas controladas: não substituem a confirmação HTTPS/cookie/PostgreSQL.
const tenantA = "10000000-0000-4000-8000-000000000001";
const tenantB = "20000000-0000-4000-8000-000000000002";
const user = { id: "uni-manager", name: "Pessoa real QA", email: "uni@example.test" };
const allRights = ["customers.read", "customers.create", "customers.update", "customers.archive", "products.read", "products.create", "products.update", "products.cost.read", "stock.read", "stock.receive", "sales.read", "sales.create", "sales.deliver", "orders.read", "orders.create", "orders.update", "purchases.read", "finance.read", "finance.agreements.create", "finance.receive", "team.manage", "team.read", "audit.read"];
const customer = { id: "10000000-0000-4000-8000-000000000015", name: "Contato remoto QA", email: "contact@example.test", phone: "11999990000", type: "Pessoa física", active: true, version: 1, createdAt: "2026-10-27T12:00:00Z", updatedAt: "2026-10-27T12:00:00Z" };
function product(company: string) {
  return { id: company === tenantA ? "10000000-0000-4000-8000-000000000020" : "20000000-0000-4000-8000-000000000020", name: company === tenantA ? "Produto exclusivo A" : "Produto exclusivo B", sku: company === tenantA ? "QA-A" : "QA-B", active: true, version: 1, costCents: 1000, salePriceCents: 2000, serialized: false, unit: "UN", stock: { physical: 3, reserved: 0, available: 3 }, createdAt: "2026-10-27T12:00:00Z", updatedAt: "2026-10-27T12:00:00Z" };
}

async function api(page: Page, options: { signed?: boolean; rights?: string[]; multiple?: boolean; meStatus?: number; productGate?: Promise<void>; failCustomerOnce?: boolean; editConflict?: boolean } = {}) {
  const state = { signed: options.signed ?? true, meStatus: options.meStatus ?? 200, expired: false, logoutFailure: false, identityReads: 0, dataReads: [] as string[], requests: [] as { path: string; method: string }[], mutations: [] as { path: string; method: string; body: any }[], contacts: [customer] as any[] };
  const permissions = options.rights ?? allRights;
  await page.route("http://127.0.0.1:4000/**", async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const headers = { "access-control-allow-origin": "http://127.0.0.1:3000", "access-control-allow-credentials": "true", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST,PATCH,OPTIONS" };
    if (request.method() === "OPTIONS") { await route.fulfill({ status: 204, headers }); return; }
    state.requests.push({ path, method: request.method() });
    let status = 200, body: any;
    const company = path.includes(`/tenants/${tenantB}/`) ? tenantB : tenantA;
    const pageData = (items: any[]) => ({ tenantId: company, items, total: items.length, limit: 25, offset: 0 });
    if (path.endsWith("/me")) {
      state.identityReads++;
      status = !state.signed || state.expired ? 401 : state.meStatus;
      body = { user, tenants: [tenantA, ...(options.multiple ? [tenantB] : [])].map((id) => ({ id, name: id === tenantA ? "Empresa remota A" : "Empresa remota B", role: permissions.includes("team.manage") ? "owner" : "viewer", permissions })) };
    } else if (path.endsWith("/sign-in/email")) {
      state.mutations.push({ path, method: request.method(), body: request.postDataJSON() });
      state.signed = true; state.expired = false; body = { user };
    } else if (path.endsWith("/sign-out")) {
      state.mutations.push({ path, method: request.method(), body: request.postDataJSON() });
      if (state.logoutFailure) status = 503;
      else state.signed = false;
      body = { success: !state.logoutFailure };
    } else {
      if (request.method() === "GET") state.dataReads.push(`${path}${url.search}`);
      if (!state.signed || state.expired) { status = 401; body = {}; }
      else if (path.endsWith("/customers") && request.method() === "POST") {
        const input = request.postDataJSON(); state.mutations.push({ path, method: request.method(), body: input });
        const attempts = state.mutations.filter((item) => item.path.endsWith("/customers") && item.method === "POST").length;
        if (options.failCustomerOnce && attempts === 1) { status = 503; body = {}; }
        else { const saved = { ...customer, ...input }; state.contacts = [saved]; status = 201; body = { tenantId: company, customer: saved }; }
      } else if (path.includes("/customers/") && request.method() === "PATCH") {
        state.mutations.push({ path, method: request.method(), body: request.postDataJSON() });
        status = options.editConflict ? 409 : 200; body = { tenantId: company, customer: { ...customer, ...request.postDataJSON(), version: 2 } };
      } else if (path.endsWith("/customers")) body = pageData(state.contacts);
      else if (path.endsWith("/products")) {
        if (company === tenantA && options.productGate) await options.productGate;
        body = pageData([product(company)]);
      } else if (path.endsWith("/overview")) body = { ...pageData([]), accounts: [], shifts: [], asOf: "2026-10-27" };
      else body = pageData([]);
    }
    if (status >= 400) body = { error: { code: status === 401 ? "UNAUTHENTICATED" : status === 409 ? "CONFLICT" : "SERVICE_UNAVAILABLE", message: "Falha QA controlada", requestId: "uni-qa" } };
    try { await route.fulfill({ status, headers, json: body }); } catch { /* A requisição anterior pode ter sido abortada ao trocar empresa/sessão. */ }
  });
  return state;
}

function nav(page: Page) { return page.getByRole("navigation", { name: "Navegação principal", exact: true }); }
async function signedHome(page: Page) {
  await page.goto("/"); await expect(nav(page)).toBeVisible();
  await expect(page.getByText(user.name, { exact: true }).first()).toBeVisible();
}
async function login(page: Page) {
  await page.getByLabel("E-mail", { exact: true }).fill(user.email);
  await page.getByLabel("Senha", { exact: true }).fill("QA-explicit-password-2026!");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
}

test("UNI01 acesso direto anônimo usa login real e retoma o módulo solicitado", async ({ page }) => {
  const state = await api(page, { signed: false });
  await page.goto("/vendas/"); await expect(page).toHaveURL(/\/entrar\//);
  await expect(page.getByLabel("Senha", { exact: true })).toBeVisible();
  expect(state.dataReads).toEqual([]);
  await page.screenshot({ path: "test-results/unified-login.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/unified-login-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page); await expect(page).toHaveURL(/\/vendas\/$/);
  await expect(page.getByRole("button", { name: "Nova venda", exact: true })).toBeVisible();
  expect(state.mutations.filter((item) => item.path.endsWith("/sign-in/email"))).toHaveLength(1);
  expect(state.identityReads).toBe(2);
});

test("UNI02 menu único compartilha sessão entre módulos sem novos GET me nem documentos", async ({ page }) => {
  const state = await api(page); await signedHome(page); expect(state.identityReads).toBe(1);
  let documents = 0; page.on("request", (request) => { if (request.isNavigationRequest() && request.resourceType() === "document") documents++; });
  for (const [label, path] of [["Produtos", "produtos"], ["Vendas", "vendas"], ["Ordens de serviço", "ordens"], ["Financeiro", "financeiro"], ["Clientes", "clientes"]]) {
    await nav(page).getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${path}/$`)); await expect(nav(page)).toBeVisible();
  }
  expect(state.identityReads).toBe(1); expect(documents).toBe(0);
  await expect(page.getByText("André Martins", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Eletrônica Central", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: "test-results/unified-desktop.png", fullPage: true });
});

test("UNI03 endereço antigo de operação leva ao mesmo menu e módulo de produtos", async ({ page }) => {
  await api(page); await page.goto("/operacao/"); await expect(page).toHaveURL(/\/produtos\/$/);
  await expect(nav(page)).toBeVisible(); await expect(page.getByRole("button", { name: "Novo produto", exact: true })).toBeVisible();
  await expect(page.getByLabel("Senha", { exact: true })).toHaveCount(0);
});

test("UNI04 concessões filtram menu e acesso direto não consulta módulo proibido", async ({ page }) => {
  const state = await api(page, { rights: ["customers.read"] }); await signedHome(page);
  await expect(nav(page).getByRole("link", { name: "Clientes", exact: true })).toBeVisible();
  for (const label of ["Produtos", "Financeiro", "Equipe e acessos"]) await expect(nav(page).getByRole("link", { name: label, exact: true })).toHaveCount(0);
  await page.goto("/financeiro/"); await expect(page.getByRole("main")).toContainText(/permiss|acesso/i);
  expect(state.dataReads.filter((path) => path.includes("/finance/"))).toEqual([]);
});

test("UNI05 troca de empresa descarta resposta antiga e mantém seleção ao navegar", async ({ page }) => {
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  const state = await api(page, { multiple: true, productGate: gate });
  try {
    await page.goto("/produtos/"); await page.getByLabel("Empresa", { exact: true }).selectOption(tenantA);
    await expect.poll(() => state.dataReads.some((path) => path.includes(`/tenants/${tenantA}/operations/products`))).toBeTruthy();
    await page.getByLabel("Empresa", { exact: true }).selectOption(tenantB);
    await expect(page.getByText("Produto exclusivo B", { exact: true })).toBeVisible();
    release(); await expect(page.getByText("Produto exclusivo A", { exact: true })).toHaveCount(0);
    await nav(page).getByRole("link", { name: "Vendas", exact: true }).click();
    await expect(page.getByLabel("Empresa", { exact: true })).toHaveValue(tenantB); expect(state.identityReads).toBe(1);
  } finally { release(); }
});

test("UNI06 sessão expirada limpa o contexto inteiro e exige o mesmo login", async ({ page }) => {
  const state = await api(page); await signedHome(page); state.expired = true;
  await nav(page).getByRole("link", { name: "Produtos", exact: true }).click();
  await expect(page).toHaveURL(/\/entrar\//); await expect(page.getByLabel("Senha", { exact: true })).toBeVisible();
  await expect(nav(page)).toHaveCount(0); await expect(page.getByText("Produto exclusivo A", { exact: true })).toHaveCount(0);
});

test("UNI07 indisponibilidade da API mostra recuperação sem abrir dados fictícios", async ({ page }) => {
  await api(page, { meStatus: 503 }); await page.goto("/");
  await expect(page.getByRole("button", { name: "Tentar novamente", exact: true })).toBeVisible();
  await expect(page.getByText("Eletrônica Central", { exact: true })).toHaveCount(0);
  await expect(page.getByText("André Martins", { exact: true })).toHaveCount(0);
  expect(new URL(page.url()).pathname).not.toContain("/demo");
});

test("UNI08 sair revoga sessão e navegar novamente exige login sem dados anteriores", async ({ page }) => {
  const state = await api(page); await signedHome(page);
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await expect(page).toHaveURL(/\/entrar\//); expect(state.signed).toBe(false);
  expect(state.mutations.filter((item) => item.path.endsWith("/sign-out"))).toHaveLength(1);
  await page.goto("/produtos/"); await expect(page).toHaveURL(/\/entrar\//);
  await expect(page.getByText("Produto exclusivo A", { exact: true })).toHaveCount(0);
});

test("UNI09 falha de logout não anuncia saída nem permite novo login falso", async ({ page }) => {
  const state = await api(page); await signedHome(page); state.logoutFailure = true;
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  // O route announcer do Next também é role=alert; verificar o aviso da aplicação.
  await expect(page.getByRole("main").getByRole("alert")).toContainText(/possível|indisponível|falha/i);
  expect(state.signed).toBe(true); await expect(nav(page)).toBeVisible();
  expect(new URL(page.url()).pathname).not.toBe("/entrar/");
});

test("UNI10 jornada real não lê nem altera armazenamento demonstrativo", async ({ page }) => {
  await page.addInitScript(() => {
    const key = "sistem:prototype:v1", sentinel = JSON.stringify({ qa: "preserve-original-demo" });
    localStorage.setItem(key, sentinel);
    const originalGet = Storage.prototype.getItem, originalSet = Storage.prototype.setItem;
    (window as any).__uniStorageReads = []; (window as any).__uniStorageWrites = [];
    Storage.prototype.getItem = function (name) { if (name.startsWith("sistem:")) (window as any).__uniStorageReads.push(name); return originalGet.call(this, name); };
    Storage.prototype.setItem = function (name, value) { if (name.startsWith("sistem:")) (window as any).__uniStorageWrites.push(name); return originalSet.call(this, name, value); };
    (window as any).__uniOriginalRead = () => originalGet.call(localStorage, key);
  });
  await api(page); await signedHome(page); await nav(page).getByRole("link", { name: "Produtos", exact: true }).click();
  await expect(page.getByText("Produto exclusivo A", { exact: true })).toBeVisible();
  const storage = await page.evaluate(() => ({ reads: (window as any).__uniStorageReads, writes: (window as any).__uniStorageWrites, original: (window as any).__uniOriginalRead() }));
  expect(storage.reads).toEqual([]); expect(storage.writes).toEqual([]);
  expect(storage.original).toBe(JSON.stringify({ qa: "preserve-original-demo" }));
});

test("UNI11 recursos pendentes usam o mesmo contexto e indicam preparação sem indicadores fictícios", async ({ page }) => {
  const state = await api(page); await page.goto("/fiscal/");
  await expect(nav(page)).toBeVisible(); await expect(page.getByRole("main")).toContainText(/em preparação/i);
  await nav(page).getByRole("link", { name: "Relatórios", exact: true }).click();
  await expect(page.getByRole("main")).toContainText(/em preparação/i);
  expect(state.identityReads).toBe(1); expect(state.dataReads).toEqual([]);
});

test("UNI12 demonstração é explícita, mantém links sob demo e não pede segundo login", async ({ page }) => {
  const state = await api(page); await page.goto("/demo/");
  await expect(page.getByText("Demonstração", { exact: true }).first()).toBeVisible();
  await nav(page).getByRole("link", { name: "Produtos", exact: true }).click();
  await expect(page).toHaveURL(/\/demo\/produtos\/$/);
  expect(state.identityReads).toBe(0); expect(state.dataReads).toEqual([]);
  await expect(page.getByLabel("Senha", { exact: true })).toHaveCount(0);
});

test("UNI13 em celular o menu abre, navega e fecha sem overflow horizontal", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await api(page); await page.goto("/");
  await page.getByRole("button", { name: "Abrir navegação", exact: true }).click();
  await nav(page).getByRole("link", { name: "Produtos", exact: true }).click();
  await expect(page).toHaveURL(/\/produtos\/$/); await expect(page.getByText("Produto exclusivo A", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Abrir navegação", exact: true })).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => page.locator("aside.sidebar").evaluate((element) => element.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/unified-mobile.png", fullPage: true });
});

test("UNI16 largura intermediária mantém o acesso ao menu quando a barra lateral é recolhida", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 }); await api(page); await page.goto("/");
  const opener = page.getByRole("button", { name: "Abrir navegação", exact: true });
  await expect(opener).toBeVisible(); await opener.click();
  await nav(page).getByRole("link", { name: "Produtos", exact: true }).click();
  await expect(page).toHaveURL(/\/produtos\/$/); await expect(page.getByText("Produto exclusivo A", { exact: true })).toBeVisible();
  await expect(opener).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => page.locator("aside.sidebar").evaluate((element) => element.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/unified-tablet.png", fullPage: true });
});

test("UNI14 parâmetro externo de retorno não tira a autenticação do domínio do Sistem", async ({ page }) => {
  await api(page, { signed: false }); await page.goto("/entrar/?next=https%3A%2F%2Fexternal.example.test%2F");
  await expect(page.getByLabel("Senha", { exact: true })).toBeVisible(); await login(page);
  await expect(nav(page)).toBeVisible(); expect(new URL(page.url()).origin).toBe("http://127.0.0.1:3000");
  expect(new URL(page.url()).pathname).toBe("/");
});

test("UNI15 cadastro real de cliente preserva tentativa após 503 e edição após conflito", async ({ page }) => {
  const state = await api(page, { failCustomerOnce: true, editConflict: true });
  await page.goto("/clientes/"); await page.getByRole("button", { name: "Novo cliente", exact: true }).click();
  let dialog = page.getByRole("dialog"); await dialog.getByLabel("Nome", { exact: true }).fill("Novo contato remoto");
  await dialog.getByLabel("E-mail", { exact: true }).fill("new-qa@example.test");
  await dialog.getByRole("button", { name: "Salvar cliente", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible(); await expect(dialog.getByLabel("Nome", { exact: true })).toHaveValue("Novo contato remoto");
  await dialog.getByRole("button", { name: "Salvar cliente", exact: true }).click(); await expect(dialog).toHaveCount(0);
  const posts = state.mutations.filter((item) => item.path.endsWith("/customers") && item.method === "POST");
  expect(posts).toHaveLength(2); expect(posts[0].body.requestId).toMatch(/^[0-9a-f-]{36}$/i); expect(posts[1].body).toEqual(posts[0].body);
  await page.getByRole("button", { name: /^Editar cliente/ }).first().click(); dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome", { exact: true }).fill("Alteração preservada"); await dialog.getByRole("button", { name: "Salvar cliente", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible(); await expect(dialog.getByLabel("Nome", { exact: true })).toHaveValue("Alteração preservada");
  const patch = state.mutations.find((item) => item.method === "PATCH"); expect(patch?.body.version).toBe(1);
});

test("UNI17 expiração no cadastro contextual encerra sessão global sem salvar a OS", async ({ page }) => {
  const state = await api(page); await page.goto("/ordens/");
  await page.getByRole("button", { name: "Nova OS", exact: true }).click();
  const order = page.getByRole("dialog", { name: "Nova OS", exact: true });
  await order.getByRole("button", { name: "Cadastrar cliente aqui", exact: true }).click();
  const child = page.getByRole("dialog", { name: "Cadastrar cliente", exact: true });
  await child.getByLabel("Nome", { exact: true }).fill("Cadastro ainda não confirmado");
  state.expired = true;
  await child.getByRole("button", { name: "Salvar cadastro", exact: true }).click();
  await expect(page).toHaveURL(/\/entrar\//); await expect(page.getByLabel("Senha", { exact: true })).toBeVisible();
  await expect(nav(page)).toHaveCount(0); await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(state.requests.filter((item) => item.method === "POST" && item.path.endsWith("/customers"))).toHaveLength(1);
  expect(state.requests.filter((item) => item.method === "POST" && item.path.endsWith("/commands"))).toHaveLength(0);
});
