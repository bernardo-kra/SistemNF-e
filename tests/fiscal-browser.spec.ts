import { test, expect, type Locator, type Page } from "@playwright/test";
import { fiscalFixture } from "./fiscal-fixtures";
import { seed } from "../src/lib/seed";

async function seedBrowser(page: Page) {
  await page.addInitScript((state) => {
    if (!localStorage.getItem("sistem:prototype:v1"))
      localStorage.setItem("sistem:prototype:v1", JSON.stringify(state));
  }, fiscalFixture());
}
async function fillAddress(scope: Page | Locator) {
  await scope
    .getByLabel("Logradouro", { exact: true })
    .fill("Rua da Demonstração");
  await scope.getByLabel("Número", { exact: true }).fill("100");
  await scope.getByLabel("Bairro", { exact: true }).fill("Centro");
  await scope.getByLabel("Município", { exact: true }).fill("São Paulo");
  await scope.getByLabel("UF").selectOption("SP");
  await scope.getByLabel("CEP", { exact: true }).fill("01001000");
  await scope
    .getByLabel("Código IBGE do município", { exact: true })
    .fill("3550308");
}
async function createDraft(page: Page) {
  await page.goto("/demo/fiscal/?source=sale:s400");
  await page.getByRole("button", { name: "Criar rascunho simulado" }).click();
  await expect(page.getByRole("dialog")).toContainText("SIM-000001");
}
async function processDocument(page: Page, outcome: string) {
  await page.getByRole("button", { name: "Colocar na fila simulada" }).click();
  await page.getByLabel("Resultado a simular").selectOption(outcome);
  await page
    .getByRole("button", { name: "Processar simulação", exact: true })
    .click();
}

test("preflight incompleto impede criar documento e oferece caminhos de correção", async ({
  page,
}) => {
  await page.goto("/demo/fiscal/?source=sale:s400");
  await expect(page.getByRole("dialog")).toContainText("pendências");
  await expect(
    page.getByRole("button", { name: "Criar rascunho simulado" }),
  ).toBeDisabled();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: /CNPJ do emitente ausente/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Configuração fiscal", exact: true }),
  ).toBeVisible();
});

test("formulários fiscais aceitam cadastro parcial, rejeitam DV inválido e persistem os dados", async ({
  page,
}) => {
  await page.goto("/demo/fiscal/configuracao/");
  await page.getByLabel("CNPJ do emitente").fill("12ABC34501DE36");
  await page.getByRole("button", { name: "Salvar configuração" }).click();
  await expect(page.locator("form").getByRole("alert")).toContainText(/CNPJ/);
  await page.getByLabel("CNPJ do emitente").fill("12.ABC.345/01DE-35");
  await page
    .getByLabel("Razão social", { exact: true })
    .fill("Empresa fictícia QA");
  await page.getByLabel("Regime tributário").selectOption("presumido");
  await page
    .getByLabel("Inscrição estadual / condição declarada")
    .fill("DEMONSTRACAO");
  await fillAddress(page);
  await page.getByRole("button", { name: "Salvar configuração" }).click();
  await expect(
    page.getByText("Preenchimento completo", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("CNPJ do emitente")).toHaveValue(
    "12ABC34501DE35",
  );
  await expect(page.getByLabel("Município", { exact: true })).toHaveValue(
    "São Paulo",
  );
  await page.goto("/demo/fiscal/revisao/");
  await page.getByRole("button", { name: "Revisar fiscal de MOU-LOG" }).click();
  await page.getByLabel("Código de origem").selectOption("0");
  await page.getByLabel("CFOP da saída").fill("5102");
  await page.getByLabel("CST / CSOSN declarado").fill("00");
  await page.getByRole("button", { name: "Salvar dados declarados" }).click();
  await expect(
    page.getByRole("row").filter({ hasText: "MOU-LOG" }),
  ).toContainText("Completo · a validar");
  await page.getByLabel("Código do serviço (a revisar)").fill("CODIGO-DEMO");
  await page.getByRole("button", { name: "Salvar perfil de serviço" }).click();
  await page.reload();
  await expect(page.getByLabel("Código do serviço (a revisar)")).toHaveValue(
    "CODIGO-DEMO",
  );
  await page.goto("/demo/clientes/");
  await page.getByRole("button", { name: "Novo cliente", exact: true }).click();
  await page
    .getByLabel("Nome / razão social")
    .fill("Cliente fictício fiscal QA");
  await page
    .getByText("Dados fiscais e endereço · opcionais no cadastro", {
      exact: true,
    })
    .click();
  await page.getByLabel("CPF / CNPJ", { exact: true }).fill("12345678900");
  await page.getByRole("button", { name: "Salvar cliente" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "dígitos verificadores",
  );
  await page.getByLabel("CPF / CNPJ", { exact: true }).fill("12345678909");
  await fillAddress(page.getByRole("dialog"));
  await page.getByRole("button", { name: "Salvar cliente" }).click();
  await page.reload();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("sistem:prototype:v1")!).customers.find(
      (c: { name: string }) => c.name === "Cliente fictício fiscal QA",
    ),
  );
  expect(saved.document).toBe("12345678909");
  expect(saved.fiscalAddress.municipalityCode).toBe("3550308");
});

