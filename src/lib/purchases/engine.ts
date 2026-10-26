import type { DemoState, Product } from "../domain";
import type {
  ProductAttributes,
  PurchaseDocument,
  PurchaseInput,
  PurchaseLine,
  PurchasePlan,
  PurchaseRecord,
  PurchasingState,
  SupplierProductLink,
} from "./types";

const normalized = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const unitKey = (value: string) =>
  normalized(value).replace(/^(unidade|unidades|und|unid)$/, "un");
const same = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);
const emptyPurchasing = (): PurchasingState => ({
  links: [],
  documents: [],
  receipts: [],
});
const integer = (value: unknown, minimum = 0): value is number =>
  Number.isSafeInteger(value) && Number(value) >= minimum;
function fail(message: string): never {
  throw new Error(message);
}
const sorted = (values: string[]) => values.map(normalized).sort();

export { extractProductIdentity, buildPurchasePlan } from "../../../shared/purchase-planner.mjs";
import { extractProductIdentity, buildPurchasePlan, conflicts, validGtin, mixedColors } from "../../../shared/purchase-planner.mjs";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function validateSource(line: PurchaseLine): void {
  if (
    !line ||
    !line.id?.trim() ||
    !line.code?.trim() ||
    !line.description?.trim() ||
    !line.unit?.trim() ||
    !integer(line.quantity, 1) ||
    !integer(line.costCents) ||
    typeof line.ncm !== "string"
  )
    fail(
      "Revise identificação, quantidade inteira, unidade e custo dos itens.",
    );
  if (line.totalCents !== undefined && !integer(line.totalCents))
    fail("Valor total do item inválido.");
  if (line.gtin !== undefined && typeof line.gtin !== "string")
    fail("GTIN inválido.");
  for (const value of [line.rawQuantity, line.rawUnitCost])
    if (value !== undefined && typeof value !== "string")
      fail("Valor original inválido.");
}

function validateDocument(document: PurchaseDocument): void {
  if (
    !document.key?.trim() ||
    !document.supplierId?.trim() ||
    !document.supplierName?.trim() ||
    !document.number?.trim() ||
    !Array.isArray(document.items) ||
    !document.items.length ||
    document.items.length > 500
  )
    fail("Documento de compra incompleto.");
  document.items.forEach(validateSource);
  if (
    new Set(document.items.map((line) => line.id)).size !==
    document.items.length
  )
    fail("O documento contém identificadores de item repetidos.");
  if (
    document.totalsAdjustmentCents !== undefined &&
    !Number.isSafeInteger(document.totalsAdjustmentCents)
  )
    fail("Componentes do total inválidos.");
  const total = document.items.reduce(
    (sum, line) => sum + (line.totalCents ?? line.costCents * line.quantity),
    document.totalsAdjustmentCents || 0,
  );
  if (
    !integer(total) ||
    (document.totalCents !== undefined &&
      (!integer(document.totalCents) || document.totalCents !== total))
  )
    fail("Total divergente: confira os valores e componentes do documento.");
}

const operationFingerprint = (input: PurchaseInput) =>
  canonical({
    document: input.document,
    decisions: input.decisions,
    receive: input.receive,
  });
const identityId = (prefix: string, key: string, line: string) =>
  `${prefix}:${encodeURIComponent(key)}:${encodeURIComponent(line)}`;

