import { expect, test } from "@playwright/test";
import {
  exportDiagnostics, filterDiagnostics, instrumentOperation, diagnosticRoute,
  type DiagnosticEvent,
} from "../src/lib/diagnostics/engine";
import { createDiagnosticRecorder, DIAGNOSTICS_KEY, MAX_DIAGNOSTIC_EVENTS } from "../src/lib/diagnostics/store";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// A mesma expectativa foi executada em Node antes da correção do prefixo (RED).
test("LOG-UNI demonstração preserva módulo do diagnóstico sem copiar parâmetros privados", () => {
  expect(diagnosticRoute("/demo/estoque/?token=fixture")).toBe("/estoque/");
  expect(diagnosticRoute("/demo/produtos/")).toBe("/produtos/");
});
const installationId = uuid(1);
const at = "2026-10-17T01:30:00.000Z";
const event = (n: number, overrides: Partial<DiagnosticEvent> = {}): DiagnosticEvent => ({
  id: uuid(n), at, level: "warning", code: "COMMAND_FAILED", module: "finance",
  operation: "registerInstallmentPayment", route: "/financeiro/", installationId, appVersion: "0.1.0",
  ...overrides,
});
const sensitive = "SEGREDO-CPF-12345678900-consumidor@example.com";
function memoryStorage(initial: string | null = null) {
  const values = new Map(initial === null ? [] : [[DIAGNOSTICS_KEY, initial]]);
  return { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, values };
}
function options() {
  let nextId = 1, nextSecond = 0;
  return { id: () => uuid(nextId++), now: () => new Date(Date.parse(at) + nextSecond++ * 1000).toISOString() };
}
const allowedKeys = ["appVersion", "at", "code", "id", "installationId", "level", "module", "operation", "route"].sort();

test("LOG-01/05: uma execução síncrona preserva retorno e erro original, mesmo se o logger falhar", () => {
  const original = new Error(sensitive);
  const calls: string[] = [];
  let attempts = 0;
  const result = { ok: true };
  expect(instrumentOperation("saveCustomer", () => { attempts++; return result; }, () => { throw new Error("logger"); })).toBe(result);
  let observed: unknown;
  try {
    instrumentOperation("saveCustomer", () => { attempts++; throw original; }, (operation) => {
      calls.push(operation); throw new Error("logger indisponível");
    });
  } catch (error) { observed = error; }
  expect(observed).toBe(original);
  expect(attempts).toBe(2);
  expect(calls).toEqual(["saveCustomer"]);
});

test("LOG-07: rejeição assíncrona gera uma ocorrência sem substituir erro nem repetir comando", async () => {
  const original = new Error(sensitive);
  let attempts = 0, occurrences = 0;
  const run = async () => { attempts++; throw original; };
  await expect(instrumentOperation("processFiscal", run, () => { occurrences++; })).rejects.toBe(original);
  expect(attempts).toBe(1);
  expect(occurrences).toBe(1);
  const object = { result: "ok" };
  await expect(instrumentOperation("processFiscal", async () => object, () => { occurrences++; })).resolves.toBe(object);
  expect(occurrences).toBe(1);
});

test("LOG-02: registro usa catálogo e descarta entrada, erro, stack e parâmetros de URL", () => {
  const storage = memoryStorage();
  const recorder = createDiagnosticRecorder(storage, options());
  const recorded = recorder.record({ operation: "saveCustomer", route: `/clientes/?token=${sensitive}#segredo`,
    error: new Error(sensitive), customer: { name: sensitive }, message: sensitive, stack: sensitive,
  } as Parameters<typeof recorder.record>[0]);
  expect(recorded).toMatchObject({ code: "COMMAND_FAILED", module: "customers", operation: "saveCustomer", route: "/clientes/", installationId });
  expect(Object.keys(recorded!).sort()).toEqual(allowedKeys);
  const persisted = storage.values.get(DIAGNOSTICS_KEY)!;
  expect(persisted).not.toContain(sensitive);
  expect(persisted).not.toContain("stack");
  expect(persisted).not.toContain("token=");
  expect(recorder.record({ operation: "__proto__" } as unknown as Parameters<typeof recorder.record>[0])).toBeNull();
  expect(recorder.record({ operation: "toString" } as unknown as Parameters<typeof recorder.record>[0])).toBeNull();
  expect(recorder.getSnapshot().events).toHaveLength(1);
});

test("LOG-02/04: recuperar e exportar armazenamento adulterado reprojeta a lista permitida", () => {
  const injected = { ...event(2), route: `/financeiro/?cpf=${sensitive}`,
    rawError: { message: sensitive }, customerName: sensitive, operationalState: { secret: sensitive } };
  const storage = memoryStorage(JSON.stringify({ version: 1, installationId, events: [
    injected, { ...event(3), module: sensitive }, { ...event(4), id: sensitive },
  ], backup: sensitive }));
  const recorder = createDiagnosticRecorder(storage, options());
  const snapshot = recorder.getSnapshot();
  expect(snapshot.events).toHaveLength(1);
  expect(Object.keys(snapshot.events[0]).sort()).toEqual(allowedKeys);
  expect(snapshot.events[0].route).toBe("/financeiro/");
  const exported = exportDiagnostics([injected] as DiagnosticEvent[], {}, at);
  expect(exported.events).toHaveLength(1);
  expect(Object.keys(exported.events[0]).sort()).toEqual(allowedKeys);
  expect(JSON.stringify(exported)).not.toContain(sensitive);
  expect(JSON.stringify(snapshot)).not.toContain(sensitive);
});

