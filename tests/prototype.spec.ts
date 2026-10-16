import { test, expect } from "@playwright/test";

test("nova OS registra equipamento e não cria recebível antes de aprovação", async ({
  page,
}) => {
  await page.goto("/ordens/");
  await page
    .getByRole("button", { name: "Nova ordem de serviço", exact: true })
    .click();
  await page
    .getByLabel("Equipamento / marca e modelo")
    .fill("Notebook teste de entrada");
  await page.getByLabel("Número de série / etiqueta").fill("QA-EQUIP-001");
  await page
    .getByLabel("Problema relatado pelo cliente")
    .fill("Falha ao ligar durante a conferência.");
  await page
    .getByRole("button", { name: "Abrir ordem de serviço", exact: true })
    .click();
  const row = page.getByRole("row").filter({ hasText: "QA-EQUIP-001" });
  await expect(row).toContainText("Recebida");
  await row.getByRole("button", { name: "Abrir OS 1043" }).click();
  await expect(page.getByText("Recebível não gerado")).toBeVisible();
  await expect(page.getByText("QA-EQUIP-001", { exact: true })).toBeVisible();
});

test("cadastro de cliente permanece após recarregar", async ({ page }) => {
  await page.goto("/clientes/");
  await page.getByRole("button", { name: "Novo cliente", exact: true }).click();
  await page.getByLabel("Nome / razão social").fill("Cliente Teste QA");
  await page.getByLabel("E-mail", { exact: true }).fill("teste@example.com");
  await page.getByRole("button", { name: "Salvar cliente" }).click();
  await expect(
    page.getByRole("row").filter({ hasText: "Cliente Teste QA" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("row").filter({ hasText: "Cliente Teste QA" }),
  ).toBeVisible();
});

test("produto novo não gera saldo; entrada manual altera apenas estoque", async ({
  page,
}) => {
  await page.goto("/produtos/");
  await page.getByRole("button", { name: "Novo produto", exact: true }).click();
  await page.getByLabel("Nome do produto").fill("Adaptador de teste");
  await page.getByLabel("SKU / código interno").fill("QA-ADAPT");
  await page.getByLabel("Preço de venda").fill("39.90");
  await page.getByRole("button", { name: "Salvar produto" }).click();
  let row = page.getByRole("row").filter({ hasText: "QA-ADAPT" });
  await expect(row).toContainText("0 UN");
  await page.getByRole("link", { name: "Estoque", exact: true }).click();
  row = page.getByRole("row").filter({ hasText: "QA-ADAPT" });
  await row.getByRole("button", { name: "Entrada" }).click();
  await page.getByLabel("Quantidade recebida").fill("4");
  await page.getByLabel("Motivo / referência").fill("Entrada de teste");
  await page.getByRole("button", { name: "Confirmar entrada" }).click();
  await expect(row).toContainText("4 UN");
});

test("OS exige aprovação e checklist antes de entregar", async ({ page }) => {
  await page.goto("/ordens/?os=o1042");
  await expect(page.getByText("Recebível não gerado")).toBeVisible();
  await page
    .getByRole("button", { name: "Registrar aprovação", exact: true })
    .click();
  await page
    .getByLabel("Responsável e canal da aprovação")
    .fill("Mariana, por telefone, aprovou todos os valores.");
  await page.getByLabel("Confirmo que o cliente autorizou").check();
  await page.getByRole("button", { name: "Confirmar etapa" }).click();
  await expect(
    page.getByText("Orçamento aprovado", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Encaminhar para testes", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirmar etapa" }).click();
  await page
    .getByRole("button", { name: "Concluir testes", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirmar etapa" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("Funcionamento testado após o reparo").check();
  await page.getByLabel("Equipamento e acessórios conferidos").check();
  await page.getByLabel("Resultado do serviço aprovado pelo técnico").check();
  await page.getByRole("button", { name: "Confirmar etapa" }).click();
  await page
    .getByRole("button", { name: "Registrar entrega", exact: true })
    .click();
  await page
    .getByLabel("Nome do responsável pela retirada")
    .fill("Mariana Costa");
  await page
    .getByLabel("Equipamento e acessórios foram conferidos e entregues")
    .check();
  await page.getByRole("button", { name: "Confirmar etapa" }).click();
  await expect(
    page.getByRole("button", { name: "Atendimento concluído" }),
  ).toBeDisabled();
  await expect(
    page.getByText("Entregue ao cliente", { exact: true }),
  ).toBeVisible();
});

test("recebimento parcial preserva saldo e aprovação pendente não aparece como dívida", async ({
  page,
}) => {
  await page.goto("/financeiro/");
  await expect(
    page.getByRole("row").filter({ hasText: "OS #1042" }),
  ).toHaveCount(0);
  const row = page.getByRole("row").filter({ hasText: "OS #1041" });
  await row.getByRole("button", { name: "Receber", exact: true }).click();
  await page.getByLabel("Valor recebido").fill("20");
  await page.getByRole("button", { name: "Confirmar recebimento" }).click();
  await expect(row).toContainText("R$ 75,00");
  await expect(row).toContainText("R$ 120,00");
});

test("importação cria somente produtos novos e bloqueia o mesmo documento", async ({
  page,
}) => {
  await page.goto("/importar/");
  await page.getByRole("button", { name: /Experimentar com uma nota/ }).click();
  await page
    .getByRole("button", { name: "Revisar cadastro", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirmar cadastros" }).click();
  await expect(
    page.getByText("2 novos cadastros criados.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Ver produtos" }).click();
  await expect(
    page.getByRole("row").filter({ hasText: "HUB-USB" }),
  ).toContainText("0 UN");
  await page.goto("/importar/");
  await page.getByRole("button", { name: /Experimentar com uma nota/ }).click();
  await page
    .getByLabel("Ação para Cabo USB-C")
    .selectOption({ label: "Vincular: CAB-USB-C" });
  await page
    .getByLabel("Ação para Hub USB")
    .selectOption({ label: "Vincular: HUB-USB" });
  await page
    .getByRole("button", { name: "Revisar cadastro", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirmar cadastros" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "já foi utilizado" }),
  ).toBeVisible();
});

test("venda reserva e entrega baixa uma única vez", async ({ page }) => {
  await page.goto("/vendas/");
  await page.getByRole("button", { name: "Nova venda", exact: true }).click();
  await page.getByLabel("Produto", { exact: false }).selectOption("p3");
  await page.getByLabel("Quantidade").fill("2");
  await page.getByRole("button", { name: "Confirmar e reservar" }).click();
  const row = page.getByRole("row").filter({ hasText: "#402" });
  await expect(row).toContainText("Confirmado");
  await row.getByRole("button", { name: "Entregar", exact: true }).click();
  await expect(row).toContainText("Entregue");
  await expect(
    row.getByRole("button", { name: "Entregar", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Estoque", exact: true }).click();
  const mouse = page.getByRole("row").filter({ hasText: "MOU-LOG" });
  await expect(mouse).toContainText("13 UN");
});

test("XML malformado mostra erro e permite nova tentativa", async ({
  page,
}) => {
  await page.goto("/importar/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "invalid.xml",
    mimeType: "application/xml",
    buffer: Buffer.from("<nfe><broken></nfe>"),
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "Não foi possível ler" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Experimentar com uma nota/ }).click();
  await expect(
    page.getByRole("heading", { name: "Distribuidora Exemplo de Informática" }),
  ).toBeVisible();
});

test("mobile tem navegação, modal acessível e não vaza largura", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Visão geral", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Abrir navegação" }).click();
  await page.getByRole("link", { name: "Clientes", exact: true }).click();
  await page.getByRole("button", { name: "Novo cliente", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(errors).toEqual([]);
});
