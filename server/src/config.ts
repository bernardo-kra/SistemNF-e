export type ApiConfig = {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  baseUrl: string;
  frontendOrigin: string;
  authSecret: string;
  controlDatabaseUrl: string;
  tenantDatabaseUrls: Record<string, string>;
};

export function readConfig(env: NodeJS.ProcessEnv): ApiConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  if (!["development", "test", "production"].includes(nodeEnv)) throw new Error("Ambiente da API inválido.");
  const required = (key: string) => {
    const value = env[key];
    if (!value || !value.trim()) throw new Error(`Configuração obrigatória ausente: ${key}.`);
    return value;
  };
  const origin = (key: string) => {
    try {
      const url = new URL(required(key));
      const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
          url.pathname !== "/" || url.search || url.hash || url.hostname.includes("*") ||
          (url.protocol !== "https:" && (nodeEnv === "production" || !loopback))) throw new Error();
      return url.origin;
    } catch { throw new Error(`Origem explícita inválida: ${key}.`); }
  };
  const databaseUrl = (value: unknown) => {
    try {
      if (typeof value !== "string") throw new Error();
      const url = new URL(value);
      if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || url.pathname.length < 2 || url.hash)
        throw new Error();
      return value;
    } catch { throw new Error("URL PostgreSQL inválida na configuração interna."); }
  };
  const portText = env.API_PORT ?? "4000";
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Porta da API inválida.");
  const host = env.API_HOST ?? "127.0.0.1";
  if (!host.trim() || /[\s/\\?#@]/.test(host)) throw new Error("Endereço de escuta da API inválido.");
  const authSecret = required("BETTER_AUTH_SECRET");
  if (authSecret.length < 32) throw new Error("O segredo de autenticação precisa ter pelo menos 32 caracteres.");
  const controlDatabaseUrl = databaseUrl(required("CONTROL_DATABASE_URL"));
  let input: unknown;
  try { input = JSON.parse(required("TENANT_DATABASE_URLS")); }
  catch { throw new Error("Mapa interno de bancos inválido."); }
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Mapa interno de bancos inválido.");
  const entries = Object.entries(input);
  if (!entries.length || entries.length > 16) throw new Error("Configure entre um e 16 bancos operacionais.");
  const tenantDatabaseUrls: Record<string, string> = Object.create(null);
  for (const [key, value] of entries) {
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(key)) throw new Error("Chave interna de banco inválida.");
    tenantDatabaseUrls[key] = databaseUrl(value);
  }
  return { nodeEnv: nodeEnv as ApiConfig["nodeEnv"], host, port, baseUrl: origin("API_BASE_URL"),
    frontendOrigin: origin("FRONTEND_ORIGIN"), authSecret, controlDatabaseUrl, tenantDatabaseUrls };
}
