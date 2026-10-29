import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

// BR-UI: expectativas pelo contrato antes da implementação; imagens genéricas em memória.
const tenant = "10000000-0000-4000-8000-000000000001";
const second = "20000000-0000-4000-8000-000000000002";
const orderId = "10000000-0000-4000-8000-000000000020";
const empty = { version: 0, backgroundOpacity: 10, logo: null, background: null, updatedAt: null, updatedBy: null };
const asset = { mimeType: "image/webp", width: 40, height: 20 };
const configured = { ...empty, version: 1, logo: asset, background: asset, updatedAt: "2026-10-28T12:00:00Z", updatedBy: "manager" };
const order = { id: orderId, number: 7, version: 1, customerName: "Cliente fictício QA", customerPhone: "11900000000", equipment: "Aparelho QA", issue: "Troca de tela", diagnosis: "Diagnóstico QA", technicianName: "Técnico QA", due: "2026-11-01", laborCents: 12000, approved: false, tested: false, stage: "received", createdAt: "2026-10-28T12:00:00Z", updatedAt: "2026-10-28T12:00:00Z" };
type ApiOptions = { manager?: boolean; loaded?: boolean; failLoad?: boolean; failSave?: boolean; conflictSave?: boolean; noopSave?: boolean; delayAsset?: Promise<void>; failAsset?: boolean; twoCompanies?: boolean };
async function api(page: Page, options: ApiOptions = {}) {
  const png = await sharp({ create: { width: 40, height: 20, channels: 4, background: { r: 30, g: 110, b: 160, alpha: 0.8 } } }).png().toBuffer();
  const webp = await sharp(png).webp().toBuffer();
  const writes: any[] = [], reads: string[] = [];
  let branding: any = options.loaded ? configured : empty, saves = 0;
  await page.route("http://127.0.0.1:4000/**", async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const headers = { "access-control-allow-origin": "http://127.0.0.1:3000", "access-control-allow-credentials": "true", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,PATCH,POST,OPTIONS" };
    if (request.method() === "OPTIONS") { await route.fulfill({ status: 204, headers }); return; }
    let status = 200, body: any = { tenantId: tenant, items: [], total: 0, limit: 25, offset: 0 };
    if (request.method() !== "GET") writes.push({ path, body: request.postDataJSON() }); else reads.push(path);
    if (path.endsWith("/me")) body = { user: { id: "manager", name: "Gestor QA", email: "branding@example.test" }, tenants: [{ id: tenant, name: "Loja visual QA", role: options.manager === false ? "viewer" : "owner", permissions: ["customers.read", "orders.read", ...(options.manager === false ? [] : ["team.manage", "team.read"])] }, ...(options.twoCompanies ? [{ id: second, name: "Outra loja QA", role: "owner", permissions: ["customers.read", "orders.read", "team.manage"] }] : [])] };
    else if (path.endsWith("/branding") && request.method() === "PATCH") {
      saves++;
      if (options.conflictSave || (options.failSave && saves === 1)) { status = options.conflictSave ? 409 : 503; body = { error: { code: options.conflictSave ? "VERSION_CONFLICT" : "SERVICE_UNAVAILABLE" } }; }
      else if (options.noopSave) body = { tenantId: tenant, branding };
      else { const data = request.postDataJSON(); branding = { ...branding, version: branding.version + 1, backgroundOpacity: data.backgroundOpacity ?? branding.backgroundOpacity, logo: data.logo === null ? null : data.logo ? asset : branding.logo, background: data.background === null ? null : data.background ? asset : branding.background, updatedAt: "2026-10-28T13:00:00Z", updatedBy: "manager" }; body = { tenantId: tenant, branding }; }
    } else if (path.endsWith("/branding")) { if (options.failLoad) { status = 503; body = { error: { code: "SERVICE_UNAVAILABLE" } }; } else body = { tenantId: path.includes(second) ? second : tenant, branding: path.includes(second) ? empty : branding }; }
    else if (path.includes("/branding/assets/")) {
      if (options.delayAsset) await options.delayAsset;
      await route.fulfill({ status: options.failAsset ? 503 : 200, headers: { ...headers, "content-type": "image/webp" }, body: options.failAsset ? "" : webp }).catch(() => {}); return;
    } else if (path.endsWith("/receipt")) body = { tenantId: tenant, companyName: "Loja visual QA", generatedAt: "2026-10-28T13:00:00Z", order, branding };
    else if (path.endsWith("/orders")) body = { ...body, items: [order], total: 1 };
    await route.fulfill({ status, headers, json: body }).catch(() => {});
  });
  return { writes, reads, png };
}