export function applyPurchase(
  state: DemoState,
  input: PurchaseInput,
): DemoState {
  if (
    !input.operationId?.trim() ||
    !input.now ||
    !Number.isFinite(Date.parse(input.now))
  )
    fail("Identificação e data da operação são necessárias.");
  validateDocument(input.document);
  const fingerprint = operationFingerprint(input);
  const current = state.purchasing || emptyPurchasing();
  const operation = current.operations?.find(
    (item) => item.id === input.operationId,
  );
  if (operation) {
    if (operation.fingerprint !== fingerprint)
      fail("Esta operação já foi utilizada com outros dados.");
    return state;
  }
  const previous = current.documents.find(
    (document) => document.key === input.document.key,
  );
  if (previous && !input.receive)
    fail(
      "Este documento já foi utilizado. Os cadastros foram preservados; registre somente um recebimento remanescente quando necessário.",
    );
  if (state.imports.includes(input.document.key) && !previous)
    fail(
      "Documento já registrado anteriormente; concilie a entrada antes de receber novamente.",
    );
  if (
    previous &&
    (!same(
      previous.lines.map((line) => line.source),
      input.document.items,
    ) ||
      previous.supplierId !== input.document.supplierId ||
      previous.totalCents !== input.document.totalCents ||
      previous.totalsAdjustmentCents !== input.document.totalsAdjustmentCents)
  )
    fail(
      "Documento já registrado com dados diferentes; revise a origem sem alterar o histórico.",
    );
  const next = structuredClone(state);
  const purchasing = next.purchasing || emptyPurchasing();
  next.purchasing = purchasing;
  const plan = buildPurchasePlan(state, input.document);
  const record: PurchaseRecord = previous
    ? structuredClone(previous)
    : {
        key: input.document.key,
        supplierId: input.document.supplierId,
        supplierName: input.document.supplierName,
        number: input.document.number,
        importedAt: input.now,
        lines: [],
        financeStatus: "pending",
        ...(input.document.totalCents !== undefined
          ? { totalCents: input.document.totalCents }
          : {}),
        ...(input.document.totalsAdjustmentCents !== undefined
          ? { totalsAdjustmentCents: input.document.totalsAdjustmentCents }
          : {}),
        ...(input.document.originalXml !== undefined
          ? { originalXml: input.document.originalXml }
          : {}),
        operationId: input.operationId,
        operationFingerprint: fingerprint,
      };
  const receipt = {
    id: input.operationId,
    documentKey: input.document.key,
    createdAt: input.now,
    operationFingerprint: fingerprint,
    items: [] as {
      lineId: string;
      productId: string;
      quantity: number;
      stockQuantity: number;
    }[],
  };
  for (const line of plan.lines) {
    const decision = input.decisions[line.source.id];
    if (!decision || !["new", "link", "ignore"].includes(decision.action))
      fail(`Resolva a dúvida do item ${line.source.code}.`);
    const oldLine = previous?.lines.find(
      (item) => item.source.id === line.source.id,
    );
    if (
      oldLine &&
      (oldLine.action !== decision.action ||
        (decision.action === "link" &&
          oldLine.productId !== decision.productId))
    )
      fail(
        "O vínculo de uma compra registrada não pode reescrever o histórico.",
      );
    if (decision.action === "ignore") {
      if (!previous)
        record.lines.push({
          source: structuredClone(line.source),
          action: "ignore",
          conversion: 1,
        });
      continue;
    }
    let product: Product | undefined = oldLine?.productId
      ? next.products.find((item) => item.id === oldLine.productId)
      : decision.action === "link"
        ? next.products.find((item) => item.id === decision.productId)
        : undefined;
    if (decision.action === "link" && !product)
      fail("Escolha um produto disponível para o vínculo.");
    if (
      product &&
      conflicts(
        line.attributes,
        product.attributes || extractProductIdentity(product.name).attributes,
      )
    )
      fail(
        `Modelo ou características incompatíveis no item ${line.source.code}. Escolha a variação correta antes de vincular.`,
      );
    const creatingProduct = !product;
    if (!product) {
      const name = decision.name?.trim() || line.name;
      if (!name) fail("Nome comercial necessário para o novo produto.");
      if (decision.priceCents !== undefined && !integer(decision.priceCents))
        fail("Preço de venda inválido.");
      const id = identityId(
        "purchase-product",
        input.document.key,
        line.source.id,
      );
      if (next.products.some((item) => item.id === id))
        fail("Identificador de produto já utilizado.");
      let sku = line.source.code;
      if (
        next.products.some(
          (item) => item.sku.toLowerCase() === sku.toLowerCase(),
        )
      )
        sku = `IMP-${next.products.length + 1}`;
      while (
        next.products.some(
          (item) => item.sku.toLowerCase() === sku.toLowerCase(),
        )
      )
        sku = `${sku}-N`;
      product = {
        id,
        sku,
        name,
        category: decision.category?.trim() || line.category,
        attributes: structuredClone(decision.attributes || line.attributes),
        unit: ["un", "pc", "peca"].includes(unitKey(line.source.unit))
          ? line.source.unit
          : "UN",
        ncm: line.source.ncm,
        cost: line.source.costCents,
        price: decision.priceCents ?? 0,
        pricePending: decision.priceCents === undefined,
        stock: 0,
        reserved: 0,
        minimum: 0,
        serialized: false,
        ...(validGtin(line.source.gtin) ? { gtin: line.source.gtin } : {}),
      };
      next.products.push(product);
    }
    const unitsMatch = unitKey(line.source.unit) === unitKey(product.unit);
    const confirmedConversion =
      decision.conversion ??
      (line.resolution === "known"
        ? line.conversion
        : unitsMatch
          ? 1
          : undefined);
    if (confirmedConversion === undefined || !integer(confirmedConversion, 1))
      fail(`Informe a conversão da embalagem do item ${line.source.code}.`);
    if (creatingProduct)
      product.cost = Math.round(line.source.costCents / confirmedConversion);
    if (oldLine && oldLine.conversion !== confirmedConversion)
      fail(
        "Conversão registrada não pode ser alterada em recebimento posterior.",
      );
    if (!previous)
      record.lines.push({
        source: structuredClone(line.source),
        action: decision.action,
        productId: product.id,
        conversion: confirmedConversion,
      });
    const existingLink = purchasing.links.findIndex(
      (link) =>
        link.supplierId === input.document.supplierId &&
        link.supplierCode === line.source.code &&
        unitKey(link.unit) === unitKey(line.source.unit),
    );
    if (!previous) {
      const link: SupplierProductLink = {
        id: identityId(
          "supplier-link",
          input.document.supplierId,
          `${line.source.code}:${unitKey(line.source.unit)}`,
        ),
        supplierId: input.document.supplierId,
        supplierCode: line.source.code,
        unit: line.source.unit,
        productId: product.id,
        description: line.source.description,
        confirmedAt: input.now,
        conversion: confirmedConversion,
        attributes: structuredClone(line.attributes),
        ...(validGtin(line.source.gtin) ? { gtin: line.source.gtin } : {}),
      };
      if (existingLink < 0) purchasing.links.push(link);
      else purchasing.links[existingLink] = link;
    }
    if (input.receive) {
      if (product.serialized)
        fail(
          `O item ${line.source.code} exige séries no recebimento; somente cadastrar está disponível.`,
        );
      if (mixedColors(line.source.description))
        fail(
          `O item ${line.source.code} tem cores sortidas; registre a distribuição física antes de receber.`,
        );
      const alreadyReceived = purchasing.receipts
        .filter((item) => item.documentKey === input.document.key)
        .flatMap((item) => item.items)
        .filter((item) => item.lineId === line.source.id)
        .reduce((sum, item) => sum + item.quantity, 0);
      const quantity =
        decision.receivedQuantity ?? line.source.quantity - alreadyReceived;
      if (
        !integer(quantity) ||
        quantity + alreadyReceived > line.source.quantity
      )
        fail(
          `Quantidade recebida excede o remanescente do item ${line.source.code}.`,
        );
      if (!quantity) continue;
      const stockQuantity = quantity * confirmedConversion;
      if (!integer(stockQuantity, 1) || !integer(product.stock + stockQuantity))
        fail("Quantidade de estoque inválida.");
      product.stock += stockQuantity;
      product.lastReceipt = input.now.slice(0, 10);
      receipt.items.push({
        lineId: line.source.id,
        productId: product.id,
        quantity,
        stockQuantity,
      });
    }
  }
  if (input.receive && !receipt.items.length)
    fail(
      "Todos os itens já foram recebidos ou estão sem quantidade para esta entrada.",
    );
  if (!previous) {
    purchasing.documents.push(record);
    if (!next.imports.includes(input.document.key))
      next.imports.push(input.document.key);
  }
  if (receipt.items.length) purchasing.receipts.push(receipt);
  purchasing.operations = [
    ...(purchasing.operations || []),
    { id: input.operationId, fingerprint },
  ];
  return next;
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}
function date(value: unknown): boolean {
  return text(value) && Number.isFinite(Date.parse(value));
}
function validateAttributes(
  value: unknown,
): asserts value is ProductAttributes {
  if (!object(value)) fail("Atributos de compra inválidos.");
  for (const field of ["compatibleModels", "connectors"])
    if (
      value[field] !== undefined &&
      (!Array.isArray(value[field]) || !(value[field] as unknown[]).every(text))
    )
      fail("Lista de atributos inválida.");
  for (const field of ["material", "finish", "color", "border"])
    if (value[field] !== undefined && !text(value[field]))
      fail("Atributo textual inválido.");
  for (const field of ["magsafe", "lensProtection"])
    if (value[field] !== undefined && typeof value[field] !== "boolean")
      fail("Atributo booleano inválido.");
  for (const field of ["lengthMeters", "powerWatts"])
    if (
      value[field] !== undefined &&
      (typeof value[field] !== "number" ||
        !Number.isFinite(value[field]) ||
        Number(value[field]) <= 0)
    )
      fail("Atributo numérico inválido.");
}

