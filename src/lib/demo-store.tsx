"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { seed } from "./seed";
import type {
  Customer,
  DemoState,
  Product,
  Sale,
  ServiceOrder,
  Stage,
} from "./domain";
import { TODAY, sumOrder } from "./domain";
import { restoreDemoState } from "./demo-persistence";
import type { Technician } from "./domain";
import { technicianNameKey, techniciansForState } from "./technicians";
import { applyPurchase } from "./purchases/engine";
import type { PurchaseInput } from "./purchases/types";
import { applySaleConfirmation, applySaleDelivery } from "./sales-engine";
import { applyProductPrices, type ProductPriceChange } from "./catalog-pricing";
import {
  instrumentOperation,
  isDiagnosticOperation,
  type DiagnosticOperation,
} from "./diagnostics/engine";
import { getBrowserRecorder } from "./diagnostics/store";
import {
  prepareAgreement,
  recordPayment,
  sourceAgreement,
  openCashShift as openShift,
  closeCashShift as closeShift,
  orderReceived,
} from "./finance/engine";
import type {
  AgreementInput,
  PaymentInput,
  OpenShiftInput,
  CloseShiftInput,
} from "./finance/types";
import {
  normalizeDocument,
  isValidCnpj,
  isValidCpf,
} from "./fiscal/identifiers";
import {
  prepareFiscalDocument,
  transitionFiscalDocument,
} from "./fiscal/engine";
import { simulationAdapter } from "./fiscal/simulation-adapter";
import type {
  CompanyFiscalProfile,
  FiscalAction,
  FiscalModel,
  FiscalSource,
  ServiceFiscalProfile,
  SimulationOutcome,
} from "./fiscal/types";

const KEY = "sistem:prototype:v1";
const recordDiagnostic = (operation: DiagnosticOperation) => {
  if (typeof window === "undefined") return null;
  try {
    return getBrowserRecorder().record({
      operation,
      route: window.location.pathname,
    });
  } catch {
    // A diagnostic failure must never replace the operational result.
    return null;
  }
};
const withSupportCode = (message: string, id?: string) =>
  id ? `${message} Código da ocorrência para suporte: ${id}` : message;
type Context = {
  state: DemoState;
  hydrated: boolean;
  storageAvailable: boolean;
  notify: (message: string) => void;
  saveCustomer: (customer: Customer) => void;
  saveProduct: (product: Product) => void;
  setProductPrices: (changes: ProductPriceChange[]) => void;
  saveTechnician: (technician: Technician) => Technician;
  saveOrder: (order: ServiceOrder) => ServiceOrder;
  advanceOrder: (id: string, note?: string, expectedStage?: Stage, allowOutstanding?: boolean) => void;
  createPaymentAgreement: (input: AgreementInput) => string;
  registerInstallmentPayment: (input: PaymentInput) => string;
  openCashShift: (input: OpenShiftInput) => string;
  closeCashShift: (input: CloseShiftInput) => void;
  receiveStock: (id: string, quantity: number, reason: string) => void;
  createSale: (sale: Sale) => void;
  deliverSale: (id: string) => void;
  importProducts: (key: string, products: Product[]) => void;
  confirmPurchase: (input: PurchaseInput) => void;
  saveFiscalProfile: (profile: CompanyFiscalProfile) => void;
  saveServiceFiscal: (profile: ServiceFiscalProfile) => void;
  prepareFiscal: (source: FiscalSource, model: FiscalModel) => string;
  fiscalAction: (id: string, action: FiscalAction, reason?: string) => void;
  processFiscal: (id: string, outcome: SimulationOutcome) => Promise<void>;
  reset: () => void;
};
const Store = createContext<Context | null>(null);
const copySeed = () => structuredClone(seed);

