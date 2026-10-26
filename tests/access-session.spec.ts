import { test, expect, type Page } from "@playwright/test";

const companyA = "10000000-0000-4000-8000-000000000001";
const companyB = "20000000-0000-4000-8000-000000000002";
const rights = ["customers.read", "customers.create", "customers.update", "customers.archive"];
const manager = { id: "manager", name: "Gestora de teste", email: "manager@example.test" };
const member = { ...manager, role: "owner", active: true, version: 1, permissions: [...rights, "team.read", "team.manage"], overrides: {}, createdAt: null, updatedAt: null };
const options = { roles: [
  { id: "owner", label: "Gestor", permissions: [...rights, "team.read", "team.manage"] },
  { id: "operator", label: "Atendimento", permissions: rights },
  { id: "viewer", label: "Consulta", permissions: ["customers.read"] },
], permissions: rights.map((id, i) => ({ id, label: ["Consultar clientes", "Criar clientes", "Editar clientes", "Inativar clientes"][i] })) };
const company = (id = companyA, name = "Loja A") => ({ id, name, role: "owner", permissions: [...rights, "team.read", "team.manage"] });

async function api(page: Page, handler: (path: string, method: string, body: any, params: URLSearchParams) => Promise<{ status?: number; body: any }> | { status?: number; body: any }) {
  await page.route("http://127.0.0.1:4000/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: { "access-control-allow-origin": "http://127.0.0.1:3000", "access-control-allow-credentials": "true", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST,PATCH,OPTIONS" } });
      return;
    }
    const url = new URL(request.url());
    const result = await handler(url.pathname, request.method(), request.postDataJSON(), url.searchParams);
    await route.fulfill({ status: result.status ?? 200, json: result.body, headers: { "access-control-allow-origin": "http://127.0.0.1:3000", "access-control-allow-credentials": "true" } }).catch(() => {});
  });
}
const failure = (status: number) => ({ status, body: { error: { code: "SERVICE_UNAVAILABLE", message: "Serviço indisponível.", requestId: "qa-safe" } } });

