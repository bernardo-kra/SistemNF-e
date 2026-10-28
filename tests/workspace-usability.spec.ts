import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

// UXR-QA: critérios definidos antes das correções de texto/layout.
// O operador deve alcançar filtros, campos e confirmação sem rolagem horizontal
// do documento ou formulário. Tabelas podem rolar em seu próprio contêiner.
test.setTimeout(20_000);
const companyId = "10000000-0000-4000-8000-000000000001";
const longName = "Maria Aparecida de Albuquerque Atendimento Especializado da Unidade Central";
const companyName = "Assistência Técnica e Comércio de Acessórios da Unidade Metropolitana Central";
const productName = "Capa acrílica fosca com MagSafe para aparelho edição especial proteção reforçada " + "X".repeat(60);
const id = (suffix: string) => `10000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const rights = ["customers.read", "customers.create", "customers.update", "customers.archive", "products.read", "products.create", "products.update", "products.cost.read", "stock.read", "stock.receive", "sales.read", "sales.create", "sales.deliver", "orders.read", "orders.create", "orders.update", "purchases.read", "finance.read", "finance.agreements.create", "finance.receive", "finance.accounts.manage", "finance.cash.manage", "team.manage", "team.read", "audit.read"];
const stamp = "2026-10-27T12:00:00Z";
const contact = { id: id("15"), name: longName, email: "contact@example.test", phone: "11999990000", type: "Pessoa física", active: true, version: 1, createdAt: stamp, updatedAt: stamp };
const product = { id: id("20"), name: productName, sku: "CAPA-" + "M".repeat(65), gtin: "7891234567895", active: true, version: 1, costCents: 1000, salePriceCents: 2000, serialized: false, unit: "UN", stock: { physical: 5, reserved: 0, available: 5 }, createdAt: stamp, updatedAt: stamp };
const bank = { id: id("30"), name: "Conta de recebimentos da unidade central " + "Z".repeat(65), type: "bank", active: true, balanceCents: 0, version: 1 };

async function controlledApi(page: Page, signed = true) {
  const mutations: string[] = [];
  await page.route("http://127.0.0.1:4000/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const headers = { "access-control-allow-origin": "http://127.0.0.1:3000", "access-control-allow-credentials": "true", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST,PATCH,OPTIONS" };
    if (request.method() === "OPTIONS") { await route.fulfill({ status: 204, headers }); return; }
    const pageData = (items: unknown[]) => ({ tenantId: companyId, items, total: items.length, limit: 25, offset: 0 });
    let body: unknown = pageData([]), status = 200;
    if (request.method() !== "GET") { mutations.push(`${request.method()} ${path}`); status = 503; body = { error: { code: "SERVICE_UNAVAILABLE", message: "Mutação não autorizada neste cenário de apresentação", requestId: "uxr-qa" } }; }
    else if (path.endsWith("/me")) { status = signed ? 200 : 401; body = signed ? { user: { id: "uxr-manager", name: longName, email: "uxr@example.test" }, platformAdmin: false, tenants: [{ id: companyId, name: companyName, role: "owner", permissions: rights }] } : { error: { code: "UNAUTHENTICATED", message: "Sessão ausente", requestId: "uxr-qa" } }; }
    else if (path.endsWith("/customers")) body = pageData([contact]);
    else if (path.endsWith("/products")) body = pageData([product]);
    else if (path.endsWith("/technicians")) body = pageData([{ id: id("25"), name: longName }]);
    else if (path.endsWith("/overview")) body = { ...pageData([{ customerId: contact.id, customerName: longName, outstandingCents: 30000, overdueCents: 1000, paidCents: 5000 }]), accounts: [bank], shifts: [], asOf: new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }) };
    else if (path.endsWith("/installments")) body = pageData([{ id: id("40"), agreementId: id("41"), customerId: contact.id, customerName: longName, sourceType: "sale", sourceId: id("42"), sourceLabel: "Venda com retirada na unidade central", kind: "installment", number: 1, count: 1, amountCents: 30000, paidCents: 0, balanceCents: 30000, due: "2100-01-31" }]);
    else if (path.endsWith("/access-options")) body = { tenantId: companyId, roles: [{ id: "owner", label: "Gestor", permissions: rights }, { id: "operator", label: "Atendimento", permissions: ["customers.read"] }, { id: "viewer", label: "Consulta", permissions: ["customers.read"] }], permissions: [{ id: "customers.read", label: "Consultar clientes" }, { id: "customers.create", label: "Cadastrar clientes" }], operationalPermissions: [{ id: "products.read", label: "Consultar produtos" }, { id: "sales.create", label: "Registrar vendas" }] };
    else if (path.endsWith("/members")) body = pageData([{ id: id("50"), name: longName, email: "employee@example.test", role: "operator", active: true, version: 1, permissions: ["customers.read"], overrides: {}, createdAt: stamp, updatedAt: stamp }]);
    await route.fulfill({ status, headers, json: body });
  });
  return mutations;
}

// Mede os controles renderizados, sem depender de classes CSS ou detalhes do grid.
async function fit(page: Page, scope: Locator, info: TestInfo, checkpoint: string) {
  const findings = await scope.evaluate((root) => {
    const violations: string[] = [], viewport = innerWidth;
    if (document.documentElement.scrollWidth > viewport + 1) violations.push(`documento ${document.documentElement.scrollWidth}px > viewport ${viewport}px`);
    const visible = (node: Element) => node.getClientRects().length > 0 && (node as HTMLElement).checkVisibility();
    for (const element of [root, ...root.querySelectorAll("input,select,textarea,button,summary")]) {
      if (!visible(element) || element.closest("table")) continue;
      const rect = element.getBoundingClientRect();
      const label = element.getAttribute("aria-label") || element.closest("label")?.textContent?.trim() || element.textContent?.trim().slice(0, 80) || element.tagName;
      if (rect.left < -1 || rect.right > viewport + 1) violations.push(`${label}: fora da tela [${Math.round(rect.left)}, ${Math.round(rect.right)}]`);
      const form = element.closest("form");
      if (form && form !== element) { const bounds = form.getBoundingClientRect(); if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1) violations.push(`${label}: fora do formulário`); }
      for (let ancestor = element.parentElement; ancestor && ancestor !== root.parentElement; ancestor = ancestor.parentElement) {
        const css = getComputedStyle(ancestor), bounds = ancestor.getBoundingClientRect();
        if (["hidden", "clip", "auto", "scroll"].includes(css.overflowX) && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)) { violations.push(`${label}: cortado pelo contêiner`); break; }
      }
    }
    return [...new Set(violations)];
  });
  if (findings.length) {
    await info.attach(`${checkpoint}-geometry`, { body: JSON.stringify(findings, null, 2), contentType: "application/json" });
  }
  if (findings.length || ["login", "produtos-filtros", "venda-parcelada", "administracao-cadastro"].includes(checkpoint)) await page.screenshot({ path: info.outputPath(`${checkpoint}.png`), fullPage: true });
  expect.soft(findings, checkpoint).toEqual([]);
}
async function reachable(scope: Locator, name: string) {
  const action = scope.getByRole("button", { name, exact: true });
  await action.scrollIntoViewIfNeeded(); await expect(action).toBeInViewport();
}
async function open(page: Page, route: string, action: string) {
  await page.goto(route); await page.getByRole("button", { name: action, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: action, exact: true }); await expect(dialog).toBeVisible(); return dialog;
}

test("UXR01 entrada explica conta autorizada e orienta obter acesso sem cadastro público", async ({ page }, info) => {
  await controlledApi(page, false); await page.setViewportSize({ width: 320, height: 780 }); await page.goto("/entrar/");
  await expect(page.getByRole("button", { name: "Entrar", exact: true })).toBeVisible();
  const text = await page.getByRole("main").innerText();
  // Correção do teste aceita pela orquestração: a cópula "é" não muda a
  // política exigida. Liberação pela administração e responsável permanecem.
  expect.soft(text).toMatch(/acesso (?:é )?liberado pela administra[çc][ãa]o/i);
  expect.soft(text).toMatch(/(?:fale|procure|contat[eo]|solicit[ea]).{0,100}respons[áa]vel/is);
  await expect(page.getByRole("link", { name: /criar conta|cadastr|registrar/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /criar conta|cadastr|registrar/i })).toHaveCount(0);
  await fit(page, page.getByRole("main"), info, "login"); await reachable(page.getByRole("main"), "Entrar");
});

for (const width of [320, 390, 768, 1024]) {
  test(`UXR Produtos ${width}px: filtros e cadastro cabem com nomes longos`, async ({ page }, info) => {
    const mutations = await controlledApi(page); await page.setViewportSize({ width, height: 850 }); await page.goto("/produtos/");
    await expect(page.getByText(productName, { exact: true }).first()).toBeVisible();
    await page.getByText("Filtrar por período", { exact: true }).click();
    await page.getByLabel("Buscar", { exact: true }).fill("capa acrílica fosca"); await page.getByLabel("De", { exact: true }).fill("2026-01-01");
    await fit(page, page.getByRole("main"), info, "produtos-filtros");
    await page.getByRole("button", { name: "Novo produto", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Novo produto", exact: true });
    await dialog.getByLabel("Nome", { exact: true }).fill(productName); await dialog.getByLabel("Tipo", { exact: true }).fill("Capas para aparelhos e acessórios");
    await dialog.getByLabel("Preço de compra", { exact: true }).fill("10,00"); await dialog.getByLabel("Preço de venda", { exact: true }).fill("20,00");
    await fit(page, dialog, info, "produto-cadastro"); await reachable(dialog, "Salvar produto"); expect(mutations).toEqual([]);
  });

  test(`UXR OS ${width}px: seleção e cadastro contextual preservam campos alcançáveis`, async ({ page }, info) => {
    const mutations = await controlledApi(page); await page.setViewportSize({ width, height: 850 });
    const dialog = await open(page, "/ordens/", "Nova OS");
    await dialog.getByLabel("Cliente", { exact: true }).selectOption(contact.id); await dialog.getByLabel("Técnico responsável", { exact: true }).selectOption(id("25"));
    await dialog.getByLabel("Equipamento", { exact: true }).fill("Aparelho do cliente com descrição detalhada " + "M".repeat(80));
    await dialog.getByLabel("Serviço solicitado", { exact: true }).fill("Troca de tela e conferência dos sensores, mantendo os dados do cliente.");
    await fit(page, dialog, info, "os-cadastro"); await reachable(dialog, "Salvar OS");
    await dialog.getByRole("button", { name: "Cadastrar cliente aqui", exact: true }).click();
    const auxiliary = page.getByRole("dialog", { name: "Cadastrar cliente", exact: true });
    await auxiliary.getByLabel("Nome", { exact: true }).fill(longName); await fit(page, auxiliary, info, "os-cliente"); await reachable(auxiliary, "Salvar cadastro");
    await auxiliary.getByRole("button", { name: "Cancelar", exact: true }).click();
    // Textarea controlada passa a contribuir para label.textContent no React;
    // o papel/nome acessível continua estável. O valor esperado é o mesmo.
    await expect(dialog.getByRole("textbox", { name: "Serviço solicitado", exact: true })).toHaveValue("Troca de tela e conferência dos sensores, mantendo os dados do cliente."); expect(mutations).toEqual([]);
  });

  test(`UXR Venda ${width}px: produto longo, parcelas e recebimento cabem no formulário`, async ({ page }, info) => {
    const mutations = await controlledApi(page); await page.setViewportSize({ width, height: 850 });
    const dialog = await open(page, "/vendas/", "Nova venda");
    await dialog.getByLabel("Cliente", { exact: true }).selectOption(contact.id); await dialog.getByLabel("Produto 1", { exact: true }).selectOption(product.id);
    await dialog.getByLabel("Condição de pagamento", { exact: true }).selectOption("installments");
    await dialog.getByLabel("Entrada", { exact: true }).fill("5,00"); await dialog.getByLabel("Número de parcelas", { exact: true }).fill("2");
    await dialog.getByRole("checkbox", { name: "Receber entrada agora", exact: true }).check();
    await dialog.getByLabel("Meio de pagamento", { exact: true }).selectOption("pix"); await dialog.getByLabel("Conta", { exact: true }).selectOption(bank.id);
    await dialog.getByLabel("Referência", { exact: true }).fill("Conferido no comprovante da cliente"); await dialog.getByRole("checkbox", { name: "Crédito conferido manualmente", exact: true }).check();
    await fit(page, dialog, info, "venda-parcelada"); await reachable(dialog, "Concluir venda"); expect(mutations).toEqual([]);
  });

  test(`UXR Clientes ${width}px: cadastro e filtros cabem sem cortar campos`, async ({ page }, info) => {
    const mutations = await controlledApi(page); await page.setViewportSize({ width, height: 850 }); await page.goto("/clientes/");
    await page.getByLabel("Buscar cliente", { exact: true }).fill("Maria Aparecida"); await fit(page, page.getByRole("main"), info, "clientes-lista");
    await page.getByRole("button", { name: "Novo cliente", exact: true }).click(); const dialog = page.getByRole("dialog", { name: "Novo cliente", exact: true });
    await dialog.getByLabel("Nome", { exact: true }).fill(longName); await dialog.getByLabel("E-mail", { exact: true }).fill("contato.atendimento.unidade.central@example.test");
    await dialog.getByLabel("Telefone", { exact: true }).fill("+55 (11) 99999-0000");
    await fit(page, dialog, info, "cliente-cadastro"); await reachable(dialog, "Salvar cliente"); expect(mutations).toEqual([]);
  });

  test(`UXR Equipe ${width}px: filtros e permissões não cortam campos nem confirmação`, async ({ page }, info) => {
    const mutations = await controlledApi(page); await page.setViewportSize({ width, height: 850 }); await page.goto("/acessos/");
    await page.getByRole("button", { name: "Novo funcionário", exact: true }).waitFor(); await page.getByText("Filtrar por período", { exact: true }).click();
    await fit(page, page.getByRole("main"), info, "equipe-filtros");
    await page.getByRole("button", { name: "Novo funcionário", exact: true }).click(); const dialog = page.getByRole("dialog", { name: "Novo funcionário", exact: true });
    await dialog.getByLabel("Nome", { exact: true }).fill(longName); await dialog.getByLabel("E-mail", { exact: true }).fill("funcionario.unidade.central@example.test");
    await dialog.getByLabel("Senha inicial", { exact: true }).fill("UXR-password-exclusively-mocked"); await dialog.getByLabel("Perfil", { exact: true }).selectOption("operator");
    await dialog.getByText("Personalizar permissões de clientes", { exact: true }).click(); await dialog.getByText("Permissões da operação", { exact: true }).click();
    await fit(page, dialog, info, "funcionario-cadastro"); await reachable(dialog, "Salvar funcionário"); expect(mutations).toEqual([]);
  });

  test(`UXR Financeiro ${width}px: cliente e conta longos mantêm recebimento alcançável`, async ({ page }, info) => {
    const mutations = await controlledApi(page); await page.setViewportSize({ width, height: 850 }); await page.goto("/financeiro/");
    const receive = page.getByRole("button", { name: `Receber de ${longName}`, exact: true }); await receive.waitFor();
    await fit(page, page.getByRole("main"), info, "financeiro-filtros"); await receive.click();
    const dialog = page.getByRole("dialog", { name: `Receber de ${longName}`, exact: true });
    await dialog.getByLabel("Valor recebido", { exact: true }).fill("50,00"); await dialog.getByLabel("Meio de pagamento", { exact: true }).selectOption("pix");
    await dialog.getByLabel("Conta", { exact: true }).selectOption(bank.id); await dialog.getByLabel("Referência", { exact: true }).fill("Conferência no extrato da conta da loja");
    await dialog.getByRole("checkbox", { name: "Crédito conferido manualmente", exact: true }).check();
    await fit(page, dialog, info, "financeiro-recebimento"); await reachable(dialog, "Confirmar recebimento"); expect(mutations).toEqual([]);
  });
}

// ADM: administração central explicitamente concedida, separada dos gestores.
async function administrationApi(page: Page, options: { admin?: boolean; noTenants?: boolean; capacity?: number; failOnce?: boolean; pending?: boolean } = {}) {
  await controlledApi(page);
  const pendingId = "90000000-0000-4000-8000-000000000001";
  const state = { reads: [] as string[], posts: [] as any[], meReads: 0, companies: options.pending ? [{ id: id("60"), name: "Loja pendente QA", status: "pending", owner: { name: longName, email: "gestor@example.test" }, requestId: pendingId, createdAt: stamp }] as any[] : [] as any[] };
  await page.route("http://127.0.0.1:4000/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() === "OPTIONS") { await route.fallback(); return; }
    const headers = { "access-control-allow-origin": "http://127.0.0.1:3000", "access-control-allow-credentials": "true", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST,PATCH,OPTIONS" };
    if (path.endsWith("/me")) {
      state.meReads++;
      await route.fulfill({ headers, json: { user: { id: "uxr-manager", name: longName, email: "uxr@example.test" }, platformAdmin: options.admin ?? true, tenants: options.noTenants ? [] : [{ id: companyId, name: companyName, role: "owner", permissions: rights }] } }); return;
    }
    if (!path.startsWith("/api/v1/administration/")) { if (request.method() === "GET") state.reads.push(path); await route.fallback(); return; }
    state.reads.push(path);
    if (request.method() === "POST") {
      const body = request.postDataJSON(); state.posts.push(body);
      if (options.failOnce && state.posts.length === 1) { await route.fulfill({ headers, status: 503, json: { error: { code: "SERVICE_UNAVAILABLE", message: "Cadastro temporariamente indisponível. Tente novamente.", requestId: "uxr-controlled-failure" } } }); return; }
      const company = { id: id("60"), name: body.name, status: "active", owner: { id: "gestor-qa", name: body.owner.name, email: body.owner.email }, requestId: body.requestId, createdAt: stamp };
      state.companies = [company]; await route.fulfill({ headers, status: 201, json: { company } }); return;
    }
    await route.fulfill({ headers, json: { items: state.companies, total: state.companies.length, limit: 25, offset: 0, capacity: { available: options.capacity ?? 2 } } });
  });
  return state;
}

test("ADM01 gestor comum não vê administração nem consulta empresas ao tentar endereço direto", async ({ page }) => {
  const state = await administrationApi(page, { admin: false }); await page.goto("/");
  await expect(page.getByRole("link", { name: "Administração do Sistem", exact: true })).toHaveCount(0);
  await page.goto("/administracao/"); await expect(page.getByRole("main")).toContainText(/acesso|permiss|autoriz/i);
  expect(state.reads.filter((path) => path.startsWith("/api/v1/administration/"))).toEqual([]);
});

test("ADM02 administrador sem vínculo com loja abre painel sem consultar dados operacionais", async ({ page }, info) => {
  const state = await administrationApi(page, { noTenants: true }); await page.goto("/administracao/");
  await expect(page.getByRole("link", { name: "Administração do Sistem", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Nova empresa", exact: true })).toBeVisible();
  expect(state.reads.filter((path) => path.includes("/tenants/"))).toEqual([]);
  expect(state.reads).toContain("/api/v1/administration/companies");
  await page.setViewportSize({ width: 320, height: 850 }); await fit(page, page.getByRole("main"), info, "administracao-sem-loja");
});

test("ADM03 falha ao cadastrar empresa conserva dados e requestId para nova tentativa", async ({ page }, info) => {
  const state = await administrationApi(page, { failOnce: true }); await page.setViewportSize({ width: 390, height: 850 }); await page.goto("/administracao/");
  await page.getByRole("button", { name: "Nova empresa", exact: true }).click(); const form = page.getByRole("dialog", { name: "Nova empresa", exact: true });
  await form.getByLabel("Nome da empresa", { exact: true }).fill("Loja cadastrada QA"); await form.getByLabel("Nome do gestor", { exact: true }).fill(longName);
  await form.getByLabel("E-mail do gestor", { exact: true }).fill("gestor@example.test"); await form.getByLabel("Senha inicial do gestor", { exact: true }).fill("UXR-gestor-password-mocked");
  await fit(page, form, info, "administracao-cadastro"); await form.getByRole("button", { name: "Cadastrar empresa", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText(/indisponível|possível|novamente/i);
  await expect(form.getByLabel("Nome da empresa", { exact: true })).toHaveValue("Loja cadastrada QA"); await expect(form.getByLabel("Nome do gestor", { exact: true })).toHaveValue(longName);
  await expect(form.getByLabel("E-mail do gestor", { exact: true })).toHaveValue("gestor@example.test"); await expect(form.getByLabel("Senha inicial do gestor", { exact: true })).toHaveValue("UXR-gestor-password-mocked");
  await form.getByRole("button", { name: "Cadastrar empresa", exact: true }).click();
  await expect(page.getByRole("main")).toContainText("Loja cadastrada QA"); await expect(page.getByRole("main")).toContainText(/Equipe e acessos/i);
  expect(state.posts).toHaveLength(2); expect(state.posts[0].requestId).toBeTruthy(); expect(state.posts[1]).toEqual(state.posts[0]); expect(state.meReads).toBe(1);
  expect(state.posts[0]).toMatchObject({ name: "Loja cadastrada QA", owner: { name: longName, email: "gestor@example.test", password: "UXR-gestor-password-mocked" } });
  await expect(page.getByRole("main")).not.toContainText(/postgres(?:ql)?:\/\/|DATABASE_URL|NEON_API_KEY|branch_id/);
});

test("ADM04 capacidade esgotada informa indisponibilidade e bloqueia iniciar nova empresa", async ({ page }) => {
  await administrationApi(page, { capacity: 0 }); await page.goto("/administracao/");
  await expect(page.getByRole("button", { name: "Nova empresa", exact: true })).toBeDisabled();
  await expect(page.getByRole("main")).toContainText(/cadastro.{0,100}indisponível/is);
});

test("ADM05 concluir empresa pendente reutiliza requestId e solicita senha novamente", async ({ page }) => {
  const state = await administrationApi(page, { pending: true }); await page.goto("/administracao/");
  await page.getByRole("button", { name: "Concluir cadastro", exact: true }).click();
  const password = page.getByLabel("Senha inicial do gestor", { exact: true }); await expect(password).toHaveValue(""); await password.fill("UXR-pending-password-mocked");
  await page.getByRole("button", { name: /Cadastrar empresa|Concluir cadastro/, exact: true }).last().click();
  await expect.poll(() => state.posts.length).toBe(1); expect(state.posts[0].requestId).toBe("90000000-0000-4000-8000-000000000001");
  expect(state.meReads).toBe(1);
});
