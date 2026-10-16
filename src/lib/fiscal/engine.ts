import type { Customer, DemoState, Product } from "../domain";
import { normalizeDocument, isValidCnpj, isValidCpf } from "./identifiers";
import { states } from "./defaults";
import type {
  CompanyFiscalProfile,
  FiscalAction,
  FiscalAddress,
  FiscalDocument,
  FiscalIssue,
  FiscalModel,
  FiscalSnapshot,
  FiscalSource,
  FiscalStatus,
  ServiceFiscalProfile,
} from "./types";

const issue = (code: string, label: string, href: string): FiscalIssue => ({
  code,
  label,
  href,
});
const cents = (value: number) => Number.isSafeInteger(value) && value >= 0;
export function addressIssues(
  address: FiscalAddress | undefined,
  prefix: string,
  href: string,
  full: boolean,
): FiscalIssue[] {
  const issues: FiscalIssue[] = [];
  if (!address?.city?.trim())
    issues.push(issue(`${prefix}.city`, "Informe o município.", href));
  if (!states.includes(address?.state || ""))
    issues.push(issue(`${prefix}.state`, "Selecione uma UF válida.", href));
  if (!/^\d{7}$/.test(address?.municipalityCode || ""))
    issues.push(
      issue(
        `${prefix}.municipality`,
        "Informe o código IBGE do município com 7 dígitos.",
        href,
      ),
    );
  if (full) {
    if (
      !address?.street?.trim() ||
      !address?.number?.trim() ||
      !address?.district?.trim()
    )
      issues.push(
        issue(
          `${prefix}.address`,
          "Complete logradouro, número e bairro.",
          href,
        ),
      );
    if (!/^\d{8}$/.test((address?.zipCode || "").replace(/[-\s]/g, "")))
      issues.push(
        issue(`${prefix}.zip`, "Informe um CEP com 8 dígitos.", href),
      );
  }
  return issues;
}
export function companyIssues(
  profile: CompanyFiscalProfile,
  model?: FiscalModel,
): FiscalIssue[] {
  const href = "/fiscal/configuracao/";
  const issues = addressIssues(profile.address, "company", href, true);
  if (!profile.legalName.trim())
    issues.push(
      issue("company.name", "Informe a razão social do emitente.", href),
    );
  if (!isValidCnpj(profile.cnpj))
    issues.push(
      issue(
        "company.cnpj",
        "CNPJ do emitente ausente ou com dígitos verificadores inválidos.",
        href,
      ),
    );
  if (!["mei", "simples", "presumido", "real"].includes(profile.regime))
    issues.push(
      issue("company.regime", "Confirme o regime tributário da empresa.", href),
    );
  if (model !== "NFS-e" && !profile.stateRegistration.trim())
    issues.push(
      issue(
        "company.ie",
        "Informe a inscrição estadual ou a condição a validar para mercadorias.",
        href,
      ),
    );
  return issues;
}
export function customerIssues(
  customer: Customer,
  model: FiscalModel,
): FiscalIssue[] {
  const href = `/clientes/?q=${encodeURIComponent(customer.name)}`;
  const issues = addressIssues(
    customer.fiscalAddress,
    "customer",
    href,
    model === "NF-e",
  );
  const valid =
    customer.type === "Empresa"
      ? isValidCnpj(customer.document || "")
      : isValidCpf(customer.document || "");
  if (!valid)
    issues.push(
      issue(
        "customer.document",
        "Complete um CPF/CNPJ estruturalmente válido para o destinatário da simulação.",
        href,
      ),
    );
  return issues;
}
export function productIssues(product: Product): FiscalIssue[] {
  const href = "/fiscal/revisao/";
  const issues: FiscalIssue[] = [];
  const profile = product.fiscal;
  if (!/^\d{8}$/.test(product.ncm))
    issues.push(
      issue(
        `product.${product.id}.ncm`,
        `${product.sku}: confira o NCM de 8 dígitos.`,
        href,
      ),
    );
  if (!/^[0-8]$/.test(profile?.origin || ""))
    issues.push(
      issue(
        `product.${product.id}.origin`,
        `${product.sku}: preencha o código de origem.`,
        href,
      ),
    );
  if (!/^\d{4}$/.test(profile?.cfop || ""))
    issues.push(
      issue(
        `product.${product.id}.cfop`,
        `${product.sku}: preencha o CFOP da operação de saída.`,
        href,
      ),
    );
  if (!/^\d{2,3}$/.test(profile?.taxSituation || ""))
    issues.push(
      issue(
        `product.${product.id}.situation`,
        `${product.sku}: preencha CST/CSOSN para revisão.`,
        href,
      ),
    );
  if (profile?.cest && !/^\d{7}$/.test(profile.cest))
    issues.push(
      issue(
        `product.${product.id}.cest`,
        `${product.sku}: CEST informado deve ter 7 dígitos.`,
        href,
      ),
    );
  if (profile?.ibsCbsClass && !/^\d{6}$/.test(profile.ibsCbsClass))
    issues.push(
      issue(
        `product.${product.id}.class`,
        `${product.sku}: classificação IBS/CBS informada deve ter 6 dígitos.`,
        href,
      ),
    );
  return issues;
}
export function serviceIssues(profile: ServiceFiscalProfile): FiscalIssue[] {
  const issues: FiscalIssue[] = [];
  if (!profile.description.trim())
    issues.push(
      issue(
        "service.description",
        "Descreva o serviço no perfil fiscal.",
        "/fiscal/revisao/",
      ),
    );
  if (!profile.serviceCode.trim())
    issues.push(
      issue(
        "service.code",
        "Informe o código do serviço a revisar para a simulação.",
        "/fiscal/revisao/",
      ),
    );
  if (profile.ibsCbsClass && !/^\d{6}$/.test(profile.ibsCbsClass))
    issues.push(
      issue(
        "service.class",
        "Classificação IBS/CBS informada deve ter 6 dígitos.",
        "/fiscal/revisao/",
      ),
    );
  return issues;
}
export interface Preparation {
  issues: FiscalIssue[];
  snapshot: FiscalSnapshot | null;
}
export function reviewPreparation(
  state: DemoState,
  source: FiscalSource,
  model: FiscalModel,
): Preparation {
  const issues = companyIssues(state.fiscalProfile, model);
  let customer: Customer | undefined;
  let total = 0;
  let excludedParts = 0;
  let sourceLabel = "";
  const lines: FiscalSnapshot["lines"] = [];
  if (source.type === "sale") {
    const sale = state.sales.find((s) => s.id === source.id);
    if (!sale)
      return {
        issues: [issue("source.missing", "Pedido não encontrado.", "/vendas/")],
        snapshot: null,
      };
    if (model === "NFS-e")
      issues.push(
        issue(
          "source.model",
          "Vendas de produtos usam NF-e ou NFC-e neste protótipo.",
          "/fiscal/",
        ),
      );
    customer = state.customers.find((c) => c.id === sale.customerId);
    sourceLabel = `Pedido #${sale.number}`;
    if (!sale.items.length)
      issues.push(
        issue("source.empty", "O pedido não contém itens.", "/vendas/"),
      );
    for (const item of sale.items) {
      const product = state.products.find((p) => p.id === item.productId);
      if (!product) {
        issues.push(
          issue(
            "source.product",
            "Um produto do pedido não está disponível no catálogo.",
            "/produtos/",
          ),
        );
        continue;
      }
      issues.push(...productIssues(product));
      if (
        !Number.isSafeInteger(item.quantity) ||
        item.quantity <= 0 ||
        !cents(item.unitPrice)
      )
        issues.push(
          issue(
            "source.amount",
            "Quantidade ou valor do pedido inválido.",
            "/vendas/",
          ),
        );
      total += item.quantity * item.unitPrice;
      lines.push({
        description: product.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        ncm: product.ncm,
        productFiscal: product.fiscal,
      });
    }
    if (sale.total !== total)
      issues.push(
        issue(
          "source.total",
          "O total do pedido diverge dos itens. Revise a origem.",
          "/vendas/",
        ),
      );
  } else {
    const order = state.orders.find((o) => o.id === source.id);
    if (!order)
      return {
        issues: [
          issue(
            "source.missing",
            "Ordem de serviço não encontrada.",
            "/ordens/",
          ),
        ],
        snapshot: null,
      };
    if (model !== "NFS-e")
      issues.push(
        issue(
          "source.model",
          "A OS prepara somente o serviço em NFS-e nesta etapa. Peças exigem uma operação de mercadorias própria.",
          "/fiscal/",
        ),
      );
    if (!order.approved)
      issues.push(
        issue(
          "source.approval",
          "O orçamento da OS precisa estar aprovado para esta simulação.",
          `/ordens/?os=${order.id}`,
        ),
      );
    if (!cents(order.parts))
      issues.push(
        issue(
          "source.parts",
          "Valor de peças inválido na OS.",
          `/ordens/?os=${order.id}`,
        ),
      );
    customer = state.customers.find((c) => c.id === order.customerId);
    issues.push(...serviceIssues(state.serviceFiscal));
    sourceLabel = `OS #${order.number} · serviços`;
    total = order.labor;
    excludedParts = order.parts;
    lines.push({
      description: state.serviceFiscal.description,
      quantity: 1,
      unitPrice: order.labor,
      serviceFiscal: state.serviceFiscal,
    });
  }
  if (!customer)
    issues.push(
      issue(
        "customer.missing",
        "Cliente da operação não encontrado.",
        "/clientes/",
      ),
    );
  else issues.push(...customerIssues(customer, model));
  if (!cents(total) || total <= 0)
    issues.push(
      issue(
        "source.total",
        "O documento precisa de valor positivo e válido.",
        source.type === "sale" ? "/vendas/" : "/ordens/",
      ),
    );
  if (issues.length || !customer) return { issues, snapshot: null };
  return {
    issues: [],
    snapshot: structuredClone({
      company: { ...state.fiscalProfile, environment: "simulation" },
      customer: {
        id: customer.id,
        name: customer.name,
        document: normalizeDocument(customer.document || ""),
        address: customer.fiscalAddress,
      },
      model,
      sourceLabel,
      lines,
      total,
      excludedParts,
      taxCalculation: "not_calculated",
      warnings: [
        "Conferência local de preenchimento. Não comprova validade de códigos ou enquadramento tributário.",
        "Impostos não calculados. Credenciamento, certificados e regras do autorizador ainda não foram integrados.",
        ...(excludedParts > 0
          ? [
              "O valor de peças foi excluído desta NFS-e simulada. A operação de mercadorias continua pendente.",
            ]
          : []),
      ],
    }),
  };
}