test("ACC-UI01 login e cadastro ficam na página; falha preserva rascunho e tentativa, sucesso não persiste senha", async ({ page }) => {
  let signed = false, fail = true;
  const attempts: any[] = [];
  const employees: any[] = [member];
  await api(page, (path, method, body) => {
    if (path.endsWith("sign-in/email")) { signed = true; return { body: { user: manager } }; }
    if (path.endsWith("/me")) return signed ? { body: { user: manager, tenants: [company()] } } : failure(401);
    if (path.endsWith("access-options")) return { body: { tenantId: companyA, ...options } };
    if (path.endsWith("access-audit")) return { body: { tenantId: companyA, items: [], total: 0, limit: 25, offset: 0 } };
    if (path.endsWith("members") && method === "POST") {
      attempts.push(body);
      if (fail) return failure(503);
      const saved = { ...member, id: "employee", name: body.name, email: body.email, role: body.role, permissions: rights };
      employees.push(saved);
      return { status: 201, body: { tenantId: companyA, member: saved } };
    }
    return { body: { tenantId: companyA, items: employees, total: employees.length, limit: 25, offset: 0 } };
  });
  await page.goto("/acessos/");
  await page.getByLabel("E-mail", { exact: true }).fill(manager.email);
  await page.getByLabel("Senha", { exact: true }).fill("Senha-login-ficticia!");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByText(manager.name, { exact: true }).first()).toBeVisible();
  let navigations = 0;
  page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigations++; });
  await page.getByRole("button", { name: "Novo funcionário", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome", { exact: true }).fill("Funcionária nova");
  await dialog.getByLabel("E-mail", { exact: true }).fill("new@example.test");
  await dialog.getByLabel("Senha inicial", { exact: true }).fill("Senha-inicial-ficticia!");
  await dialog.getByRole("button", { name: "Salvar funcionário", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("Nome", { exact: true })).toHaveValue("Funcionária nova");
  fail = false;
  await dialog.getByRole("button", { name: "Salvar funcionário", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Funcionária nova", { exact: true })).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[0].requestId).toBe(attempts[1].requestId);
  expect(navigations).toBe(0);
  const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(stored).not.toContain("Senha-login-ficticia");
  expect(stored).not.toContain("Senha-inicial-ficticia");
});

test("ACC-UI02 falha de conexão não mostra equipe fictícia e permite tentar novamente", async ({ page }) => {
  await api(page, () => failure(503));
  await page.goto("/acessos/");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Não foi possível conectar ao serviço.");
  await expect(page.getByRole("button", { name: "Tentar novamente", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Novo funcionário", exact: true })).toHaveCount(0);
  await expect(page.getByText("André Martins", { exact: true })).toHaveCount(0);
});

test("ACC-UI03 perfil sem administração não consulta lista ou auditoria de funcionários", async ({ page }) => {
  const queried: string[] = [];
  await api(page, (path) => {
    queried.push(path);
    return { body: { user: manager, tenants: [{ ...company(), role: "viewer", permissions: ["customers.read"] }] } };
  });
  await page.goto("/acessos/");
  await expect(page.getByText("Seu perfil não permite administrar a equipe.", { exact: true })).toBeVisible();
  expect(queried.filter((path) => /members|access-audit|access-options/.test(path))).toEqual([]);
});

test("ACC-UI04 trocar empresa descarta resposta antiga e limpa dados antes de carregar o destino", async ({ page }) => {
  let releaseA!: () => void;
  const delayedA = new Promise<void>((resolve) => { releaseA = resolve; });
  await api(page, async (path) => {
    if (path.endsWith("/me")) return { body: { user: manager, tenants: [company(), company(companyB, "Loja B")] } };
    const id = path.includes(companyB) ? companyB : companyA;
    if (path.endsWith("access-options")) return { body: { tenantId: id, ...options } };
    if (path.endsWith("access-audit")) return { body: { tenantId: id, items: [], total: 0, limit: 25, offset: 0 } };
    if (id === companyA) await delayedA;
    return { body: { tenantId: id, items: [{ ...member, name: id === companyA ? "Nome antigo A" : "Nome correto B" }], total: 1, limit: 25, offset: 0 } };
  });
  await page.goto("/acessos/");
  await page.getByLabel("Empresa", { exact: true }).selectOption(companyA);
  await page.getByLabel("Empresa", { exact: true }).selectOption(companyB);
  await expect(page.getByText("Nome correto B", { exact: true })).toBeVisible();
  releaseA();
  await expect(page.getByText("Nome antigo A", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Nome correto B", { exact: true })).toBeVisible();
});

test("ACC-UI09 nova sessão não reaproveita busca, datas, situação ou página da conta anterior", async ({ page }) => {
  let signed = true, nextSession = false;
  const queries: { next: boolean; q: string; offset: string }[] = [];
  await api(page, (path, _method, _body, params) => {
    if (path.endsWith("sign-out")) { signed = false; return { body: { success: true } }; }
    if (path.endsWith("sign-in/email")) { signed = true; nextSession = true; return { body: { user: manager } }; }
    const tenantId = nextSession ? companyB : companyA;
    if (path.endsWith("/me")) return signed ? { body: { user: { ...manager, id: nextSession ? "other-manager" : manager.id }, tenants: [company(tenantId)] } } : failure(401);
    if (path.endsWith("access-options")) return { body: { tenantId, ...options } };
    if (path.endsWith("access-audit")) return { body: { tenantId, items: [], total: 0, limit: 25, offset: 0 } };
    queries.push({ next: nextSession, q: params.get("q") ?? "", offset: params.get("offset") ?? "0" });
    return { body: { tenantId, items: [member], total: 1, limit: 25, offset: 0 } };
  });
  await page.goto("/acessos/");
  await page.getByLabel("Buscar funcionário", { exact: true }).fill("private-session-filter");
  await expect.poll(() => queries.some((item) => item.q === "private-session-filter")).toBe(true);
  await page.getByLabel("Status", { exact: true }).selectOption("inactive");
  await page.getByLabel("Ordenar por", { exact: true }).selectOption("created");
  await page.getByText("Filtrar por período", { exact: true }).click();
  await page.getByLabel("De", { exact: true }).fill("2026-01-01");
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await page.getByLabel("E-mail", { exact: true }).fill("other@example.test");
  await page.getByLabel("Senha", { exact: true }).fill("Other-password-ficticia!");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByLabel("Buscar funcionário", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Status", { exact: true })).toHaveValue("all");
  await expect(page.getByLabel("Ordenar por", { exact: true })).toHaveValue("name");
  await page.getByText("Filtrar por período", { exact: true }).click();
  await expect(page.getByLabel("De", { exact: true })).toHaveValue("");
  await expect.poll(() => queries.some((item) => item.next)).toBe(true);
  expect(queries.filter((item) => item.next).every((item) => item.q === "" && item.offset === "0")).toBe(true);
});

test("ACC-UI10 gravação em andamento impede alterar os campos que estão sendo confirmados", async ({ page }) => {
  let release!: () => void, started!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const submitted = new Promise<void>((resolve) => { started = resolve; });
  await api(page, async (path, method) => {
    if (path.endsWith("/me")) return { body: { user: manager, tenants: [company()] } };
    if (path.endsWith("access-options")) return { body: { tenantId: companyA, ...options } };
    if (path.endsWith("access-audit")) return { body: { tenantId: companyA, items: [], total: 0, limit: 25, offset: 0 } };
    if (method === "POST") { started(); await pending; return { status: 201, body: { tenantId: companyA, member } }; }
    return { body: { tenantId: companyA, items: [member], total: 1, limit: 25, offset: 0 } };
  });
  await page.goto("/acessos/");
  await page.getByRole("button", { name: "Novo funcionário", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome", { exact: true }).fill("Pessoa nova");
  await dialog.getByLabel("E-mail", { exact: true }).fill("person@example.test");
  await dialog.getByLabel("Senha inicial", { exact: true }).fill("Password-ficticia!");
  await dialog.getByRole("button", { name: "Salvar funcionário", exact: true }).click();
  await submitted;
  try {
    for (const label of ["Nome", "E-mail", "Senha inicial", "Perfil"]) await expect(dialog.getByLabel(label, { exact: true })).toBeDisabled();
  } finally { release(); }
  await expect(dialog).toHaveCount(0);
});

test("ACC-UI11 recarregar conflito usa ID do vínculo e funciona com e-mail válido maior que o limite da busca", async ({ page }) => {
  const employee = { ...member, id: "long-email-member", name: "Pessoa com e-mail extenso", email: `account@${"longhost.".repeat(12)}example.test`, role: "operator" };
  let fetchedById = 0;
  const versions: number[] = [];
  await api(page, (path, method, body, params) => {
    if (path.endsWith("/me")) return { body: { user: manager, tenants: [company()] } };
    if (path.endsWith("access-options")) return { body: { tenantId: companyA, ...options } };
    if (path.endsWith("access-audit")) return { body: { tenantId: companyA, items: [], total: 0, limit: 25, offset: 0 } };
    if (method === "PATCH") {
      versions.push(body.version);
      return body.version === 1 ? { status: 409, body: { error: { code: "VERSION_CONFLICT", message: "Alterado", requestId: "safe" } } } : { body: { tenantId: companyA, member: { ...employee, version: 3 } } };
    }
    if (path.endsWith(`/members/${employee.id}`)) { fetchedById++; return { body: { tenantId: companyA, member: { ...employee, version: 2 } } }; }
    if ((params.get("q") ?? "").length > 100) return failure(400);
    return { body: { tenantId: companyA, items: [employee], total: 1, limit: 25, offset: 0 } };
  });
  await page.goto("/acessos/");
  await page.getByRole("button", { name: `Editar acessos de ${employee.name}`, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Perfil", { exact: true }).selectOption("viewer");
  await dialog.getByRole("button", { name: "Salvar acessos", exact: true }).click();
  await dialog.getByRole("button", { name: "Recarregar cadastro", exact: true }).click();
  await expect.poll(() => fetchedById).toBe(1);
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Salvar acessos", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(versions).toEqual([1, 2]);
});
