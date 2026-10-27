export function resolveApiOrigin(configured, pageUrl) {
  const page = new URL(pageUrl);
  const isLoopback = (url) => ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (!configured && isLoopback(page)) return "http://127.0.0.1:4000";
  const url = new URL(configured ?? page.origin);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      !(url.protocol === "https:" || (isLoopback(page) && isLoopback(url) && url.protocol === "http:"))) {
    throw new Error("Origem da API inválida.");
  }
  return url.origin;
}
