import { expect, test } from "@playwright/test";
import {
  contextualFixture, contextualSaved, expectNoOperationalEffects, expectOrderDraft,
  fillCustomer, fillOrderDraft, fillProduct, openAuxiliary, openOrder, openSale, startContextual,
} from "./contextual-helpers";

// CAD-01..09: resultados definidos pelos requisitos antes do código do produto.
test("CAD-01 OS mantém todos os campos ao criar cliente e técnico, sem salvar a OS", async ({ page }) => {
  await startContextual(page);
  const parent = await openOrder(page);
  await fillOrderDraft(parent);
  const before = await contextualSaved(page);
  const route = page.url();
  const customer = await openAuxiliary(page, parent, "Cadastrar cliente", "Novo cliente");
  await fillCustomer(customer);
  await customer.getByRole("button", { name: "Salvar cliente", exact: true }).click();
  await expect(customer).toHaveCount(0);
  const afterCustomer = await contextualSaved(page);
  const savedCustomer = afterCustomer.customers.find((c) => c.name === "Cliente contextual de teste")!;
  expect(savedCustomer).toBeTruthy();
  await expectOrderDraft(parent, savedCustomer.id);
  const technician = await openAuxiliary(page, parent, "Cadastrar técnico", "Novo técnico");
  await expect(technician).toContainText(/operacional/i);
  await expect(technician.locator('input[type="password"]')).toHaveCount(0);
  await technician.getByLabel(/^Nome/).fill("Cláudia Nunes");
  await page.screenshot({ path: "docs/evidencias/cadastros-os-tecnico.png" });
  await technician.getByRole("button", { name: "Salvar técnico", exact: true }).click();
  await expect(technician).toHaveCount(0);
  await expectOrderDraft(parent, savedCustomer.id, "Cláudia Nunes");
  expect(page.url()).toBe(route);
  const after = await contextualSaved(page);
  expectNoOperationalEffects(after, before);
  expect(after.products).toEqual(before.products);
  expect(after.technicians?.filter((t) => t.name === "Cláudia Nunes")).toHaveLength(1);
  await parent.getByRole("button", { name: "Abrir ordem de serviço", exact: true }).click();
  await expect(parent).toHaveCount(0);
  const confirmed = await contextualSaved(page);
  expect(confirmed.orders).toHaveLength(before.orders.length + 1);
  expect(confirmed.orders[0]).toMatchObject({ customerId: savedCustomer.id, technician: "Cláudia Nunes", equipment: "Notebook do atendimento contextual", parts: 12045, labor: 8010 });
  expect(confirmed.finance).toEqual(before.finance);
});

for (const close of ["Cancelar", "Fechar janela", "Escape"]) {
  test(`CAD-02 ${close} no cadastro auxiliar mantém seleção e rascunho da OS`, async ({ page }) => {
    await startContextual(page);
    const parent = await openOrder(page);
    await fillOrderDraft(parent);
    const before = await contextualSaved(page);
    const child = await openAuxiliary(page, parent, "Cadastrar cliente", "Novo cliente");
    await fillCustomer(child, "Cliente que não será salvo");
    if (close === "Escape") await page.keyboard.press("Escape");
    else await child.getByRole("button", { name: close, exact: true }).click();
    await expect(child).toHaveCount(0);
    await expectOrderDraft(parent);
    expect(await contextualSaved(page)).toEqual(before);
    const focused = await parent.evaluate((element) => element.contains(document.activeElement));
    expect(focused).toBe(true);
  });
}

test("CAD-02 erro recuperável de CPF e Enter ficam no filho sem enviar OS", async ({ page }) => {
  await startContextual(page);
  const parent = await openOrder(page);
  await fillOrderDraft(parent);
  const before = await contextualSaved(page);
  const child = await openAuxiliary(page, parent, "Cadastrar cliente", "Novo cliente");
  await fillCustomer(child);
  await child.getByText("Dados fiscais e endereço", { exact: false }).click();
  await child.getByLabel("CPF / CNPJ", { exact: true }).fill("11111111111");
  await child.getByLabel(/^Nome \/ razão social/).press("Enter");
  await expect(child.getByRole("alert")).toContainText("CPF/CNPJ");
  await expect(child.getByLabel(/^Nome \/ razão social/)).toHaveValue("Cliente contextual de teste");
  expect(await contextualSaved(page)).toEqual(before);
  await child.getByLabel("CPF / CNPJ", { exact: true }).fill("");
  await child.getByLabel(/^Nome \/ razão social/).press("Enter");
  await expect(child).toHaveCount(0);
  const saved = await contextualSaved(page);
  expectNoOperationalEffects(saved, before);
  await expectOrderDraft(parent, saved.customers.find((c) => c.name === "Cliente contextual de teste")!.id);
});

