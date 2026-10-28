/** Keep already configured company databases when reapplying the primary preparation. */
export function preserveOperationalMappings(previous: string | undefined, main: string): Record<string,string> {
  let existing: unknown = {};
  if (previous !== undefined) {
    try { existing = JSON.parse(previous); }
    catch { throw new Error("Mapa operacional anterior inválido; configuração preservada."); }
  }
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) throw new Error("Mapa operacional anterior inválido.");
  const entries = Object.entries(existing);
  if (entries.length > 16 || (Object.hasOwn(existing, "main") && (existing as Record<string,unknown>).main !== main)) throw new Error("Configuração anterior pertence a outro banco ou excede o limite.");
  const result = { ...existing, main } as Record<string,string>;
  if (Object.keys(result).length > 16) throw new Error("Limite de bancos operacionais excedido.");
  for (const [key,value] of Object.entries(result)) {
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(key) || typeof value !== "string" || /['\r\n]/.test(value)) throw new Error("Mapa operacional anterior inválido ou incompatível com o arquivo privado.");
    let url: URL;
    try { url = new URL(value); } catch { throw new Error("Conexão operacional anterior inválida."); }
    if (!["postgres:","postgresql:"].includes(url.protocol) || !url.hostname || url.pathname.length < 2 || url.hash) throw new Error("Conexão operacional anterior inválida.");
  }
  return result;
}
