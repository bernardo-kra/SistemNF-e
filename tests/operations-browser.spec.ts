import { test, expect } from "@playwright/test";
const tenantId = "10000000-0000-4000-8000-000000000001";
const rights = ["products.read", "products.create", "products.update", "products.archive", "products.cost.read", "stock.read", "stock.receive", "sales.read", "sales.create", "sales.deliver", "orders.read", "orders.create", "orders.update", "orders.advance", "orders.deliver", "purchases.read", "purchases.import", "purchases.receive", "audit.read", "customers.read", "customers.create"];
const product = { id: "10000000-0000-4000-8000-000000000003", sku: "CAPA-16", name: "Capa MagSafe iPhone 16", category: "Capas", unit: "UN", costCents: 1000, salePriceCents: 2500, active: true, version: 1, createdAt: "2026-10-25T12:00:00Z", updatedAt: "2026-10-25T12:00:00Z", stock: { physical: 2, reserved: 0, available: 2, version: 1 } };

test("OP-UI01 cadastro e histórico de produto na mesma página; falha preserva o formulário", async ({ page }) => {
  let fail = true; const saved: any[] = []; let rows: any[] = [];
  await page.route("http://127.0.0.1:4000/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: any, status = 200;
    if (path.endsWith("/me")) body = { user: { id: "manager", name: "Gestora real", email: "manager@example.test" }, tenants: [{ id: tenantId, name: "Loja conectada", role: "owner", permissions: rights }] };
    else if (path.endsWith("commands")) { saved.push(route.request().postDataJSON()); if (fail) { status = 503; body = { error: { code: "SERVICE_UNAVAILABLE" } }; } else { rows = [product]; body = { tenantId, entityType: "product", entity: product }; } }
    else if (path.endsWith("history")) body = { tenantId, items: [{ id: "event", entityType: "product", entityId: product.id, action: "product.create", actorId: "manager", actorName: "Gestora real", at: product.createdAt, version: 1, fields: ["name"], before: {}, after: { name: product.name } }], total: 1, limit: 25, offset: 0 };
    else body = { tenantId, items: rows, total: rows.length, limit: 25, offset: 0 };
    await route.fulfill({ status, json: body });
  });
  await page.goto("/produtos/");
  await page.getByRole("button", { name: "Novo produto", exact: true }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("SKU", { exact: true }).fill(product.sku);
  await modal.getByLabel("Nome", { exact: true }).fill(product.name);
  await modal.getByLabel("Preço de compra", { exact: true }).fill("10,00");
  await modal.getByLabel("Preço de venda", { exact: true }).fill("25,00");
  await modal.getByRole("button", { name: "Salvar produto", exact: true }).click();
  await expect(modal.getByRole("alert")).toBeVisible(); await expect(modal.getByLabel("Nome", { exact: true })).toHaveValue(product.name);
  fail = false; await modal.getByRole("button", { name: "Salvar produto", exact: true }).click();
  await expect(modal).toHaveCount(0); await expect(page.getByText(product.name, { exact: true })).toBeVisible();
  expect(saved[0].requestId).toBe(saved[1].requestId);
  await page.getByRole("button", { name: `Histórico de ${product.name}`, exact: true }).click();
  await expect(page.getByRole("dialog").getByText("Gestora real", { exact: true })).toBeVisible();
  expect(page.url()).toContain("/produtos/");
});