test("CAD-08 Tab e Shift+Tab ficam na etapa ativa e o foco retorna à OS", async ({ page }) => {
  await startContextual(page);
  const parent = await openOrder(page);
  await fillOrderDraft(parent);
  const child = await openAuxiliary(page, parent, "Cadastrar técnico", "Novo técnico");
  for (const key of ["Tab", "Shift+Tab"]) {
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press(key);
      expect(await child.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    }
  }
  // Diálogos devem ter títulos independentes, sem ID acessível compartilhado.
  const labels = await page.locator("dialog[open]").evaluateAll((dialogs) => dialogs.map((d) => d.getAttribute("aria-labelledby")));
  expect(labels.every(Boolean)).toBe(true);
  expect(new Set(labels).size).toBe(labels.length);
  await page.keyboard.press("Escape");
  await expectOrderDraft(parent);
  expect(await parent.evaluate((element) => element.contains(document.activeElement))).toBe(true);
});

test("CAD-03 cliente e técnico salvos sobrevivem cancelar OS e recarregar uma única vez", async ({ page }) => {
  await startContextual(page);
  const parent = await openOrder(page);
  const before = await contextualSaved(page);
  const customer = await openAuxiliary(page, parent, "Cadastrar cliente", "Novo cliente");
  await fillCustomer(customer, "Cliente persistente contextual");
  await customer.getByRole("button", { name: "Salvar cliente", exact: true }).click();
  const technician = await openAuxiliary(page, parent, "Cadastrar técnico", "Novo técnico");
  await technician.getByLabel(/^Nome/).fill("João Contextual");
  await technician.getByRole("button", { name: "Salvar técnico", exact: true }).click();
  await parent.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.reload();
  const next = await openOrder(page);
  await expect(next.getByLabel(/^Cliente/)).toContainText("Cliente persistente contextual");
  await expect(next.getByRole("combobox", { name: /^Técnico responsável/ })).toContainText("João Contextual");
  const after = await contextualSaved(page);
  expect(after.customers.filter((c) => c.name === "Cliente persistente contextual")).toHaveLength(1);
  expect(after.technicians?.filter((t) => t.name === "João Contextual")).toHaveLength(1);
  expectNoOperationalEffects(after, before);
});

test("CAD-01 edição de OS também cria dependência preservando alterações ainda não confirmadas", async ({ page }) => {
  const state = contextualFixture();
  state.orders[0].approved = false;
  state.orders[0].stage = "diagnosing";
  await startContextual(page, "/ordens/?os=" + state.orders[0].id, state);
  await page.getByRole("button", { name: "Editar diagnóstico", exact: true }).click();
  const parent = page.getByRole("dialog", { name: `Editar OS #${state.orders[0].number}`, exact: true });
  await fillOrderDraft(parent);
  const before = await contextualSaved(page);
  const child = await openAuxiliary(page, parent, "Cadastrar técnico", "Novo técnico");
  await child.getByLabel(/^Nome/).fill("Técnica da edição");
  await child.getByRole("button", { name: "Salvar técnico", exact: true }).click();
  await expectOrderDraft(parent, "c2", "Técnica da edição");
  expectNoOperationalEffects(await contextualSaved(page), before);
});

test("CAD-04 venda mantém produto e quantidade ao criar cliente", async ({ page }) => {
  await startContextual(page, "/vendas/");
  const parent = await openSale(page);
  const before = await contextualSaved(page);
  const route = page.url();
  const child = await openAuxiliary(page, parent, "Cadastrar cliente", "Novo cliente");
  await fillCustomer(child, "Cliente da venda contextual");
  await child.getByRole("button", { name: "Salvar cliente", exact: true }).click();
  await expect(parent.getByLabel(/^Produto/)).toHaveValue("p3");
  await expect(parent.getByLabel(/^Quantidade/)).toHaveValue("3");
  const saved = await contextualSaved(page);
  await expect(parent.getByLabel(/^Cliente/)).toHaveValue(saved.customers.find((c) => c.name === "Cliente da venda contextual")!.id);
  expect(page.url()).toBe(route);
  expectNoOperationalEffects(saved, before);
  expect(saved.products).toEqual(before.products);
});

