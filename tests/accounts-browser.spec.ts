import { expect, test, type Page } from "@playwright/test";

// Interface com respostas controladas; não substitui o smoke PostgreSQL/cookie real.
const tenantId = "10000000-0000-4000-8000-000000000001";
const rights = ["customers.read", "customers.create", "customers.update", "customers.archive"];
const manager = { id: "manager-ui", name: "Gestora UI", email: "manager-ui@example.test" };
const employee = { id: "employee-ui", name: "Funcionário QA", email: "employee-ui@example.test", role: "operator", active: true, version: 1,
  permissions: rights, overrides: {}, createdAt: "2026-10-25T14:00:00.000Z", updatedAt: "2026-10-25T14:00:00.000Z" };
const options = { tenantId, roles: [
  { id: "owner", label: "Gestor", permissions: [...rights, "team.read", "team.manage"] },
  { id: "operator", label: "Atendimento", permissions: rights },
  { id: "viewer", label: "Consulta", permissions: ["customers.read"] },
], permissions: rights.map((id, index) => ({ id, label: ["Consultar clientes", "Criar clientes", "Editar clientes", "Inativar clientes"][index] })) };

async function connected(page: Page, mutation: (method: string, path: string, body: any) => { status: number; body: any }) {
  let signed = true;
  await page.route("http://127.0.0.1:4000/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const headers = { "access-control-allow-origin": "http://127.0.0.1:3000", "access-control-allow-credentials": "true",
      "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST,PATCH,OPTIONS" };
    if (request.method() === "OPTIONS") { await route.fulfill({ status: 204, headers }); return; }
    let result: { status?: number; body: any };
    if (path.endsWith("sign-out")) { signed = false; result = { body: { success: true } }; }
    else if (request.method() === "PATCH") {
      result = mutation(request.method(), path, request.postDataJSON());
      if (result.status === 401) signed = false;
    } else if (path.endsWith("/me")) result = signed ? { body: { user: manager, tenants: [{ id: tenantId, name: "Loja QA", role: "owner", permissions: [...rights, "team.read", "team.manage"] }] } }
      : { status: 401, body: { error: { code: "UNAUTHENTICATED", message: "Entre novamente.", requestId: "qa-auth" } } };
    else if (path.endsWith("access-options")) result = { body: options };
    else if (path.endsWith("access-audit")) result = { body: { tenantId, items: [], total: 0, limit: 25, offset: 0 } };
    else result = { body: { tenantId, items: [employee], total: 1, limit: 25, offset: 0 } };
    await route.fulfill({ status: result.status ?? 200, headers, json: result.body });
  });
  await page.goto("/acessos/");
  await expect(page.getByText(employee.name, { exact: true })).toBeVisible();
}
const edit = (page: Page) => page.getByRole("button", { name: `Editar acessos de ${employee.name}`, exact: true });

test("ACC-UI05 conflito de versão preserva alterações e contexto sem anunciar gravação", async ({ page }) => {
  const bodies: any[] = [];
  await connected(page, (_method, _path, body) => {
    bodies.push(body);
    return { status: 409, body: { error: { code: "VERSION_CONFLICT", message: "O registro foi alterado. Recarregue antes de salvar.", requestId: "qa-conflict" } } };
  });
  await edit(page).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Perfil", { exact: true }).selectOption("viewer");
  await dialog.getByText("Personalizar permissões de clientes", { exact: true }).click();
  await dialog.getByLabel("Criar clientes", { exact: true }).check();
  await dialog.getByRole("button", { name: "Salvar acessos", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("O registro foi alterado");
  await expect(dialog.getByLabel("Perfil", { exact: true })).toHaveValue("viewer");
  await expect(dialog.getByLabel("Criar clientes", { exact: true })).toBeChecked();
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({ version: 1, role: "viewer", overrides: { "customers.create": true } });
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(edit(page)).toBeFocused();
  expect(page.url()).toContain("/acessos/");
});

test("ACC-UI06 logout e sessão expirada removem dados e rascunhos do contexto anterior", async ({ page }) => {
  await connected(page, () => ({ status: 401, body: { error: { code: "UNAUTHENTICATED", message: "Entre novamente.", requestId: "qa-expired" } } }));
  await edit(page).click();
  await page.getByRole("dialog").getByLabel("Perfil", { exact: true }).selectOption("viewer");
  await page.getByRole("dialog").getByRole("button", { name: "Salvar acessos", exact: true }).click();
  await expect(page.getByLabel("E-mail", { exact: true })).toBeVisible();
  await expect(page.getByText(employee.name, { exact: true })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Uma nova visita com sessão válida não restaura o rascunho expirado.
  await page.unroute("http://127.0.0.1:4000/**");
  await connected(page, () => ({ status: 500, body: {} }));
  await edit(page).click();
  await expect(page.getByRole("dialog").getByLabel("Perfil", { exact: true })).toHaveValue("operator");
  await page.getByRole("dialog").getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await expect(page.getByLabel("E-mail", { exact: true })).toBeVisible();
  await expect(page.getByText(employee.name, { exact: true })).toHaveCount(0);
});

test("ACC-UI07 mobile e teclado mantêm foco na edição, Escape cancela sem escrita", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let writes = 0;
  await connected(page, () => { writes++; return { status: 500, body: {} }; });
  await edit(page).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Perfil", { exact: true }).focus();
  for (let index = 0; index < 12; index++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('dialog, [role="dialog"]')))).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0); await expect(edit(page)).toBeFocused();
  expect(writes).toBe(0);
});

test("ACC-UI08 resposta de equipe pendente não repovoa a tela depois de acesso revogado", async ({ page }) => {
  let releaseMembers!: () => void, markMembers!: () => void;
  const delayed = new Promise<void>((resolve) => { releaseMembers = resolve; });
  const requested = new Promise<void>((resolve) => { markMembers = resolve; });
  const settled = new Promise<void>((resolve) => {
    const done = (request: { url(): string }) => {
      if (!request.url().includes("/members?")) return;
      page.off("requestfinished", done); page.off("requestfailed", done); resolve();
    };
    page.on("requestfinished", done); page.on("requestfailed", done);
  });
  await page.route("http://127.0.0.1:4000/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const headers = { "access-control-allow-origin": "http://127.0.0.1:3000", "access-control-allow-credentials": "true" };
    let body: any, status = 200;
    if (path.endsWith("/me")) body = { user: manager, tenants: [{ id: tenantId, name: "Loja QA", role: "owner", permissions: [...rights, "team.read", "team.manage"] }] };
    else if (path.endsWith("access-options")) {
      await requested;
      status = 403; body = { error: { code: "FORBIDDEN", message: "Acesso revogado.", requestId: "qa-revoked" } };
    } else if (path.endsWith("members")) {
      markMembers(); await delayed;
      body = { tenantId, items: [{ ...employee, name: "Dado que deve permanecer limpo" }], total: 1, limit: 25, offset: 0 };
    } else body = { tenantId, items: [], total: 0, limit: 25, offset: 0 };
    await route.fulfill({ status, headers, json: body }).catch(() => {});
  });
  await page.goto("/acessos/");
  // Next também anuncia rotas com role=alert; exigir o erro real da área de trabalho.
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Você não tem permissão");
  releaseMembers();
  // Aceita aborto ou término da requisição; aguarda o corpo e duas oportunidades de renderização.
  await settled;
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByText("Dado que deve permanecer limpo", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Novo funcionário", exact: true })).toHaveCount(0);
});
