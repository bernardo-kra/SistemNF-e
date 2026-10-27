import { financialDate, isCivilDate } from "../finance/engine";

export const MAX_DIAGNOSTIC_EVENTS = 200;
export const DIAGNOSTICS_APP_VERSION = "0.1.0";

export type DiagnosticLevel = "warning" | "error";
export type DiagnosticCode = "COMMAND_FAILED" | "STORAGE_READ_FAILED" | "STORAGE_WRITE_FAILED" | "RUNTIME_ERROR" | "UNHANDLED_REJECTION";
export type DiagnosticModule = "customers" | "products" | "orders" | "finance" | "stock" | "sales" | "imports" | "fiscal" | "settings" | "storage" | "runtime";
export type DiagnosticOperation =
  | "saveCustomer" | "saveProduct" | "setProductPrices" | "saveTechnician" | "saveOrder" | "advanceOrder"
  | "createPaymentAgreement" | "registerInstallmentPayment" | "openCashShift" | "closeCashShift"
  | "receiveStock" | "createSale" | "deliverSale" | "importProducts" | "confirmPurchase"
  | "saveFiscalProfile" | "saveServiceFiscal" | "prepareFiscal" | "fiscalAction" | "processFiscal" | "reset"
  | "storageRead" | "storageWrite" | "runtimeError" | "unhandledRejection";

export interface DiagnosticEvent {
  id: string;
  at: string;
  level: DiagnosticLevel;
  code: DiagnosticCode;
  module: DiagnosticModule;
  operation: DiagnosticOperation;
  route: string;
  installationId: string;
  appVersion: string;
}
export interface DiagnosticFilters {
  from?: string;
  to?: string;
  level?: DiagnosticLevel;
  module?: DiagnosticModule;
  query?: string;
}
export interface DiagnosticRecordInput {
  operation: DiagnosticOperation;
  route?: string;
}
export interface DiagnosticExport {
  version: 1;
  generatedAt: string;
  filters: DiagnosticFilters;
  queryApplied: boolean;
  queryOmitted: boolean;
  events: DiagnosticEvent[];
}
export const moduleLabels: Record<DiagnosticModule, string> = {
  customers: "Clientes", products: "Produtos", orders: "Ordens de serviço", finance: "Financeiro",
  stock: "Estoque", sales: "Vendas", imports: "Importação", fiscal: "Fiscal", settings: "Configurações",
  storage: "Armazenamento local", runtime: "Aplicação",
};
export const operationLabels: Record<DiagnosticOperation, string> = {
  saveCustomer: "Salvar cliente", saveProduct: "Salvar produto", setProductPrices: "Definir preços em lote", saveTechnician: "Cadastrar técnico", saveOrder: "Salvar OS", advanceOrder: "Avançar OS",
  createPaymentAgreement: "Criar acordo", registerInstallmentPayment: "Receber parcela", openCashShift: "Abrir caixa", closeCashShift: "Fechar caixa",
  receiveStock: "Registrar entrada", createSale: "Criar venda", deliverSale: "Entregar venda", importProducts: "Importar produtos", confirmPurchase: "Confirmar compra local",
  saveFiscalProfile: "Salvar emitente", saveServiceFiscal: "Salvar serviço fiscal", prepareFiscal: "Preparar documento", fiscalAction: "Alterar documento",
  processFiscal: "Processar simulação fiscal", reset: "Restaurar exemplos", storageRead: "Recuperar dados", storageWrite: "Gravar dados",
  runtimeError: "Erro da aplicação", unhandledRejection: "Rejeição não tratada",
};
export const diagnosticCatalog: Record<DiagnosticCode, { title: string; description: string }> = {
  COMMAND_FAILED: { title: "Operação não concluída", description: "O comando foi rejeitado. Confira a mensagem operacional e use o código da ocorrência para suporte." },
  STORAGE_READ_FAILED: { title: "Falha ao recuperar dados", description: "O arquivo operacional não pôde ser recuperado. Preserve o original antes de restaurar os exemplos." },
  STORAGE_WRITE_FAILED: { title: "Falha ao gravar dados", description: "Os dados operacionais não puderam ser gravados neste navegador." },
  RUNTIME_ERROR: { title: "Erro da aplicação", description: "A aplicação informou um erro durante a execução." },
  UNHANDLED_REJECTION: { title: "Rejeição não tratada", description: "Uma operação assíncrona terminou sem tratamento na aplicação." },
};
type OperationMetadata = { module: DiagnosticModule; code: DiagnosticCode; level: DiagnosticLevel };
const command = (module: DiagnosticModule): OperationMetadata => ({ module, code: "COMMAND_FAILED", level: "warning" });
export const operationCatalog: Record<DiagnosticOperation, OperationMetadata> = {
  saveCustomer: command("customers"), saveProduct: command("products"), setProductPrices: command("products"), saveTechnician: command("orders"), saveOrder: command("orders"), advanceOrder: command("orders"),
  createPaymentAgreement: command("finance"), registerInstallmentPayment: command("finance"), openCashShift: command("finance"), closeCashShift: command("finance"),
  receiveStock: command("stock"), createSale: command("sales"), deliverSale: command("sales"), importProducts: command("imports"), confirmPurchase: command("imports"),
  saveFiscalProfile: command("fiscal"), saveServiceFiscal: command("fiscal"), prepareFiscal: command("fiscal"), fiscalAction: command("fiscal"), processFiscal: command("fiscal"), reset: command("settings"),
  storageRead: { module: "storage", code: "STORAGE_READ_FAILED", level: "error" },
  storageWrite: { module: "storage", code: "STORAGE_WRITE_FAILED", level: "error" },
  runtimeError: { module: "runtime", code: "RUNTIME_ERROR", level: "error" },
  unhandledRejection: { module: "runtime", code: "UNHANDLED_REJECTION", level: "error" },
};
export function isDiagnosticOperation(value: unknown): value is DiagnosticOperation {
  return typeof value === "string" && Object.hasOwn(operationCatalog, value);
}