test("CAD-04/06 SKU duplicado preserva os dois rascunhos; produto salvo fica com saldo zero", async ({ page }) => {
  await startContextual(page, "/vendas/");
  const parent = await openSale(page);
  const before = await contextualSaved(page);
  const child = await openAuxiliary(page, parent, "Cadastrar produto", "Novo produto");
  await fillProduct(child, "MOU-LOG");
  await child.getByRole("button", { name: "Salvar produto", exact: true }).click();
  await expect(child.getByRole("alert")).toContainText("SKU");
  await expect(child.getByLabel(/^Nome do produto/)).toHaveValue("Adaptador contextual");
  await expect(child.getByLabel(/^Categoria/)).toHaveValue("Redes especiais");
  await expect(child.getByLabel(/^Preço de venda/)).toHaveValue("79.90");
  expect(await contextualSaved(page)).toEqual(before);
  await child.getByLabel(/^SKU \/ código interno/).fill("CAD-ZERO");
  await child.getByRole("button", { name: "Salvar produto", exact: true }).click();
  await expect(child).toHaveCount(0);
  const saved = await contextualSaved(page);
  const product = saved.products.find((p) => p.sku === "CAD-ZERO")!;
  expect(product).toMatchObject({ stock: 0, reserved: 0, price: 7990, cost: 4490 });
  await expect(parent.getByLabel(/^Produto/)).toHaveValue(product.id);
  await expect(parent.getByLabel(/^Cliente/)).toHaveValue("c3");
  await expect(parent.getByLabel(/^Quantidade/)).toHaveValue("3");
  await expect(parent).toContainText(/estoque|saldo/i);
  await expect(parent.getByRole("button", { name: "Registrar entrada", exact: true })).toBeVisible();
  await expect(parent.getByRole("button", { name: "Confirmar e reservar", exact: true })).toBeDisabled();
  expectNoOperationalEffects(saved, before);
  await parent.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.reload();
  const reloaded = await contextualSaved(page);
  expect(reloaded.products.filter((p) => p.sku === "CAD-ZERO")).toHaveLength(1);
  expectNoOperationalEffects(reloaded, before);
});

test("CAD-05 entrada exige conferência própria, cancela sem efeito e reserva só na venda confirmada", async ({ page }) => {
  await startContextual(page, "/vendas/");
  const parent = await openSale(page);
  const before = await contextualSaved(page);
  const child = await openAuxiliary(page, parent, "Cadastrar produto", "Novo produto");
  await fillProduct(child, "CAD-ENTRADA");
  await child.getByRole("button", { name: "Salvar produto", exact: true }).click();
  let entry = await openAuxiliary(page, parent, "Registrar entrada", "Registrar entrada manual");
  await entry.getByLabel(/^Quantidade recebida/).fill("5");
  await entry.getByLabel(/^Motivo \/ referência/).fill("Conferência fictícia CAD");
  await entry.getByRole("button", { name: "Cancelar", exact: true }).click();
  let current = await contextualSaved(page);
  const product = current.products.find((p) => p.sku === "CAD-ENTRADA")!;
  expect(product.stock).toBe(0);
  expect(product.reserved).toBe(0);
  expectNoOperationalEffects(current, before);
  entry = await openAuxiliary(page, parent, "Registrar entrada", "Registrar entrada manual");
  for (const amount of ["0", "1.5"]) {
    await entry.getByLabel(/^Quantidade recebida/).fill(amount);
    await entry.getByLabel(/^Motivo \/ referência/).fill("Conferência fictícia CAD");
    await entry.getByRole("button", { name: "Confirmar entrada", exact: true }).click();
    await expect(entry).toBeVisible();
    expect((await contextualSaved(page)).products.find((p) => p.id === product.id)?.stock).toBe(0);
  }
  await entry.getByLabel(/^Quantidade recebida/).fill("5");
  await entry.getByLabel(/^Motivo \/ referência/).fill(" ");
  await entry.getByRole("button", { name: "Confirmar entrada", exact: true }).click();
  await expect(entry.getByRole("alert")).toContainText("motivo");
  expect((await contextualSaved(page)).products.find((p) => p.id === product.id)?.stock).toBe(0);
  await entry.getByLabel(/^Motivo \/ referência/).fill("Conferência fictícia CAD");
  await entry.getByRole("button", { name: "Confirmar entrada", exact: true }).click();
  await expect(entry).toHaveCount(0);
  await expect(parent.getByLabel(/^Quantidade/)).toHaveValue("3");
  await expect(parent.getByLabel(/^Cliente/)).toHaveValue("c3");
  current = await contextualSaved(page);
  expect(current.products.find((p) => p.id === product.id)).toMatchObject({ stock: 5, reserved: 0 });
  await page.screenshot({ path: "docs/evidencias/cadastros-venda-entrada.png" });
  expectNoOperationalEffects(current, before);
  await parent.getByRole("button", { name: "Confirmar e reservar", exact: true }).click();
  await expect(parent).toHaveCount(0);
  const confirmed = await contextualSaved(page);
  expect(confirmed.products.find((p) => p.id === product.id)).toMatchObject({ stock: 5, reserved: 3 });
  expect(confirmed.sales).toHaveLength(before.sales.length + 1);
  expect(confirmed.sales[0]).toMatchObject({ customerId: "c3", total: 23970, items: [{ productId: product.id, quantity: 3, unitPrice: 7990 }] });
  expect(confirmed.finance).toEqual(before.finance);
  expect(confirmed.documents).toEqual(before.documents);
});

