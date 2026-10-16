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
import { TODAY, sumOrder, money } from "./domain";
import { restoreDemoState } from "./demo-persistence";
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
type Context = {
  state: DemoState;
  hydrated: boolean;
  storageAvailable: boolean;
  notify: (message: string) => void;
  saveCustomer: (customer: Customer) => void;
  saveProduct: (product: Product) => void;
  saveOrder: (order: ServiceOrder) => void;
  advanceOrder: (id: string, note?: string) => void;
  receivePayment: (id: string, cents: number, method: string) => void;
  receiveStock: (id: string, quantity: number, reason: string) => void;
  createSale: (sale: Sale) => void;
  deliverSale: (id: string) => void;
  importProducts: (key: string, products: Product[]) => void;
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
  const [hydrated, setHydrated] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) {
        const value: unknown = JSON.parse(raw);
        const restored = restoreDemoState(value);
        current.current = restored;
        setState(restored);
      }
    } catch {
      setMessage(
        "Os dados locais não puderam ser recuperados. A demonstração foi reiniciada.",
      );
    }
    setHydrated(true);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(state));
      setStorageAvailable(true);
    } catch {
      setStorageAvailable(false);
    }
  }, [state, hydrated]);
  const notify = (text: string) => {
    setMessage(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(""), 6500);
  };
  const commit = (update: (state: DemoState) => DemoState) => {
    const next = update(current.current);
    current.current = next;
    setState(next);
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
      });
      notify("Produto salvo na demonstração.");
    },
    saveOrder(order) {
      commit((s) => {
        if (s.orders.some((o) => o.id === order.id))
          return {
            ...s,
            orders: s.orders.map((o) => (o.id === order.id ? order : o)),
          };
        const number = Math.max(1042, ...s.orders.map((o) => o.number)) + 1;
        return { ...s, orders: [{ ...order, number }, ...s.orders] };
      });
      notify("Ordem de serviço salva.");
    },
    advanceOrder(id, note) {
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
      commit((s) => ({
        ...s,
        orders: s.orders.map((o) => {
          if (o.id !== id) return o;
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
          return {
            ...o,
            stage: nextStages[o.stage],
            approved: o.approved || o.stage === "awaiting_approval",
            tested: o.tested || o.stage === "quality_check",
            history: [
              { label: labels[o.stage], date: "Agora · demonstração" },
              ...o.history,
            ],
          };
        }),
      }));
      notify("Etapa da ordem atualizada.");
    },
    receivePayment(id, cents, method) {
      commit((s) => ({
        ...s,
        orders: s.orders.map((o) => {
          if (o.id !== id) return o;
          const remaining = sumOrder(o) - o.received;
          if (!o.approved)
            throw new Error(
              "O orçamento precisa estar aprovado antes de registrar um recebimento.",
            );
          if (!Number.isSafeInteger(cents) || cents <= 0 || cents > remaining)
            throw new Error(
              "Informe um valor positivo que não ultrapasse o saldo.",
            );
          return {
            ...o,
            received: o.received + cents,
            history: [
              {
                label: `Recebimento de ${money(cents)} registrado · ${method}`,
                date: "Agora · demonstração",
              },
              ...o.history,
            ],
          };
        }),
      }));
      notify("Recebimento registrado na demonstração.");
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
      commit((s) => {
        for (const item of sale.items) {
          const product = s.products.find((p) => p.id === item.productId);
          if (
            !product ||
            !Number.isSafeInteger(item.quantity) ||
            item.quantity <= 0 ||
            product.stock - product.reserved < item.quantity
          )
            throw new Error(
              "Estoque disponível insuficiente. Revise os itens.",
            );
        }
        return {
          ...s,
          sales: [
            {
              ...sale,
              number: Math.max(401, ...s.sales.map((x) => x.number)) + 1,
            },
            ...s.sales,
          ],
          products: s.products.map((p) => ({
            ...p,
            reserved:
              p.reserved +
              sale.items
                .filter((i) => i.productId === p.id)
                .reduce((q, i) => q + i.quantity, 0),
          })),
        };
      });
      notify(
        "Pedido confirmado e quantidade reservada. Nenhuma nota fiscal foi emitida.",
      );
    },
    deliverSale(id) {
      commit((s) => {
        const sale = s.sales.find((sale) => sale.id === id);
        if (!sale || sale.status === "delivered")
          throw new Error(
            "Este pedido já foi entregue ou não está disponível.",
          );
        return {
          ...s,
          sales: s.sales.map((x) =>
            x.id === id ? { ...x, status: "delivered" } : x,
          ),
          products: s.products.map((p) => {
            const quantity = sale.items
              .filter((i) => i.productId === p.id)
              .reduce((q, i) => q + i.quantity, 0);
            return {
              ...p,
              stock: p.stock - quantity,
              reserved: p.reserved - quantity,
            };
          }),
        };
      });
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
      commit(copySeed);
      notify("Dados de demonstração restaurados.");
    },
  };
  return (
    <Store.Provider value={value}>
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
