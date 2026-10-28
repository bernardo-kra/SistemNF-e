const pages = ["/", "/produtos/", "/estoque/", "/clientes/", "/vendas/", "/ordens/", "/compras/", "/financeiro/", "/acessos/", "/administracao/", "/configuracoes/", "/relatorios/", "/diagnostico/", "/parceiros/", "/fiscal/", "/fiscal/configuracao/", "/fiscal/revisao/"];
export const demoPages = ["/", "/produtos/", "/estoque/", "/clientes/", "/vendas/", "/ordens/", "/financeiro/", "/configuracoes/", "/relatorios/", "/diagnostico/", "/parceiros/", "/importar/", "/fiscal/", "/fiscal/configuracao/", "/fiscal/revisao/"];
export function workspaceReturnPath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  try {
    const url = new URL(value, "https://sistem.invalid");
    if (url.origin !== "https://sistem.invalid") return "/";
    let path = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
    if (path === "/operacao/") path = "/produtos/";
    if (path === "/importar/") path = "/compras/";
    return pages.includes(path) ? `${path}${url.search}${url.hash}` : "/";
  } catch { return "/"; }
}
export function demoHref(href, currentPath) {
  if (!(currentPath === "/demo" || currentPath.startsWith("/demo/")) || !href.startsWith("/") || href.startsWith("//")) return href;
  const path = href.split(/[?#]/)[0];
  const normalized = path.endsWith("/") ? path : `${path}/`;
  return demoPages.includes(normalized) ? `/demo${href}` : href;
}