export function isDiagnosticId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function diagnosticTimestamp(value: unknown): string {
  if (typeof value !== "string") throw new Error("Informe um instante ISO válido.");
  // financialDate validates the civil date, time and explicit time zone.
  financialDate(value);
  return new Date(value).toISOString();
}

const routes = new Set([
  "/", "/entrar/", "/vendas/", "/ordens/", "/clientes/", "/produtos/", "/estoque/",
  "/parceiros/", "/importar/", "/financeiro/", "/fiscal/", "/fiscal/revisao/", "/fiscal/configuracao/",
  "/configuracoes/", "/diagnostico/", "/relatorios/",
]);

export function diagnosticRoute(value: unknown): string {
  if (typeof value !== "string") return "/";
  const path = value.split(/[?#]/, 1)[0].replace(/^\/demo(?=\/|$)/, "") || "/";
  const canonical = path.endsWith("/") ? path : `${path}/`;
  return routes.has(canonical) ? canonical : "/";
}

/** Project untrusted persisted/exported values; never spread the input. */
export function projectDiagnosticEvent(value: unknown): DiagnosticEvent | null {
  try {
    if (!value || typeof value !== "object") return null;
    const item = value as Record<string, unknown>;
    if (!isDiagnosticId(item.id) || !isDiagnosticId(item.installationId) || !isDiagnosticOperation(item.operation)) return null;
    const metadata = operationCatalog[item.operation];
    if (item.code !== metadata.code || item.level !== metadata.level || item.module !== metadata.module ||
      typeof item.appVersion !== "string" || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(item.appVersion)) return null;
    return {
      id: item.id.toLowerCase(), at: diagnosticTimestamp(item.at), level: metadata.level,
      code: metadata.code, module: metadata.module, operation: item.operation,
      route: diagnosticRoute(item.route), installationId: item.installationId.toLowerCase(), appVersion: item.appVersion,
    };
  } catch { return null; }
}

function normalizedFilters(filters: DiagnosticFilters): DiagnosticFilters {
  const result: DiagnosticFilters = {};
  if (filters.from) {
    if (!isCivilDate(filters.from)) throw new Error("Data inicial inválida.");
    result.from = filters.from;
  }
  if (filters.to) {
    if (!isCivilDate(filters.to)) throw new Error("Data final inválida.");
    result.to = filters.to;
  }
  if (result.from && result.to && result.from > result.to) throw new Error("A data inicial deve ser anterior ou igual à final.");
  if (filters.level) {
    if (filters.level !== "warning" && filters.level !== "error") throw new Error("Nível de diagnóstico inválido.");
    result.level = filters.level;
  }
  if (filters.module) {
    if (!Object.hasOwn(moduleLabels, filters.module)) throw new Error("Módulo de diagnóstico inválido.");
    result.module = filters.module;
  }
  if (typeof filters.query === "string" && filters.query.trim()) result.query = filters.query.trim();
  return result;
}

export function filterDiagnostics(events: readonly unknown[], filters: DiagnosticFilters): DiagnosticEvent[] {
  const applied = normalizedFilters(filters);
  const query = applied.query?.toLowerCase();
  return events.flatMap((value) => {
    const event = projectDiagnosticEvent(value);
    if (!event) return [];
    const date = financialDate(event.at);
    if ((applied.from && date < applied.from) || (applied.to && date > applied.to) ||
      (applied.level && event.level !== applied.level) || (applied.module && event.module !== applied.module) ||
      (query && !event.id.toLowerCase().includes(query) && !event.code.toLowerCase().includes(query))) return [];
    return [event];
  });
}

export function exportDiagnostics(events: readonly unknown[], filters: DiagnosticFilters, generatedAt: string): DiagnosticExport {
  const applied = normalizedFilters(filters);
  const selected = filterDiagnostics(events, applied);
  const queryApplied = Boolean(applied.query);
  const safeQuery = applied.query && (Object.hasOwn(diagnosticCatalog, applied.query) || isDiagnosticId(applied.query));
  // A search field can contain a consumer's details. It is never copied unless controlled.
  const exported: DiagnosticFilters = {};
  if (applied.from) exported.from = applied.from;
  if (applied.to) exported.to = applied.to;
  if (applied.level) exported.level = applied.level;
  if (applied.module) exported.module = applied.module;
  if (safeQuery) exported.query = applied.query;
  return { version: 1, generatedAt: diagnosticTimestamp(generatedAt), filters: exported,
    queryApplied, queryOmitted: queryApplied && !safeQuery, events: selected };
}

export function instrumentOperation<T>(operation: DiagnosticOperation, run: () => T, record: (operation: DiagnosticOperation) => unknown): T {
  const rejected = () => {
    try {
      const recorded = record(operation);
      if (recorded instanceof Promise) void recorded.catch(() => {});
    } catch { /* Diagnostics cannot replace the command's result. */ }
  };
  let result: T;
  try { result = run(); } catch (error) { rejected(); throw error; }
  if (result !== null && (typeof result === "object" || typeof result === "function")) {
    let then: unknown;
    try { then = (result as { then?: unknown }).then; } catch { return result; }
    if (typeof then === "function") return Promise.resolve(result).catch((error: unknown) => { rejected(); throw error; }) as T;
  }
  return result;
}