export function DemoProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DemoState>(copySeed);
  const current = useRef(state);
  const durablySaved = useRef<DemoState | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [message, setMessage] = useState("");
  const initialized = useRef(false);
  const recoveryBlocked = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      try {
        const raw = window.localStorage.getItem(KEY);
        if (raw) {
          const value: unknown = JSON.parse(raw);
          const restored = restoreDemoState(value);
          current.current = restored;
          setState(restored);
        }
      } catch {
        recoveryBlocked.current = true;
        setStorageAvailable(false);
        const incident = recordDiagnostic("storageRead");
        setMessage(
          withSupportCode(
            "Os dados locais não puderam ser recuperados e foram preservados. A gravação está bloqueada; exporte o arquivo original antes de restaurar os exemplos nas configurações.",
            incident?.id,
          ),
        );
      }
      setHydrated(true);
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    if (!hydrated || recoveryBlocked.current) return;
    if (durablySaved.current === state) return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(state));
      setStorageAvailable(true);
    } catch {
      setStorageAvailable(false);
      const incident = recordDiagnostic("storageWrite");
      setMessage(
        withSupportCode(
          "A gravação local está indisponível. As alterações em memória ainda não foram salvas neste navegador.",
          incident?.id,
        ),
      );
    }
  }, [state, hydrated]);
  const notify = (text: string) => {
    setMessage(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(""), 6500);
  };
  useEffect(() => {
    const report = (operation: "runtimeError" | "unhandledRejection") => {
      const incident = recordDiagnostic(operation);
      if (incident) {
        notify(
          withSupportCode(
            "Uma ocorrência da aplicação foi registrada neste navegador.",
            incident.id,
          ),
        );
      }
    };
    const onError = () => report("runtimeError");
    const onRejection = () => report("unhandledRejection");
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  const commit = (update: (state: DemoState) => DemoState, durable = false): DemoState => {
    if (recoveryBlocked.current)
      throw new Error(
        "Os dados originais estão preservados. Resolva a recuperação nas configurações antes de gravar alterações.",
      );
    const next = update(current.current);
    if (durable) {
      if (!hydrated)
        throw new Error("Aguarde a recuperação dos dados locais antes de confirmar.");
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        setStorageAvailable(false);
        const incident = recordDiagnostic("storageWrite");
        throw new Error(withSupportCode(
          "Não foi possível gravar a operação neste navegador. Nenhuma alteração foi confirmada; o rascunho foi preservado para tentar novamente.",
          incident?.id,
        ));
      }
      durablySaved.current = next;
      setStorageAvailable(true);
    }
    current.current = next;
    setState(next);
    return next;
  };
  const value: Context = {
    state,
    hydrated,
    storageAvailable,
    notify,
    saveCustomer(customer) {
      if (!customer.name.trim()) throw new Error("Informe o nome do cliente.");
      if (
        customer.document &&
        !(customer.type === "Empresa"
          ? isValidCnpj(customer.document)
          : isValidCpf(customer.document))
      )
        throw new Error(
          "Confira o formato e os dígitos verificadores do CPF/CNPJ. Esta conferência não consulta a Receita Federal.",
        );
      const normalized = {
        ...customer,
        document: customer.document
          ? normalizeDocument(customer.document)
          : undefined,
      };
      commit((s) => ({
        ...s,
        customers: s.customers.some((c) => c.id === customer.id)
          ? s.customers.map((c) => (c.id === customer.id ? normalized : c))
          : [normalized, ...s.customers],
      }));
      notify("Cliente salvo na demonstração.");
    },
    saveProduct(product) {
      if (
        !product.name.trim() ||
        !product.sku.trim() ||
        ![product.price, product.cost].every(
          (v) => Number.isSafeInteger(v) && v >= 0,
        )
      )
        throw new Error("Confira nome, SKU e valores do produto.");
      commit((s) => {
        if (
          s.products.some(
            (p) =>
              p.sku.toLowerCase() === product.sku.toLowerCase() &&
              p.id !== product.id,
          )
        )
          throw new Error("Este SKU já está cadastrado. Escolha outro código.");
        return {
          ...s,
          products: s.products.some((p) => p.id === product.id)
            ? s.products.map((p) => (p.id === product.id ? product : p))
            : [product, ...s.products],
        };
      }, true);
      notify("Produto salvo na demonstração.");
    },
    setProductPrices(changes) {
      commit((s) => applyProductPrices(s, changes), true);
      notify("Preços gravados neste navegador. Estoque e operações anteriores preservados.");
    },
    saveTechnician(technician) {
      const name = technician.name.trim().replace(/\s+/g, " ");
      if (!technician.id.trim() || !name || name.length > 100 ||
        technicianNameKey(name) === technicianNameKey("Não atribuído")) {
        throw new Error("Informe o nome do técnico. Não atribuído é uma opção de ausência de responsável.");
      }
      const saved = { id: technician.id, name };
      commit((s) => {
        const technicians = techniciansForState(s);
        if (technicians.some((item) => item.id === saved.id || technicianNameKey(item.name) === technicianNameKey(name))) {
          throw new Error("Já existe um técnico com esse nome. Selecione o cadastro existente.");
        }
        return { ...s, technicians: [...technicians, saved] };
      });
      notify("Técnico cadastrado para os atendimentos. Este cadastro não concede acesso ao sistema.");
      return saved;
    },
    saveOrder(order) {
      const saved = commit((s) => {
        const existing = s.orders.find((o) => o.id === order.id);
        if (
          existing &&
          sourceAgreement(s, { type: "order", id: order.id }) &&
          ["customerId", "parts", "labor", "received", "approved"].some(
            (key) =>
              existing[key as keyof ServiceOrder] !==
              order[key as keyof ServiceOrder],
          )
        )
          throw new Error(
            "Esta OS possui acordo financeiro. Cliente, valores, aprovação e legado estão preservados; renegociação ainda não está disponível.",
          );
        if (s.orders.some((o) => o.id === order.id))
          return {
            ...s,
            orders: s.orders.map((o) => (o.id === order.id ? order : o)),
          };
        const number = Math.max(1042, ...s.orders.map((o) => o.number)) + 1;
        return { ...s, orders: [{ ...order, number }, ...s.orders] };
      }, true);
      notify("Ordem de serviço salva.");
      return saved.orders.find((item) => item.id === order.id)!;
    },
    advanceOrder(id, note, expectedStage, allowOutstanding) {
      const nextStages: Record<Stage, Stage> = {
        received: "diagnosing",
        diagnosing: "awaiting_approval",
        awaiting_approval: "in_progress",
        in_progress: "quality_check",
        quality_check: "ready_for_pickup",
        ready_for_pickup: "delivered",
        delivered: "delivered",
      };
      const labels: Record<Stage, string> = {
        received: "Diagnóstico iniciado",
        diagnosing: "Orçamento preparado",
        awaiting_approval: `Aprovação registrada: ${note || "cliente"}`,
        in_progress: "Execução concluída; encaminhada para testes",
        quality_check: "Checklist funcional aprovado",
        ready_for_pickup: `Equipamento e acessórios entregues a ${note || "responsável"}`,
        delivered: "Atendimento concluído",
      };
      const activeOrder = current.current.orders.find((order) => order.id === id);
      if (!activeOrder) throw new Error("Esta ordem não está disponível neste navegador.");
      const at = new Date().toISOString();
      const date = new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short",
      }).format(new Date(at));
      commit((s) => ({
        ...s,
        orders: s.orders.map((o) => {
          if (o.id !== id) return o;
          if (expectedStage !== undefined && o.stage !== expectedStage)
            throw new Error("A etapa da OS mudou. Confira a situação atual antes de confirmar outra ação.");
          if (o.stage === "delivered")
            throw new Error("Esta ordem já foi entregue.");
          if (
            o.stage === "diagnosing" &&
            (!o.diagnosis.trim() || sumOrder(o) <= 0)
          )
            throw new Error(
              "Registre o diagnóstico e os valores antes de preparar o orçamento.",
            );
          if (o.stage === "awaiting_approval" && !note?.trim())
            throw new Error(
              "Informe quem autorizou o orçamento e como a aprovação foi recebida.",
            );
          if (o.stage === "ready_for_pickup" && !note?.trim())
            throw new Error(
              "Informe o responsável pela retirada do equipamento.",
            );
          if (o.stage === "ready_for_pickup") {
            if (!o.approved || !o.tested)
              throw new Error("A aprovação e os testes precisam estar concluídos antes da entrega.");
            if (sumOrder(o) - orderReceived(s, o) > 0 && !allowOutstanding)
              throw new Error("Confira e aceite explicitamente a entrega com saldo pendente nesta demonstração.");
          }
          return {
            ...o,
            stage: nextStages[o.stage],
            approved: o.approved || o.stage === "awaiting_approval",
            tested: o.tested || o.stage === "quality_check",
            history: [
              { label: labels[o.stage], date, at },
              ...o.history,
            ],
          };
        }),
      }), true);
      notify("Etapa da ordem atualizada.");
    },
    createPaymentAgreement(input) {
      const id = uid();
      commit((s) => prepareAgreement(s, input, id, new Date().toISOString()));
      notify(
        "Parcelamento salvo. Nenhum recebimento foi criado automaticamente.",
      );
      return id;
    },
    registerInstallmentPayment(input) {
      let id = uid();
      commit((s) => {
        const next = recordPayment(s, input, id, new Date().toISOString());
        id = next.finance.payments.find(
          (p) => p.idempotencyKey === input.idempotencyKey,
        )!.id;
        return next;
      });
      notify(
        "Recebimento manual registrado na demonstração. Recibo disponível.",
      );
      return id;
    },
    openCashShift(input) {
      const id = uid();
      commit((s) => openShift(s, input, id, new Date().toISOString()));
      notify("Turno aberto com saldo escritural; a abertura não gera receita.");
      return id;
    },
    closeCashShift(input) {
      commit((s) => closeShift(s, input, new Date().toISOString()));
      notify(
        "Contagem e diferença preservadas. Nenhum ajuste de saldo foi criado.",
      );
    },
    receiveStock(id, quantity, reason) {
      if (!Number.isSafeInteger(quantity) || quantity < 1)
        throw new Error("Informe uma quantidade inteira maior que zero.");
      if (!reason.trim()) throw new Error("Informe o motivo da entrada.");
      commit((s) => ({
        ...s,
        products: s.products.map((p) =>
          p.id === id
            ? {
                ...p,
                stock: p.stock + quantity,
                lastReceipt: `${quantity} ${p.unit} · ${reason}`,
              }
            : p,
        ),
      }));
      notify("Entrada manual de estoque registrada.");
    },
    createSale(sale) {
      commit((s) => applySaleConfirmation(s, sale), true);
      notify(
        "Pedido confirmado e quantidade reservada. Nenhuma nota fiscal foi emitida.",
      );
    },
    deliverSale(id) {
      commit((s) => applySaleDelivery(s, id), true);
      notify("Entrega registrada. Estoque atualizado uma única vez.");
    },
    importProducts(key, products) {
      commit((s) => {
        if (s.imports.includes(key))
          throw new Error(
            "Este documento já foi utilizado nesta demonstração.",
          );
        if (
          products.some((p) =>
            s.products.some(
              (existing) => existing.sku.toLowerCase() === p.sku.toLowerCase(),
            ),
          )
        )
          throw new Error(
            "Um SKU já existe. Vincule o item ao produto cadastrado.",
          );
        return {
          ...s,
          products: [...products, ...s.products],
          imports: [...s.imports, key],
        };
      });
      notify(
        "Importação concluída. Os cadastros foram criados sem alterar o estoque.",
      );
    },
    confirmPurchase(input) {
      commit((s) => applyPurchase(s, input), true);
      notify(input.receive
        ? "Importação concluída. O recebimento foi gravado neste navegador, sem gerar pagamentos."
        : "Importação concluída. Cadastros e vínculos gravados sem alterar o estoque.");
    },
    saveFiscalProfile(profile) {
      if (profile.cnpj && !isValidCnpj(profile.cnpj))
        throw new Error(
          "Confira o CNPJ do emitente. São aceitos CNPJs numéricos e alfanuméricos com dígitos verificadores válidos.",
        );
      commit((s) => ({
        ...s,
        fiscalProfile: {
          ...profile,
          cnpj: normalizeDocument(profile.cnpj),
          environment: "simulation",
        },
      }));
      notify(
        "Configuração demonstrativa salva. Nenhuma habilitação fiscal foi realizada.",
      );
    },
    saveServiceFiscal(profile) {
      commit((s) => ({ ...s, serviceFiscal: { ...profile } }));
      notify("Perfil de serviço salvo para conferência local.");
    },
    prepareFiscal(source, model) {
      const id = uid();
      commit((s) => ({
        ...s,
        documents: [
          prepareFiscalDocument(s, source, model, id, new Date().toISOString()),
          ...s.documents,
        ],
      }));
      notify("Rascunho simulado preparado. Nenhuma nota foi emitida.");
      return id;
    },
    fiscalAction(id, action, reason) {
      commit((s) => {
        const next = transitionFiscalDocument(
          s,
          id,
          action,
          new Date().toISOString(),
          reason,
        );
        return {
          ...s,
          documents: s.documents.map((d) => (d.id === id ? next : d)),
        };
      });
      notify("Estado da simulação atualizado; sem efeito fiscal real.");
    },
    async processFiscal(id, outcome) {
      commit((s) => {
        const next = transitionFiscalDocument(
          s,
          id,
          "begin",
          new Date().toISOString(),
        );
        return {
          ...s,
          documents: s.documents.map((d) => (d.id === id ? next : d)),
        };
      });
      const result = await simulationAdapter.process(outcome);
      const action: FiscalAction =
        result === "authorized"
          ? "authorize"
          : result === "rejected"
            ? "reject"
            : "unknown";
      commit((s) => {
        const next = transitionFiscalDocument(
          s,
          id,
          action,
          new Date().toISOString(),
        );
        return {
          ...s,
          documents: s.documents.map((d) => (d.id === id ? next : d)),
        };
      });
      notify(
        result === "unknown"
          ? "Resultado fictício desconhecido. Consulte esta simulação antes de tentar outra."
          : "Processamento simulado concluído. Não há autorização fiscal real.",
      );
    },
    reset() {
      recoveryBlocked.current = false;
      commit(copySeed);
      notify("Dados de demonstração restaurados.");
    },
  };
  const diagnosed = { ...value };
  for (const [operation, command] of Object.entries(value)) {
    if (!isDiagnosticOperation(operation) || typeof command !== "function")
      continue;
    (diagnosed as unknown as Record<string, unknown>)[operation] = (
      ...args: unknown[]
    ) =>
      instrumentOperation(
        operation,
        () => Reflect.apply(command, value, args),
        (failedOperation) => {
          const incident = recordDiagnostic(failedOperation);
          if (incident)
            notify(
              withSupportCode("A operação não foi concluída.", incident.id),
            );
        },
      );
  }
  return (
    <Store.Provider value={diagnosed}>
      {children}
      <div
        className={`toast ${message ? "visible" : ""}`}
        role="status"
        aria-live="polite"
      >
        {message}
      </div>
    </Store.Provider>
  );
}

export function useDemo() {
  const context = useContext(Store);
  if (!context) throw new Error("DemoProvider ausente");
  return context;
}
export const uid = () => crypto.randomUUID();
export const newOrder = (customerId: string): ServiceOrder => ({
  id: uid(),
  number: 0,
  customerId,
  equipment: "",
  serial: "",
  accessories: "",
  issue: "",
  diagnosis: "",
  stage: "received",
  technician: "Não atribuído",
  due: TODAY,
  created: TODAY,
  parts: 0,
  labor: 0,
  received: 0,
  approved: false,
  tested: false,
  history: [
    {
      label: "Equipamento recebido no atendimento",
      date: "Agora · demonstração",
    },
  ],
});
