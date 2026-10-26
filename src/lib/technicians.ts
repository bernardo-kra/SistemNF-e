import type { DemoState, ServiceOrder, Technician } from "./domain";

export const technicianNameKey = (name: string) => name.trim().replace(/\s+/g, " ")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
const unassigned = technicianNameKey("Não atribuído");

export function restoreTechnicians(value: unknown, orders: Pick<ServiceOrder, "technician">[]): Technician[] {
  if (value !== undefined && !Array.isArray(value)) throw new Error("Cadastro local de técnicos inválido.");
  const ids = new Set<string>();
  const names = new Set<string>();
  const result: Technician[] = [];
  for (const item of (value ?? []) as unknown[]) {
    if (!item || typeof item !== "object") throw new Error("Cadastro local de técnicos inválido.");
    const entry = item as Record<string, unknown>;
    if (typeof entry.id !== "string" || !entry.id.trim() || entry.id.length > 200 ||
      typeof entry.name !== "string" || !entry.name.trim()) {
      throw new Error("Cadastro local de técnicos inválido.");
    }
    const key = technicianNameKey(entry.name);
    if (key === unassigned || ids.has(entry.id) || names.has(key)) throw new Error("Cadastro local de técnicos duplicado ou inválido.");
    ids.add(entry.id); names.add(key);
    result.push({ id: entry.id, name: entry.name });
  }
  for (const order of orders) {
    const name = order.technician.trim();
    const key = technicianNameKey(name);
    if (!key || key === unassigned || names.has(key)) continue;
    let id = `legacy-technician-${result.length + 1}`;
    while (ids.has(id)) id += "-legacy";
    result.push({ id, name }); ids.add(id); names.add(key);
  }
  return result;
}

export function techniciansForState(state: Pick<DemoState, "technicians" | "orders">): Technician[] {
  return restoreTechnicians(state.technicians, state.orders);
}