export function restorePurchasing(
  value: unknown,
  products: Product[],
): PurchasingState {
  if (
    !object(value) ||
    !Array.isArray(value.links) ||
    !Array.isArray(value.documents) ||
    !Array.isArray(value.receipts)
  )
    fail(
      "Dados de compras inválidos; restauração interrompida para preservar o histórico.",
    );
  const restored = structuredClone(value) as unknown as PurchasingState;
  const productIds = new Set(products.map((product) => product.id));
  const linkKeys = new Set<string>();
  const linkIds = new Set<string>();
  for (const link of restored.links) {
    if (
      !object(link) ||
      !text(link.id) ||
      !text(link.supplierId) ||
      !text(link.supplierCode) ||
      !text(link.unit) ||
      !text(link.description) ||
      !date(link.confirmedAt) ||
      !productIds.has(link.productId) ||
      !integer(link.conversion, 1) ||
      (link.gtin !== undefined && typeof link.gtin !== "string")
    )
      fail("Vínculo de fornecedor inválido.");
    validateAttributes(link.attributes);
    const key = canonical([
      link.supplierId,
      link.supplierCode,
      unitKey(link.unit),
    ]);
    if (linkKeys.has(key) || linkIds.has(link.id))
      fail("Vínculo de fornecedor duplicado.");
    linkKeys.add(key);
    linkIds.add(link.id);
  }
  const documents = new Map<string, PurchaseRecord>();
  for (const document of restored.documents) {
    if (
      !object(document) ||
      !text(document.key) ||
      !text(document.supplierId) ||
      !text(document.supplierName) ||
      !text(document.number) ||
      !date(document.importedAt) ||
      !Array.isArray(document.lines) ||
      document.financeStatus !== "pending" ||
      documents.has(document.key)
    )
      fail("Compra registrada inválida.");
    const lineIds = new Set<string>();
    for (const line of document.lines) {
      if (
        !object(line) ||
        !object(line.source) ||
        !["new", "link", "ignore"].includes(line.action) ||
        !integer(line.conversion, 1)
      )
        fail("Linha de compra inválida.");
      validateSource(line.source);
      if (
        lineIds.has(line.source.id) ||
        (line.action !== "ignore" && !productIds.has(line.productId || "")) ||
        (line.action === "ignore" && line.productId !== undefined)
      )
        fail("Referência da linha de compra inválida.");
      lineIds.add(line.source.id);
    }
    validateDocument({
      key: document.key,
      supplierId: document.supplierId,
      supplierName: document.supplierName,
      number: document.number,
      items: document.lines.map((line) => line.source),
      totalCents: document.totalCents,
      totalsAdjustmentCents: document.totalsAdjustmentCents,
    });
    if (
      document.originalXml !== undefined &&
      typeof document.originalXml !== "string"
    )
      fail("XML de origem inválido.");
    if (document.operationId !== undefined && !text(document.operationId))
      fail("Operação de compra inválida.");
    if (
      document.operationFingerprint !== undefined &&
      !text(document.operationFingerprint)
    )
      fail("Identidade da operação de compra inválida.");
    documents.set(document.key, document);
  }
  const receiptIds = new Set<string>();
  const quantities = new Map<string, number>();
  for (const receipt of restored.receipts) {
    if (
      !object(receipt) ||
      !text(receipt.id) ||
      receiptIds.has(receipt.id) ||
      !date(receipt.createdAt) ||
      !Array.isArray(receipt.items) ||
      !receipt.items.length ||
      (receipt.operationFingerprint !== undefined &&
        !text(receipt.operationFingerprint))
    )
      fail("Recebimento inválido.");
    const document = documents.get(receipt.documentKey);
    if (!document) fail("Recebimento sem documento de origem.");
    const receivedLines = new Set<string>();
    for (const item of receipt.items) {
      if (
        !object(item) ||
        !integer(item.quantity, 1) ||
        !integer(item.stockQuantity, 1) ||
        receivedLines.has(item.lineId)
      )
        fail("Quantidade de recebimento inválida.");
      const line = document.lines.find(
        (candidate) => candidate.source.id === item.lineId,
      );
      if (
        !line ||
        line.action === "ignore" ||
        line.productId !== item.productId ||
        item.stockQuantity !== item.quantity * line.conversion ||
        !productIds.has(item.productId)
      )
        fail("Movimento de estoque sem origem compatível.");
      const key = canonical([receipt.documentKey, item.lineId]);
      const sum = (quantities.get(key) || 0) + item.quantity;
      if (sum > line.source.quantity)
        fail("Recebimentos excedem a quantidade do documento.");
      quantities.set(key, sum);
      receivedLines.add(item.lineId);
    }
    receiptIds.add(receipt.id);
  }
  if (restored.operations !== undefined) {
    if (!Array.isArray(restored.operations))
      fail("Histórico de operações inválido.");
    const ids = new Set<string>();
    for (const operation of restored.operations) {
      if (
        !object(operation) ||
        !text(operation.id) ||
        !text(operation.fingerprint) ||
        ids.has(operation.id)
      )
        fail("Identidade de operação inválida ou duplicada.");
      ids.add(operation.id);
    }
  }
  return restored;
}
