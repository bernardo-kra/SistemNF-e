import { expect, test, type Page } from "@playwright/test";
const tenant = "10000000-0000-4000-8000-000000000001";
const rights = ["customers.read", "orders.read", "fiscal.read", "fiscal.configure", "fiscal.certificates.manage"];
async function api(page: Page, manage = true, configured = true) {
  const calls: { method: string; path: string; body: any }[] = [];
  let failed = false;
  await page.route("http://127.0.0.1:4000/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    const headers = { "access-control-allow-origin": "http://127.0.0.1:3000", "access-control-allow-credentials": "true", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,PATCH,OPTIONS" };
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers });
    const body = request.postDataJSON();
    calls.push({ method, path, body });
    let json: unknown = {};
    if (path.endsWith("/me")) json = { user: { id: "generic-manager", name: "Pessoa QA", email: "qa@example.test" }, tenants: [{ id: tenant, name: "Empresa genérica QA", role: "owner", permissions: manage ? rights : ["fiscal.read"] }] };
    else if (path.endsWith("/branding")) json = { branding: { version: 0, logo: null, background: null, backgroundOpacity: 10 } };
    else if (path.endsWith("/profile")) json = { profile: { version: 1, fields: { cnpj: "11222333000181" }, missingFields: ["regime"], unsupportedFields: [], preparationReady: false } };
    else if(path.endsWith("/readiness"))json={tenantId:tenant,environment:"production-restricted",readyForSubmission:false,setup:{profileComplete:false,certificateRegistered:false,certificateCurrentForIssuer:false,storageConfigured:false},technicalBlockers:[]};
  else if (path.endsWith("/certificate")) {
      if (method === "PATCH" && !failed && body.passphrase === "retry-generic") {
        failed = true;
        return route.fulfill({ status: 503, headers, json: { error: { code: "SERVICE_UNAVAILABLE" } } });
      }
      json = { tenantId: tenant, storageConfigured: configured, certificate: method === "PATCH" ? { version: 1, validTo: "2027-01-01T00:00:00.000Z", readyForSubmission: false } : null };
    }
    return route.fulfill({ headers, json });
  });
  return calls;
}
for (const width of [1440, 320]) test(`CERT-UI01 cadastra com arquivo/senha sem repetir CNPJ e sem refetch em ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 1000 });
  const calls = await api(page);
  await page.goto("/fiscal/configuracao/");
  const file = page.getByLabel("Arquivo do certificado A1", { exact: true });
  await file.setInputFiles({ name: "generic.pfx", mimeType: "application/x-pkcs12", buffer: Buffer.from("GENERIC-PFX") });
  await page.getByLabel("Senha do certificado", { exact: true }).fill("generic-secret");
  await page.getByRole("button", { name: "Salvar certificado", exact: true }).click();
  await expect(page.getByText("Certificado salvo. A emissão oficial continua pendente.", { exact: true })).toBeVisible();
  expect(calls.filter(call => call.method === "PATCH" && call.path.endsWith("/certificate"))).toHaveLength(1);
  expect(calls.filter(call => call.method === "GET" && call.path.endsWith("/certificate"))).toHaveLength(1);
  const body = calls.find(call => call.method === "PATCH")!.body;
  expect(body.pfxBase64).toBe(Buffer.from("GENERIC-PFX").toString("base64"));
  expect(body).not.toHaveProperty("issuerCnpj");
  expect(body).not.toHaveProperty("fileName");
  expect(body.profileVersion).toBe(1);
  await expect(page.getByLabel("Senha do certificado", { exact: true })).toHaveValue("");
  expect(await file.evaluate((node: HTMLInputElement) => node.files?.length)).toBe(0);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))).not.toMatch(/generic-secret|R0VORVJJQy1QRlg=/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo(0, 0); });
  await page.waitForTimeout(250); // Capture stable responsive layout, not the sidebar's resize transition.
  await page.screenshot({ path: info.outputPath(`certificate-${width}.png`), fullPage: true });
});
test("CERT-UI02 mantém somente intenção estável ao repetir, invalidando por edição e limpando ao cancelar", async ({ page }) => {
  const calls = await api(page);
  await page.goto("/fiscal/configuracao/");
  const file = page.getByLabel("Arquivo do certificado A1", { exact: true }), password = page.getByLabel("Senha do certificado", { exact: true });
  await file.setInputFiles({ name: "generic.p12", mimeType: "application/x-pkcs12", buffer: Buffer.from("GENERIC") });
  await password.fill("retry-generic");
  const save = page.getByRole("button", { name: "Salvar certificado", exact: true });
  await save.click();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByText("Certificado salvo. A emissão oficial continua pendente.", { exact: true })).toBeVisible();
  const sent = calls.filter(call => call.method === "PATCH");
  expect(sent[0].body.requestId).toBe(sent[1].body.requestId);
  await file.setInputFiles({ name: "generic.pfx", mimeType: "application/x-pkcs12", buffer: Buffer.from("NEXT-GENERIC") });
  await password.fill("new-generic");
  await page.getByRole("button", { name: "Limpar arquivo e senha", exact: true }).click();
  await expect(password).toHaveValue("");
  expect(await file.evaluate((node: HTMLInputElement) => node.files?.length)).toBe(0);
});
test("CERT-UI03 consulta sem direito de gestão e configuração ausente não permitem upload", async ({ page }) => {
  await api(page, false);
  await page.goto("/fiscal/configuracao/");
  await expect(page.getByText("Nenhum certificado cadastrado.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Arquivo do certificado A1", { exact: true })).toHaveCount(0);
  await page.unrouteAll();
  await api(page, true, false);
  await page.reload();
  await expect(page.getByText("O administrador precisa habilitar o armazenamento protegido no servidor.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Salvar certificado", exact: true })).toHaveCount(0);
});
test("CERT-UI04 resposta atrasada não mantém senha nem notificação após sair da empresa", async ({ page }) => {
  await api(page);
  let release = () => {}, seen = false;
  await page.route("**/fiscal/certificate", async route => {
    if (route.request().method() !== "PATCH") return route.fallback();
    seen = true;
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ headers: { "access-control-allow-origin": "http://127.0.0.1:3000", "access-control-allow-credentials": "true" }, json: { tenantId: tenant, storageConfigured: true, certificate: { version: 1 } } }).catch(() => {});
  });
  try {
    await page.goto("/fiscal/configuracao/");
    await page.getByLabel("Arquivo do certificado A1", { exact: true }).setInputFiles({ name: "generic.pfx", mimeType: "application/x-pkcs12", buffer: Buffer.from("GENERIC") });
    await page.getByLabel("Senha do certificado", { exact: true }).fill("generic-secret");
    await page.getByRole("button", { name: "Salvar certificado", exact: true }).click();
    await expect.poll(() => seen).toBe(true);
    await page.getByLabel("Empresa", { exact: true }).selectOption("");
    release();
    await expect(page.getByText("Selecione uma empresa para continuar.", { exact: true })).toBeVisible();
    await expect(page.getByText("Certificado salvo. A emissão oficial continua pendente.", { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))).not.toContain("generic-secret");
  } finally { release(); }
});

test("CERT-UI05 conflito atualiza a versão explicitamente preservando arquivo/senha, sem substituição automática", async ({ page }) => {
  const calls = await api(page);
  let conflict = false;
  await page.route("**/fiscal/certificate", async route => {
    if (route.request().method() === "PATCH" && !conflict) {
      conflict = true;
      return route.fulfill({ status: 409, headers: { "access-control-allow-origin": "http://127.0.0.1:3000", "access-control-allow-credentials": "true" }, json: { error: { code: "VERSION_CONFLICT" } } });
    }
    if (conflict && route.request().method() === "GET") return route.fulfill({ headers: { "access-control-allow-origin": "http://127.0.0.1:3000", "access-control-allow-credentials": "true" }, json: { tenantId: tenant, storageConfigured: true, certificate: { version: 2, validTo: "2027-01-01T00:00:00Z", readyForSubmission: false } } });
    return route.fallback();
  });
  await page.goto("/fiscal/configuracao/");
  const file = page.getByLabel("Arquivo do certificado A1", { exact: true }), password = page.getByLabel("Senha do certificado", { exact: true });
  await file.setInputFiles({ name: "generic.pfx", mimeType: "application/x-pkcs12", buffer: Buffer.from("GENERIC") });
  await password.fill("generic-secret");
  const save = page.getByRole("button", { name: "Salvar certificado", exact: true });
  await save.click();
  await page.getByRole("button", { name: "Atualizar dados do certificado", exact: true }).click();
  await expect(password).toHaveValue("generic-secret");
  expect(await file.evaluate((node: HTMLInputElement) => node.files?.length)).toBe(1);
  expect(calls.filter(call => call.method === "PATCH")).toHaveLength(0);
  await save.click();
  await expect(page.getByText("Certificado salvo. A emissão oficial continua pendente.", { exact: true })).toBeVisible();
  expect(calls.find(call => call.method === "PATCH")!.body.version).toBe(2);
});

test("CERT-UI06 perfil alterado exige recarregar os dados e limpa material, sem reenviar para outro CNPJ", async ({ page }) => {
  await api(page);
  let conflict = false, writes = 0;
  const headers = { "access-control-allow-origin": "http://127.0.0.1:3000", "access-control-allow-credentials": "true" };
  await page.route("**/fiscal/**", async route => {
    if (route.request().method() === "PATCH" && route.request().url().endsWith("/certificate")) {
      writes++;
      conflict = true;
      return route.fulfill({ status: 409, headers, json: { error: { code: "A1_PROFILE_CONFLICT" } } });
    }
    if (conflict && route.request().url().endsWith("/profile")) return route.fulfill({ headers, json: { profile: { version: 2, fields: { cnpj: "11444777000161" }, missingFields: ["regime"], unsupportedFields: [], preparationReady: false } } });
    return route.fallback();
  });
  await page.goto("/fiscal/configuracao/");
  const file = page.getByLabel("Arquivo do certificado A1", { exact: true }), password = page.getByLabel("Senha do certificado", { exact: true });
  await file.setInputFiles({ name: "generic.pfx", mimeType: "application/x-pkcs12", buffer: Buffer.from("GENERIC") });
  await password.fill("generic-secret");
  await page.getByRole("button", { name: "Salvar certificado", exact: true }).click();
  await page.getByRole("button", { name: "Recarregar configuração fiscal", exact: true }).click();
  await expect(page.getByLabel("CNPJ do prestador", { exact: true })).toHaveValue("11444777000161");
  await expect(password).toHaveValue("");
  expect(await file.evaluate((node: HTMLInputElement) => node.files?.length)).toBe(0);
  expect(writes).toBe(1);
});

test("CERT-UI07 leitura de arquivo atrasada é descartada ao sair da empresa antes do PATCH", async ({ page }) => {
  await page.addInitScript(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      const state = window as unknown as { a1Reading: boolean; releaseA1Read: () => void };
      state.a1Reading = true;
      return new Promise<ArrayBuffer>((resolve, reject) => { state.releaseA1Read = () => { void original.call(this).then(resolve, reject); }; });
    };
  });
  const calls = await api(page);
  await page.goto("/fiscal/configuracao/");
  await page.getByLabel("Arquivo do certificado A1", { exact: true }).setInputFiles({ name: "generic.pfx", mimeType: "application/x-pkcs12", buffer: Buffer.from("GENERIC") });
  await page.getByLabel("Senha do certificado", { exact: true }).fill("generic-secret");
  await page.getByRole("button", { name: "Salvar certificado", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { a1Reading: boolean }).a1Reading)).toBe(true);
  await page.getByLabel("Empresa", { exact: true }).selectOption("");
  await page.evaluate(() => (window as unknown as { releaseA1Read: () => void }).releaseA1Read());
  await expect(page.getByText("Selecione uma empresa para continuar.", { exact: true })).toBeVisible();
  expect(calls.filter(call => call.method === "PATCH")).toHaveLength(0);
});