for (const route of ["/produtos/", "/estoque/"]) {
  test(`CAD-06 categoria livre em ${route} preserva cadastro e vira sugestão reutilizável`, async ({ page }) => {
    const state = contextualFixture();
    state.products[0].category = "Categoria importada demonstrativa";
    await startContextual(page, route, state);
    await page.getByRole("button", { name: "Novo produto", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "Novo produto", exact: true });
    await fillProduct(dialog, "CAD-CATEGORIA", "Automação do balcão");
    await expect(dialog.getByLabel(/^Nome do produto/)).toHaveValue("Adaptador contextual");
    await expect(dialog.getByLabel(/^SKU \/ código interno/)).toHaveValue("CAD-CATEGORIA");
    const suggestions = await dialog.getByLabel(/^Categoria/).evaluate((element) => {
      const input = element as HTMLInputElement;
      return input.list ? [...input.list.options].map((option) => option.value) : [];
    });
    expect(suggestions).toContain("Categoria importada demonstrativa");
    await dialog.getByRole("button", { name: "Salvar produto", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: "Novo produto", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Novo produto", exact: true });
    const updated = await dialog.getByLabel(/^Categoria/).evaluate((element) => [...((element as HTMLInputElement).list?.options || [])].map((option) => option.value));
    expect(updated).toContain("Automação do balcão");
    expect((await contextualSaved(page)).products.find((p) => p.sku === "CAD-CATEGORIA")?.category).toBe("Automação do balcão");
  });
}

test("CAD-07 técnico rejeita nome reservado e duplicata normalizada sem perder OS", async ({ page }) => {
  await startContextual(page);
  const parent = await openOrder(page);
  await fillOrderDraft(parent);
  const before = await contextualSaved(page);
  const child = await openAuxiliary(page, parent, "Cadastrar técnico", "Novo técnico");
  for (const name of ["Não atribuído", "  PEDRO   LIMA  "]) {
    await child.getByLabel(/^Nome/).fill(name);
    await child.getByRole("button", { name: "Salvar técnico", exact: true }).click();
    await expect(child.getByRole("alert")).toBeVisible();
    expect(await contextualSaved(page)).toEqual(before);
  }
  await child.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expectOrderDraft(parent);
});

test("CAD-05 produto serializado pode ser cadastrado, mas não permite confirmar venda demonstrativa", async ({ page }) => {
  await startContextual(page, "/vendas/");
  const parent = await openSale(page);
  const before = await contextualSaved(page);
  const child = await openAuxiliary(page, parent, "Cadastrar produto", "Novo produto");
  await fillProduct(child, "CAD-SERIE");
  await child.getByLabel("Controlar por número de série", { exact: true }).check();
  await child.getByRole("button", { name: "Salvar produto", exact: true }).click();
  await expect(child).toHaveCount(0);
  await expect(parent.getByRole("button", { name: "Confirmar e reservar", exact: true })).toBeDisabled();
  await expect(parent).toContainText(/série/i);
  expectNoOperationalEffects(await contextualSaved(page), before);
});

test("CAD-08 celular mantém etapa auxiliar e ações no viewport sem rolagem horizontal", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startContextual(page);
  const parent = await openOrder(page);
  await fillOrderDraft(parent);
  const child = await openAuxiliary(page, parent, "Cadastrar técnico", "Novo técnico");
  await child.getByLabel(/^Nome/).fill("Técnica no celular");
  const save = child.getByRole("button", { name: "Salvar técnico", exact: true });
  await save.scrollIntoViewIfNeeded();
  await expect(save).toBeInViewport();
  const geometry = await child.evaluate((element) => ({ width: element.scrollWidth, client: element.clientWidth, left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right }));
  expect(geometry.width).toBeLessThanOrEqual(geometry.client + 1);
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "docs/evidencias/cadastros-os-mobile.png" });
  await save.click();
  await expectOrderDraft(parent, "c2", "Técnica no celular");
});

test("CAD-07 painel inclui técnicos cadastrados mesmo sem OS atribuída", async ({ page }) => {
  const state = contextualFixture();
  state.technicians = [{ id: "tech-contextual-dashboard", name: "Técnica cadastrada sem OS" }];
  await startContextual(page, "/", state);
  await expect(page.getByRole("heading", { name: "Sua equipe na assistência", exact: true })).toBeVisible();
  await expect(page.getByText("Técnica cadastrada sem OS", { exact: true })).toBeVisible({ timeout: 2000 });
});