test("BR-UI01 configuração oferece logo, fundo e prévia; só uma gravação confirma o conjunto", async ({ page }) => {
  const state = await api(page); await page.goto("/configuracoes/");
  await page.getByLabel("Logotipo da loja", { exact: true }).setInputFiles({ name: "logo-qa.png", mimeType: "image/png", buffer: state.png });
  await page.getByLabel("Imagem de fundo da OS", { exact: true }).setInputFiles({ name: "fundo-qa.png", mimeType: "image/png", buffer: state.png });
  await page.getByLabel("Intensidade do fundo (%)", { exact: true }).fill("12");
  const preview = page.getByRole("region", { name: "Prévia da ordem de serviço", exact: true }); await expect(preview.getByRole("img", { name: "Logotipo da loja", exact: true })).toBeVisible();
  expect(state.writes).toHaveLength(0); await page.getByRole("button", { name: "Salvar personalização", exact: true }).click();
  await expect(page.getByText("Personalização salva.", { exact: true })).toBeVisible(); expect(state.writes).toHaveLength(1);
  expect(state.writes[0].body).toMatchObject({ version: 0, backgroundOpacity: 12 }); expect(state.writes[0].body.logo).toMatch(/^data:image\/png;base64,/); expect(state.writes[0].body.background).toMatch(/^data:image\/png;base64,/);
});
test("BR-UI02 falha mantém prévia e retoma a mesma tentativa; remover só confirma ao salvar", async ({ page }) => {
  const state = await api(page, { loaded: true, failSave: true }); await page.goto("/configuracoes/");
  await page.getByRole("button", { name: "Remover fundo", exact: true }).click(); expect(state.writes).toHaveLength(0);
  await page.getByRole("button", { name: "Salvar personalização", exact: true }).click(); await expect(page.getByRole("alert").filter({ hasText: /Não foi possível/ })).toBeVisible();
  await page.getByRole("button", { name: "Salvar personalização", exact: true }).click(); await expect(page.getByText("Personalização salva.", { exact: true })).toBeVisible();
  expect(state.writes).toHaveLength(2); expect(state.writes[0].body.requestId).toBe(state.writes[1].body.requestId); expect(state.writes[1].body.background).toBeNull();
});
test("BR-UI03 funcionário consulta a marca sem campos de administração e carga falha não libera salvamento", async ({ page }) => {
  const state = await api(page, { manager: false, loaded: true }); await page.goto("/configuracoes/"); await expect(page.getByText("Personalização da loja", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Logotipo da loja", { exact: true })).toHaveCount(0); await expect(page.getByRole("button", { name: "Salvar personalização", exact: true })).toHaveCount(0); expect(state.writes).toHaveLength(0);
});
test("BR-UI04 falha inicial e arquivo inválido não viram configuração vazia gravável", async ({ page }) => {
  const state = await api(page, { failLoad: true }); await page.goto("/configuracoes/"); await expect(page.getByText("Não foi possível carregar a personalização.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Salvar personalização", exact: true })).toHaveCount(0); expect(state.writes).toHaveLength(0);
});
test("BR-UI05 SVG e arquivo grande são recusados sem upload", async ({ page }) => {
  const state = await api(page); await page.goto("/configuracoes/");
  await page.getByLabel("Logotipo da loja", { exact: true }).setInputFiles({ name: "nao-aceito.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') });
  await expect(page.getByRole("alert").filter({ hasText: /Envie uma imagem PNG, JPG ou WebP/ })).toBeVisible();
  await page.getByLabel("Imagem de fundo da OS", { exact: true }).setInputFiles({ name: "grande.png", mimeType: "image/png", buffer: Buffer.alloc(1024 * 1024 + 1) });
  await expect(page.getByRole("alert").filter({ hasText: /até 1 MB/ })).toBeVisible(); expect(state.writes).toHaveLength(0);
});
test("BR-UI06 comprovante espera imagens e imprime instantâneo sem pagamento nem gravação", async ({ page }) => {
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  const state = await api(page, { loaded: true, delayAsset: gate }); await page.addInitScript(() => { (window as any).__printed = 0; window.print = () => { (window as any).__printed++; }; });
  await page.goto("/ordens/"); await page.getByRole("button", { name: "Imprimir comprovante da OS 7", exact: true }).click(); const dialog = page.getByRole("dialog", { name: "Comprovante da OS", exact: true });
  try { await expect(dialog).toBeVisible(); await expect(dialog.getByRole("button", { name: "Imprimir comprovante", exact: true })).toBeDisabled(); } finally { release(); }
  await expect(dialog.getByRole("button", { name: "Imprimir comprovante", exact: true })).toBeEnabled(); await expect(dialog).toContainText("Cliente fictício QA"); await expect(dialog).toContainText("Não é documento fiscal");
  await expect(dialog).toContainText("Comprovante gerado em");
  await dialog.getByRole("button", { name: "Imprimir comprovante", exact: true }).click(); expect(await page.evaluate(() => (window as any).__printed)).toBe(1); expect(state.writes).toHaveLength(0);
});
test("BR-UI07 falha de imagem impede impressão e permite nova tentativa", async ({ page }) => {
  const state = await api(page, { loaded: true, failAsset: true }); await page.goto("/ordens/"); await page.getByRole("button", { name: "Imprimir comprovante da OS 7", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Comprovante da OS", exact: true }); await expect(dialog.getByText("Não foi possível carregar as imagens do comprovante.", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Imprimir comprovante", exact: true })).toBeDisabled(); await expect(dialog.getByRole("button", { name: "Tentar novamente", exact: true })).toBeVisible(); expect(state.writes).toHaveLength(0);
});
test("BR-UI08 320px mantém seleção de imagem, intensidade e prévia dentro da tela", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 850 }); const state = await api(page); await page.goto("/configuracoes/");
  const input = page.getByLabel("Logotipo da loja", { exact: true }); await input.setInputFiles({ name: "logo-qa.png", mimeType: "image/png", buffer: state.png });
  const bounds = await input.boundingBox(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  await expect(page.getByRole("region", { name: "Prévia da ordem de serviço", exact: true })).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test("BR-UI09 OS sem personalização imprime sem imagem e sem criar configuração", async ({ page }) => {
  const state = await api(page); await page.goto("/ordens/"); await page.getByRole("button", { name: "Imprimir comprovante da OS 7", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Comprovante da OS", exact: true }); await expect(dialog.getByRole("button", { name: "Imprimir comprovante", exact: true })).toBeEnabled();
  await expect(dialog.getByRole("region", { name: "Comprovante da ordem de serviço", exact: true })).toContainText("Loja visual QA"); expect(state.reads.some((path) => path.includes("/branding/assets/"))).toBe(false); expect(state.writes).toHaveLength(0);
});
test("BR-UI10 trocar empresa descarta imagens não salvas e prévia da empresa anterior", async ({ page }) => {
  const state = await api(page, { twoCompanies: true }); await page.goto("/configuracoes/"); await page.getByLabel("Empresa", { exact: true }).selectOption(tenant);
  await page.getByLabel("Logotipo da loja", { exact: true }).setInputFiles({ name: "rascunho-qa.png", mimeType: "image/png", buffer: state.png });
  let preview = page.getByRole("region", { name: "Prévia da ordem de serviço", exact: true }); await expect(preview.getByRole("img", { name: "Logotipo da loja", exact: true })).toBeVisible();
  await page.getByLabel("Empresa", { exact: true }).selectOption(second); preview = page.getByRole("region", { name: "Prévia da ordem de serviço", exact: true });
  await expect(preview).toContainText("Outra loja QA"); await expect(preview.getByRole("img", { name: "Logotipo da loja", exact: true })).toHaveCount(0); expect(state.writes).toHaveLength(0);
});
test("BR-UI11 conflito preserva prévia e exige recarga explícita antes de sobrescrever", async ({ page }) => {
  const state = await api(page, { conflictSave: true }); await page.goto("/configuracoes/"); await page.getByLabel("Logotipo da loja", { exact: true }).setInputFiles({ name: "logo-qa.png", mimeType: "image/png", buffer: state.png });
  const preview = page.getByRole("region", { name: "Prévia da ordem de serviço", exact: true }); await expect(preview.getByRole("img", { name: "Logotipo da loja", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Salvar personalização", exact: true }).click(); await expect(page.getByRole("button", { name: "Recarregar personalização", exact: true })).toBeVisible();
  await expect(preview.getByRole("img", { name: "Logotipo da loja", exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: "Salvar personalização", exact: true })).toBeDisabled(); expect(state.writes).toHaveLength(1);
});
test("BR-UI12 remover imagem limpa também a seleção do arquivo sem gravar", async ({ page }) => {
  const state = await api(page); await page.goto("/configuracoes/"); const upload = page.getByLabel("Logotipo da loja", { exact: true });
  await upload.setInputFiles({ name: "logo-qa.png", mimeType: "image/png", buffer: state.png }); await expect(page.getByRole("region", { name: "Prévia da ordem de serviço", exact: true }).getByRole("img", { name: "Logotipo da loja", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remover logotipo", exact: true }).click(); await expect(upload).toHaveValue(""); expect(state.writes).toHaveLength(0);
});
test("BR-UI13 confirmação sem mudança de versão limpa arquivo e encerra alterações pendentes", async ({ page }) => {
  const state = await api(page, { loaded: true, noopSave: true }); await page.goto("/configuracoes/");
  const upload = page.getByLabel("Logotipo da loja", { exact: true }), save = page.getByRole("button", { name: "Salvar personalização", exact: true });
  await upload.setInputFiles({ name: "logo-igual-qa.png", mimeType: "image/png", buffer: state.png }); await expect(save).toBeEnabled();
  await save.click(); await expect(page.getByText("Personalização salva.", { exact: true })).toBeVisible();
  await expect.soft(upload).toHaveValue(""); await expect.soft(save).toBeDisabled(); expect(state.writes).toHaveLength(1); expect(state.writes[0].body.version).toBe(1);
});