const duplicate = (document: FiscalDocument, source: FiscalSource) =>
  document.mode === "simulation" &&
  document.source?.type === source.type &&
  document.source.id === source.id &&
  document.status !== "cancelled";
export function prepareFiscalDocument(
  state: DemoState,
  source: FiscalSource,
  model: FiscalModel,
  id: string,
  at: string,
): FiscalDocument {
  if (state.documents.some((d) => duplicate(d, source)))
    throw new Error(
      "Já existe um documento ativo para esta operação. Abra o documento existente; resultado desconhecido também bloqueia nova preparação.",
    );
  const result = reviewPreparation(state, source, model);
  if (!result.snapshot)
    throw new Error(result.issues.map((i) => i.label).join(" "));
  const number = `SIM-${String(state.documents.filter((d) => d.mode === "simulation").length + 1).padStart(6, "0")}`;
  return {
    id,
    number,
    customer: result.snapshot.customer.name,
    model,
    total: result.snapshot.total,
    status: "draft",
    date: at.slice(0, 10),
    mode: "simulation",
    source: { ...source },
    snapshot: result.snapshot,
    history: [
      {
        at,
        label: "Rascunho preparado com cópia dos dados de origem",
        status: "draft",
        snapshot: result.snapshot,
      },
    ],
    attempts: 0,
  };
}