test("rejeição, nova tentativa e cancelamento preservam histórico e operação", async ({
  page,
}) => {
  await seedBrowser(page);
  await createDraft(page);
  await processDocument(page, "rejected");
  await expect(
    page
      .getByRole("dialog")
      .getByText("Rejeitada · simulação", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Revisar para nova tentativa" })
    .click();
  await processDocument(page, "authorized");
  await expect(
    page
      .getByRole("dialog")
      .getByText("Autorizada · simulação", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Justificativa do cancelamento simulado").fill("curto");
  await page
    .getByRole("button", { name: "Solicitar cancelamento simulado" })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "justificativa",
  );
  await page
    .getByLabel("Justificativa do cancelamento simulado")
    .fill("Cancelamento fictício para validar o fluxo de QA");
  await page
    .getByRole("button", { name: "Solicitar cancelamento simulado" })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("Cancelamento pendente", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Confirmar cancelamento fictício" })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("Cancelada · simulação", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Fechar documento" }).click();
  await page.reload();
  await page
    .getByRole("button", { name: "Abrir documento SIM-000001" })
    .click();
  await expect(page.getByRole("dialog")).toContainText("2 tentativa(s)");
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("sistem:prototype:v1")!),
  );
  expect(saved.products).toEqual(fiscalFixture().products);
  expect(saved.orders).toEqual(fiscalFixture().orders);
  expect(saved.sales).toEqual(fiscalFixture().sales);
  expect(
    saved.documents.filter((d: { mode?: string }) => d.mode === "simulation"),
  ).toHaveLength(1);
});

test("timeout persistido bloqueia novo documento e permite consulta após reload", async ({
  page,
}) => {
  await seedBrowser(page);
  await createDraft(page);
  await processDocument(page, "unknown");
  await expect(
    page
      .getByRole("dialog")
      .getByText("Resultado desconhecido", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Fechar documento" }).click();
  await page.reload();
  await page
    .getByRole("button", { name: "Preparar documento", exact: true })
    .click();
  await page.getByLabel("Operação de origem").selectOption("sale:s400");
  await page.getByLabel("Modelo do documento").selectOption("NFC-e");
  await expect(
    page.getByRole("button", { name: "Criar rascunho simulado" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Abrir documento existente" }).click();
  await expect(
    page.getByRole("button", { name: "Processar simulação", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Simular consulta: autorizada" })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("Autorizada · simulação", { exact: true }),
  ).toBeVisible();
});

test("atalho da OS prepara serviço e destaca peças excluídas", async ({
  page,
}) => {
  await seedBrowser(page);
  await page.goto("/demo/ordens/?os=o1040");
  await page.getByRole("link", { name: "Preparar NFS-e simulada" }).click();
  await expect(page.getByRole("dialog")).toContainText(/Peças de R\$\s*220,00/);
  await page.getByRole("button", { name: "Criar rascunho simulado" }).click();
  await expect(page.getByRole("dialog")).toContainText("NFS-e SIM-000001");
  await expect(page.getByRole("dialog")).toContainText(/R\$\s*120,00/);
});

test("migração do navegador preserva v1 e telas fiscais cabem em 390px", async ({
  page,
}) => {
  const {
    fiscalProfile: _profile,
    serviceFiscal: _service,
    ...legacy
  } = structuredClone(seed);
  await page.addInitScript(
    (value) => {
      if (!localStorage.getItem("sistem:prototype:v1"))
        localStorage.setItem("sistem:prototype:v1", JSON.stringify(value));
    },
    {
      ...legacy,
      version: 1,
      customers: [
        { ...legacy.customers[0], name: "Cliente anterior QA" },
        ...legacy.customers.slice(1),
      ],
    },
  );
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of [
    "/fiscal/",
    "/fiscal/configuracao/",
    "/fiscal/revisao/",
  ]) {
    await page.goto(`/demo${path}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.getByRole("button", { name: "Revisar fiscal de MOU-LOG" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page
      .getByRole("dialog")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("sistem:prototype:v1")!).customers[0]
          .name,
    ),
  ).toBe("Cliente anterior QA");
});