test("OP-UI02 perfil sem direito não consulta módulos e custo não é apresentado", async ({ page }) => {
  const queries: string[] = [];
  await page.route("http://127.0.0.1:4000/**", async (route) => {
    const path = new URL(route.request().url()).pathname; queries.push(path);
    const { costCents: _cost, ...safe } = product;
    await route.fulfill({ json: path.endsWith("/me") ? { user: { id: "viewer", name: "Consulta", email: "viewer@example.test" }, tenants: [{ id: tenantId, name: "Loja", role: "viewer", permissions: ["products.read"] }] } : { tenantId, items: [safe], total: 1, limit: 25, offset: 0 } });
  });
  await page.goto("/produtos/");
  await expect(page.getByText(product.name, { exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Compra", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Compras", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Novo produto", exact: true })).toHaveCount(0);
  expect(queries.some((path) => /purchases|orders|sales|stock/.test(path))).toBe(false);
});

test("OP-UI03 XML500 conhecidos: um plano e uma confirmação sem controles por linha", async ({ page }) => {
  let plans = 0, commands = 0;
  await page.route("http://127.0.0.1:4000/**", async (route) => {
    const path = new URL(route.request().url()).pathname; let body: any;
    if (path.endsWith("/me")) body = { user: { id: "manager", name: "Gestora", email: "owner@example.test" }, tenants: [{ id: tenantId, name: "Loja", role: "owner", permissions: rights }] };
    else if (path.endsWith("purchase-plan")) { plans++; const doc = route.request().postDataJSON().document; body = { tenantId, plan: { lines: doc.items.map((source: any) => ({ source, name: product.name, category: "Capas", attributes: {}, resolution: "known", productId: product.id, conversion: 1, candidates: [], reason: "Vínculo existente" })) } }; }
    else if (path.endsWith("commands")) { commands++; const input = route.request().postDataJSON(); expect(input.data.document.items).toHaveLength(500); expect(input.data.receive).toBe(true); expect(Object.keys(input.data.decisions)).toHaveLength(0); body = { tenantId, entityType: "purchase", entity: { id: "purchase", status: "received", lines: [] } }; }
    else body = { tenantId, items: path.endsWith("products") ? [product] : [], total: 0, limit: 25, offset: 0 };
    await route.fulfill({ json: body });
  });
  await page.goto("/produtos/"); await page.getByRole("link", { name: "Compras", exact: true }).click();
  const xml = `<nfeProc><NFe><infNFe Id="QA-500"><ide><nNF>500</nNF></ide><emit><CNPJ>11111111000111</CNPJ><xNome>Fornecedor QA</xNome></emit>${Array.from({ length: 500 }, (_, index) => `<det nItem="${index + 1}"><prod><cProd>${index}</cProd><xProd>CAPA MAGSAFE IPHONE 16</xProd><NCM>39269090</NCM><uCom>UN</uCom><qCom>1</qCom><vUnCom>10.00</vUnCom><vProd>10.00</vProd></prod></det>`).join("")}<total><ICMSTot><vNF>5000.00</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`;
  await page.getByLabel("Arquivo XML", { exact: true }).setInputFiles({ name: "compra-500.xml", mimeType: "application/xml", buffer: Buffer.from(xml) });
  await expect(page.getByText("500 itens reconhecidos", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: /Ação para/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Confirmar recebimento", exact: true }).click();
  await expect(page.getByText("Compra confirmada.", { exact: true })).toBeVisible();
  expect(plans).toBe(1); expect(commands).toBe(1); expect(page.url()).toContain("/compras/");
});

test("OP-UI04 indisponibilidade não mostra exemplos locais", async ({ page }) => {
  await page.route("http://127.0.0.1:4000/**", (route) => route.fulfill({ status: 503, json: { error: { code: "SERVICE_UNAVAILABLE" } } }));
  await page.goto("/produtos/"); await expect(page.getByRole("main").getByRole("alert")).toContainText("Não foi possível");
  await expect(page.getByText("André Martins", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Novo produto", exact: true })).toHaveCount(0);
});

test("OP-UI05 preços pendentes recebem um percentual e uma confirmação do conjunto", async ({ page }) => {
  const rows = [1, 2, 3].map((index) => ({ ...product, id: `${product.id.slice(0, -1)}${index}`, sku: `P${index}`, name: `Pendente ${index}`, salePriceCents: null }));
  let posted: any;
  await page.route("http://127.0.0.1:4000/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("commands")) { posted = route.request().postDataJSON(); await route.fulfill({ json: { tenantId, entityType: "product", entity: rows[0] } }); }
    else await route.fulfill({ json: path.endsWith("/me") ? { user: { id: "manager", name: "Gestora", email: "owner@example.test" }, tenants: [{ id: tenantId, name: "Loja", role: "owner", permissions: rights }] } : { tenantId, items: rows, total: 3, limit: 100, offset: 0 } });
  });
  await page.goto("/produtos/"); await page.getByRole("button", { name: "Precificar pendentes", exact: true }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Acréscimo sobre a compra (%)", { exact: true }).fill("50");
  await modal.getByRole("button", { name: "Salvar preços do lote", exact: true }).click();
  await expect(modal).toHaveCount(0); expect(posted.type).toBe("product.prices");
  expect(posted.data.items).toHaveLength(3); expect(posted.data.items.every((item: any) => item.salePriceCents === 1500 && item.version === 1)).toBe(true);
});

test("OP-UI06 cadastrar cliente no contexto da OS preserva equipamento e seleciona o cadastro real", async ({ page }) => {
  const customer = { id: "10000000-0000-4000-8000-000000000050", name: "Cliente novo", type: "Pessoa física" };
  await page.route("http://127.0.0.1:4000/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({ json: path.endsWith("/me") ? { user: { id: "manager", name: "Gestora", email: "owner@example.test" }, tenants: [{ id: tenantId, name: "Loja", role: "owner", permissions: rights }] } : path.endsWith("customers") && route.request().method() === "POST" ? { tenantId, customer } : { tenantId, items: [], total: 0, limit: 100, offset: 0 } });
  });
  await page.goto("/produtos/"); await page.getByRole("link", { name: "Ordens de serviço", exact: true }).click();
  await page.getByRole("button", { name: "Nova OS", exact: true }).click();
  const main = page.getByRole("dialog", { name: "Nova OS", exact: true });
  await main.getByLabel("Equipamento", { exact: true }).fill("iPhone preenchido");
  await main.getByRole("button", { name: "Cadastrar cliente aqui", exact: true }).click();
  const child = page.getByRole("dialog", { name: "Cadastrar cliente", exact: true });
  await child.getByLabel("Nome", { exact: true }).fill(customer.name);
  await child.getByRole("button", { name: "Salvar cadastro", exact: true }).click();
  await expect(child).toHaveCount(0);
  await expect(main.getByLabel("Cliente", { exact: true })).toHaveValue(customer.id);
  await expect(main.getByLabel("Equipamento", { exact: true })).toHaveValue("iPhone preenchido");
});

test("OP-UI07 gestor aplica configuração de balcão em uma ação e mantém custos restritos", async ({ page }) => {
  let posted: any;
  const employee = { id: "staff", name: "Atendente", email: "staff@example.test", role: "operator", active: true, version: 1, permissions: ["customers.read"], overrides: {}, createdAt: null, updatedAt: null };
  await page.route("http://127.0.0.1:4000/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: any;
    if (path.endsWith("/me")) body = { user: { id: "manager", name: "Gestora", email: "owner@example.test" }, tenants: [{ id: tenantId, name: "Loja", role: "owner", permissions: [...rights, "team.manage"] }] };
    else if (path.endsWith("access-options")) body = { tenantId, roles: [{ id: "owner", label: "Gestor", permissions: rights }, { id: "operator", label: "Atendimento", permissions: ["customers.read"] }], permissions: [{ id: "customers.read", label: "Consultar clientes" }], operationalPermissions: rights.filter((id) => !id.startsWith("customers.")).map((id) => ({ id, label: id })) };
    else if (route.request().method() === "PATCH") { posted = route.request().postDataJSON(); body = { tenantId, member: employee }; }
    else body = { tenantId, items: path.endsWith("members") ? [employee] : [], total: 1, limit: 25, offset: 0 };
    await route.fulfill({ json: body });
  });
  await page.goto("/acessos/"); await page.getByRole("button", { name: "Editar acessos de Atendente", exact: true }).click();
  const modal = page.getByRole("dialog");
  await modal.getByRole("button", { name: "Aplicar rotina de balcão", exact: true }).click();
  await modal.getByRole("button", { name: "Salvar acessos", exact: true }).click();
  await expect(modal).toHaveCount(0);
  expect(posted.overrides["sales.create"]).toBe(true); expect(posted.overrides["orders.create"]).toBe(true); expect(posted.overrides["stock.read"]).toBe(true);
  expect(posted.overrides["products.cost.read"]).not.toBe(true); expect(posted.overrides["purchases.read"]).not.toBe(true);
});

test("OP-UI08 área conectada não lê nem regrava o armazenamento da demonstração", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("sistem:prototype:v1", "legado-corrompido-preservado");
    const original = Storage.prototype.getItem;
    (window as any).__demoReads = 0;
    Storage.prototype.getItem = function(key: string) { if (key === "sistem:prototype:v1") (window as any).__demoReads++; return original.call(this, key); };
  });
  await page.route("http://127.0.0.1:4000/**", (route) => route.fulfill({ json: { user: { id: "viewer", name: "Consulta", email: "viewer@example.test" }, tenants: [{ id: tenantId, name: "Loja", role: "viewer", permissions: [] }] } }));
  await page.goto("/produtos/"); await expect(page.getByText("Seu perfil não tem permissão para acessar este módulo.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__demoReads)).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem("sistem:prototype:v1"))).toBe("legado-corrompido-preservado");
});

test("OP-UI09 dúvida do XML mostra nome e SKU do candidato sem exigir reconhecimento de UUID", async ({ page }) => {
  await page.route("http://127.0.0.1:4000/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: any = { tenantId, items: [], total: 0, limit: 25, offset: 0 };
    if (path.endsWith("/me")) body = { user: { id: "manager", name: "Gestora", email: "owner@example.test" }, tenants: [{ id: tenantId, name: "Loja", role: "owner", permissions: rights }] };
    if (path.endsWith("purchase-plan")) { const doc = route.request().postDataJSON().document; body = { tenantId, candidates: [{ id: product.id, name: product.name, sku: product.sku }], plan: { lines: doc.items.map((source: any) => ({ source, name: "Capa", category: "Capas", attributes: {}, resolution: "review", candidates: [product.id], conversion: 1, reason: "Confira a variacao" })) } }; }
    await route.fulfill({ json: body });
  });
  await page.goto("/produtos/"); await page.getByRole("link", { name: "Compras", exact: true }).click();
  const xml = '<NFe><infNFe Id="QA-review"><ide><nNF>1</nNF></ide><emit><xNome>Fornecedor</xNome></emit><det nItem="1"><prod><cProd>A</cProd><xProd>CAPA</xProd><NCM>39269090</NCM><uCom>UN</uCom><qCom>1</qCom><vUnCom>10.00</vUnCom><vProd>10.00</vProd></prod></det></infNFe></NFe>';
  await page.getByLabel("Arquivo XML", { exact: true }).setInputFiles({ name: "duvida.xml", mimeType: "text/xml", buffer: Buffer.from(xml) });
  const choices = page.getByRole("combobox", { name: "Ação para CAPA", exact: true });
  await expect(choices.locator(`option[value="link:${product.id}"]`)).toHaveText(`${product.name} · ${product.sku}`);
});