export function transitionFiscalDocument(
  state: DemoState,
  id: string,
  action: FiscalAction,
  at: string,
  reason = "",
): FiscalDocument {
  const current = state.documents.find((d) => d.id === id);
  if (
    !current ||
    current.mode !== "simulation" ||
    !current.source ||
    !current.snapshot
  )
    throw new Error(
      "Este documento é apenas um exemplo. Prepare uma simulação a partir de uma operação.",
    );
  let status: FiscalStatus = current.status;
  let label = "";
  let snapshot = current.snapshot;
  let attempts = current.attempts || 0;
  let cancellationReason = current.cancellationReason;
  let resultMessage = current.resultMessage;
  const requireStatus = (...allowed: FiscalStatus[]) => {
    if (!allowed.includes(current.status))
      throw new Error(
        "Ação incompatível com o estado atual do documento. Atualize a tela.",
      );
  };
  switch (action) {
    case "queue":
      requireStatus("draft");
      status = "queued";
      label = "Solicitação colocada na fila local de simulação";
      break;
    case "begin":
      requireStatus("queued");
      status = "processing";
      attempts++;
      label = `Tentativa ${attempts}: processamento simulado iniciado`;
      break;
    case "authorize":
    case "reject":
    case "unknown":
      requireStatus("processing");
      status =
        action === "authorize"
          ? "authorized"
          : action === "reject"
            ? "rejected"
            : "unknown";
      label =
        action === "authorize"
          ? "Autorização fictícia registrada; não possui validade fiscal"
          : action === "reject"
            ? "Rejeição fictícia do cenário de teste; sem código de SEFAZ"
            : "Resposta fictícia não confirmada; consultar antes de reenviar";
      resultMessage = label;
      break;
    case "reconcile_authorized":
    case "reconcile_rejected":
      requireStatus("unknown", "processing");
      status = action === "reconcile_authorized" ? "authorized" : "rejected";
      label =
        status === "authorized"
          ? "Consulta simulada reconciliou o resultado como autorizado"
          : "Consulta simulada reconciliou o resultado como rejeitado";
      resultMessage = label;
      break;
    case "retry": {
      requireStatus("rejected");
      const reviewed = reviewPreparation(state, current.source, current.model);
      if (!reviewed.snapshot)
        throw new Error(reviewed.issues.map((i) => i.label).join(" "));
      snapshot = reviewed.snapshot;
      status = "draft";
      label = "Dados atuais revisados para nova tentativa no mesmo documento";
      resultMessage = undefined;
      break;
    }
    case "request_cancel":
      requireStatus("authorized");
      if (reason.trim().length < 15 || reason.trim().length > 255)
        throw new Error(
          "Registre uma justificativa entre 15 e 255 caracteres para esta simulação.",
        );
      status = "cancellation_pending";
      cancellationReason = reason.trim();
      label = `Cancelamento solicitado na simulação: ${cancellationReason}`;
      break;
    case "confirm_cancel":
      requireStatus("cancellation_pending");
      status = "cancelled";
      label =
        "Cancelamento fictício confirmado; estoque e financeiro preservados";
      break;
  }
  return {
    ...current,
    status,
    snapshot,
    total: snapshot.total,
    customer: snapshot.customer.name,
    attempts,
    resultMessage,
    cancellationReason,
    simulationReference:
      status === "authorized" || current.simulationReference
        ? `SIMULACAO-${current.id}`
        : undefined,
    history: [
      ...(current.history || []),
      {
        at,
        label,
        status,
        ...(action === "retry" || action === "begin"
          ? { snapshot: structuredClone(snapshot) }
          : {}),
      },
    ],
  };
}