test("LOG-02/04: restauração mantém só eventos da instalação declarada no pacote local", () => {
  const own = event(2), foreign = event(3, { installationId: uuid(99) });
  const recorder = createDiagnosticRecorder(memoryStorage(JSON.stringify({
    version: 1, installationId, events: [own, foreign],
  })), options());
  expect(recorder.getSnapshot().installationId).toBe(installationId);
  expect(recorder.getSnapshot().events).toEqual([own]);
});

test("LOG-03: limites inclusivos de São Paulo e filtros combinados equivalem ao JSON exportado", () => {
  const events = [
    event(2, { at: "2026-10-16T02:59:59.999Z" }),
    event(3, { at: "2026-10-16T03:00:00.000Z" }),
    event(4, { at: "2026-10-17T02:59:59.999Z" }),
    event(5, { at: "2026-10-17T03:00:00.000Z" }),
    event(6, { module: "sales", operation: "createSale" }),
    event(7, { level: "error" }),
  ];
  const filters = { from: "2026-10-16", to: "2026-10-16", level: "warning" as const, module: "finance" as const, query: "COMMAND_FAILED" };
  const filtered = filterDiagnostics(events, filters);
  expect(filtered.map((item) => item.id)).toEqual([uuid(3), uuid(4)]);
  expect(exportDiagnostics(events, filters, at).events).toEqual(filtered);
  expect(filterDiagnostics(events, { ...filters, query: uuid(4) }).map((item) => item.id)).toEqual([uuid(4)]);
  for (const invalid of [{ from: "2026-02-30" }, { from: "2026-10-17", to: "2026-10-16" }])
    expect(() => filterDiagnostics(events, invalid)).toThrow();
});

test("LOG-02/03: consulta livre não vaza nos metadados, sem alterar o subconjunto exportado", () => {
  const events = [event(2), event(3, { operation: "createSale", module: "sales" })];
  const privateQuery = "consumidor@example.com";
  const exported = exportDiagnostics(events, { query: privateQuery }, at);
  expect(exported.events).toEqual([]);
  expect(exported).toMatchObject({ queryApplied: true, queryOmitted: true });
  expect(JSON.stringify(exported)).not.toContain(privateQuery);
  const partial = exportDiagnostics(events, { query: "COMMAND" }, at);
  expect(partial.events).toHaveLength(2);
  expect(partial).toMatchObject({ queryApplied: true, queryOmitted: true });
  expect(partial.filters).not.toHaveProperty("query");
  expect(exportDiagnostics(events, { query: uuid(2) }, at).filters.query).toBe(uuid(2));
});

test("LOG-04: mantém as 200 ocorrências mais recentes, recarrega e oferece snapshot estável", () => {
  const storage = memoryStorage();
  const recorder = createDiagnosticRecorder(storage, options());
  const snapshot = recorder.getSnapshot();
  expect(recorder.getSnapshot()).toBe(snapshot);
  let changes = 0;
  const unsubscribe = recorder.subscribe(() => { changes++; });
  const all: string[] = [];
  for (let i = 0; i < 205; i++) all.push(recorder.record({ operation: "saveCustomer", route: "/clientes/" })!.id);
  unsubscribe();
  recorder.record({ operation: "saveCustomer", route: "/clientes/" });
  expect(changes).toBe(205);
  expect(MAX_DIAGNOSTIC_EVENTS).toBe(200);
  const current = recorder.getSnapshot();
  expect(current.events).toHaveLength(200);
  expect(current.events.some((item) => all.slice(0, 6).includes(item.id))).toBe(false);
  expect(current.events.some((item) => item.id === all[204])).toBe(true);
  const reload = createDiagnosticRecorder(storage, options()).getSnapshot();
  expect(reload.events).toEqual(current.events);
  expect(reload.installationId).toBe(current.installationId);
});

test("LOG-04/05: JSON inválido e storage negado mantêm buffer em memória sem recursão", () => {
  const invalid = createDiagnosticRecorder(memoryStorage("{ arquivo inválido"), options());
  expect(invalid.getSnapshot().events).toEqual([]);
  expect(invalid.record({ operation: "runtimeError", route: "/" })).not.toBeNull();
  let writes = 0;
  const recorder = createDiagnosticRecorder({
    getItem() { throw new Error(sensitive); },
    setItem() { writes++; throw new Error(sensitive); },
  }, options());
  const original = new Error("erro operacional original");
  let observed: unknown;
  try { instrumentOperation("saveCustomer", () => { throw original; }, (operation) => recorder.record({ operation })); }
  catch (error) { observed = error; }
  expect(observed).toBe(original);
  expect(recorder.getSnapshot().persistence).toBe("memory");
  expect(recorder.getSnapshot().events).toHaveLength(1);
  expect(JSON.stringify(recorder.getSnapshot())).not.toContain(sensitive);
  expect(writes).toBeLessThanOrEqual(2);
});
