import { expect, test } from "@playwright/test";
import { applyPurchase, buildPurchasePlan, extractProductIdentity } from "../src/lib/purchases/engine";
import { restoreDemoState } from "../src/lib/demo-persistence";
import { assertSaleEligible } from "../src/lib/sales-eligibility";
import type { PurchaseDecision, PurchaseDocument } from "../src/lib/purchases/types";
import { cover, expectNoMoneyOrFiscal, intelligentAt, intelligentFixture, knownPurchasing, purchaseDocument, purchaseLine, type IntelligentState } from "./intelligent-helpers";

const input = (document: PurchaseDocument, decisions: Record<string, PurchaseDecision>, receive = false, operationId = "qa-op-1") => ({ document, decisions, receive, operationId, now: intelligentAt });

test("NOM-03/05 extrai modelos distintos e nome curto preservando atributos e origem integral", () => {
  const state = intelligentFixture();
  for (const model of ["15", "15 PRO", "16"]) {
    const description = `CAPA ACRILICA TRANSPARENTE MAGSAFE APPLE - APPLE IPHONE ${model} PROTECAO DE LENTE`;
    const identity = extractProductIdentity(description);
    expect(identity.name.length).toBeLessThan(description.length);
    expect(identity.name.toLowerCase()).toContain(`iphone ${model.toLowerCase()}`);
    expect(identity.attributes.compatibleModels?.map((value) => value.toLowerCase())).toEqual([`iphone ${model.toLowerCase()}`]);
    expect(identity.attributes.magsafe).toBe(true);
    const plan = buildPurchasePlan(state, purchaseDocument({ items: [purchaseLine({ description })] }));
    expect(plan.lines[0].source.description).toBe(description);
  }
});

test("NOM-03/10 compatibilidade abreviada preserva os dois modelos sem inferir equivalência física", () => {
  const identity = extractProductIdentity("CAPA ACRILICA TRANSPARENTE MAGSAFE APPLE IPHONE 17 PRO / 18 PRO");
  expect(identity.attributes.compatibleModels?.map((model) => model.toLowerCase())).toEqual(["iphone 17 pro", "iphone 18 pro"]);
  expect(identity.name.toLowerCase()).toContain("iphone 17 pro");
  expect(identity.name.toLowerCase()).toContain("iphone 18 pro");
});

test("NOM-03/05 extrai referências Moto, Poco e Redmi presentes na descrição", () => {
  const identity = extractProductIdentity("CAPA ACRILICA TRANSPARENTE MOTO G05 / POCO C85 / REDMI 15C");
  expect(identity.attributes.compatibleModels?.map((model) => model.toLowerCase())).toEqual(["moto g05", "poco c85", "redmi 15c"]);
  for (const model of ["moto g05", "poco c85", "redmi 15c"]) expect(identity.name.toLowerCase()).toContain(model);
});

test("NOM-04/08 dado ausente continua desconhecido e não une acabamentos ou modelos por nome", () => {
  const identity = extractProductIdentity("CAPA ACRILICA IPHONE 15 PRO BORDA COLORIDA");
  expect(identity.attributes.magsafe).toBeUndefined();
  expect(identity.attributes.finish).toBeUndefined();
  expect(identity.attributes.color || "").not.toMatch(/azul|preto|vermelho/i);
  const document = purchaseDocument({ items: [purchaseLine({ description: "CAPA FOSCA IPHONE 16 SEM MAGSAFE" })] });
  const plan = buildPurchasePlan(intelligentFixture(), document);
  expect(plan.lines[0].resolution).not.toBe("known");
  expect(plan.lines[0].productId).not.toBe("cover-15pro");
});

test("NOM-01/02 vínculo é fornecedor e código textual, e nunca um código global", () => {
  const state = intelligentFixture();
  const document = purchaseDocument();
  state.purchasing = knownPurchasing(document);
  const first = buildPurchasePlan(state, document);
  expect(first.lines[0]).toMatchObject({ resolution: "known", productId: "cover-15pro", conversion: 1 });
  expect(first.lines[0].source.code).toBe("000123");
  const otherSupplier = buildPurchasePlan(state, { ...document, supplierId: "22222222000122" });
  expect(otherSupplier.lines[0].resolution).not.toBe("known");
  expect(state.purchasing.links).toHaveLength(1);
});

test("NOM-06 vínculo conhecido exige revisão quando muda modelo ou embalagem", () => {
  const state = intelligentFixture();
  const document = purchaseDocument();
  state.purchasing = knownPurchasing(document);
  for (const item of [purchaseLine({ description: "CAPA ACRILICA TRANSPARENTE MAGSAFE IPHONE 16" }), purchaseLine({ unit: "CX" })]) {
    const plan = buildPurchasePlan(state, { ...document, items: [item] });
    expect(plan.lines[0].resolution).toBe("review");
    expect(plan.lines[0].reason).toBeTruthy();
  }
});

test("NOM-06 vínculo antigo não oculta mudança do modelo no produto de destino", () => {
  const state = intelligentFixture();
  const document = purchaseDocument();
  state.purchasing = knownPurchasing(document);
  const target = state.products.find((product) => product.id === "cover-15pro")!;
  target.name = "Capa transparente MagSafe — iPhone 16";
  target.attributes = { ...target.attributes, compatibleModels: ["iPhone 16"] };
  const before = structuredClone(state);
  const plan = buildPurchasePlan(state, document);
  expect(plan.lines[0].resolution).toBe("review");
  expect(plan.lines[0].reason).toBeTruthy();
  expect(state).toEqual(before);
});

test("NOM-08 GTIN já cadastrado com modelo incompatível exige dúvida, não criação automática", () => {
  const state = intelligentFixture();
  state.products.find((product) => product.id === "cover-15pro")!.gtin = "7891234567895";
  const document = purchaseDocument({ items: [purchaseLine({ code: "NOVO-16", description: "CAPA ACRILICA TRANSPARENTE MAGSAFE IPHONE 16", gtin: "7891234567895" })] });
  const before = structuredClone(state);
  const plan = buildPurchasePlan(state, document);
  expect(plan.lines[0].resolution).toBe("review");
  expect(plan.lines[0].reason).toMatch(/GTIN|código|conflit|incompat/i);
  expect(state).toEqual(before);
});

test("USO-03/04 proposta nova sem GTIN não pede transcrição e cadastro-only não movimenta estoque", () => {
  const state = intelligentFixture();
  const before = structuredClone(state);
  const document = purchaseDocument({ items: [purchaseLine({ description: "CABO USB-C PARA USB-C 2 METROS 100W", gtin: "SEM GTIN" })] });
  const plan = buildPurchasePlan(state, document);
  expect(plan.lines[0].resolution).toBe("new");
  expect(plan.lines[0].name).toBeTruthy();
  const after = applyPurchase(state, input(document, { "line-1": { action: "new" } }));
  const product = after.products.find((value) => !before.products.some((old) => old.id === value.id))!;
  expect(product).toMatchObject({ stock: 0, reserved: 0, pricePending: true });
  expect(after.purchasing?.receipts).toEqual([]);
  expect(after.purchasing?.documents[0].financeStatus).toBe("pending");
  expect(after.purchasing?.documents[0].lines[0].source.description).toBe(document.items[0].description);
  expectNoMoneyOrFiscal(after, before);
  expect(state).toEqual(before);
});

test("NOM-01 dois fornecedores abastecem um SKU sem sobrescrever saldo, reservas ou preço", () => {
  const state = intelligentFixture();
  const before = structuredClone(state);
  const first = purchaseDocument();
  const second = purchaseDocument({ key: "QA-COMPRA-B-002", supplierId: "22222222000122", supplierName: "Fornecedor B fictício", items: [purchaseLine({ code: "000987", quantity: 3 })] });
  const afterFirst = applyPurchase(state, input(first, { "line-1": { action: "link", productId: "cover-15pro", conversion: 1 } }, true));
  const after = applyPurchase(afterFirst, input(second, { "line-1": { action: "link", productId: "cover-15pro", conversion: 1 } }, true, "qa-op-2"));
  expect(after.products).toHaveLength(before.products.length);
  expect(after.products.find((p) => p.id === "cover-15pro")).toMatchObject({ stock: 10, reserved: 1, price: 2500, name: cover().name });
  expect(after.purchasing?.links).toHaveLength(2);
  expect(after.purchasing?.receipts).toHaveLength(2);
  expect(after.purchasing?.receipts.map((receipt) => receipt.items[0].stockQuantity)).toEqual([5, 3]);
  expectNoMoneyOrFiscal(after, before);
});

test("NOM-03 vínculo explícito não mistura modelo de origem com SKU incompatível", () => {
  const state = intelligentFixture();
  const before = structuredClone(state);
  const document = purchaseDocument({ items: [purchaseLine({ description: "CAPA ACRILICA TRANSPARENTE MAGSAFE IPHONE 16" })] });
  expect(() => applyPurchase(state, input(document, { "line-1": { action: "link", productId: "cover-15pro", conversion: 1 } }, true))).toThrow(/modelo|compat|caracter|conflit/i);
  expect(state).toEqual(before);
});

test("NOM-07 conversão caixa para unidade é explícita e códigos preservam zeros iniciais", () => {
  const state = intelligentFixture();
  const document = purchaseDocument({ items: [purchaseLine({ code: "000007", unit: "CX", quantity: 1 })] });
  expect(() => applyPurchase(state, input(document, { "line-1": { action: "link", productId: "cover-15pro" } }, true))).toThrow();
  const after = applyPurchase(state, input(document, { "line-1": { action: "link", productId: "cover-15pro", conversion: 10 } }, true));
  expect(after.products.find((p) => p.id === "cover-15pro")?.stock).toBe(12);
  expect(after.purchasing?.links[0]).toMatchObject({ supplierCode: "000007", unit: "CX", conversion: 10 });
  expect(after.purchasing?.receipts[0].items[0]).toMatchObject({ quantity: 1, stockQuantity: 10 });
});

test("NOM-07 custo de referência de produto novo usa unidade interna após conversão", () => {
  const state = intelligentFixture();
  const document = purchaseDocument({ items: [purchaseLine({ code: "CX-CABO-10", unit: "CX", quantity: 1, costCents: 10000, description: "CABO USB-C PARA USB-C 2 METROS" })] });
  const after = applyPurchase(state, input(document, { "line-1": { action: "new", conversion: 10 } }, true));
  const created = after.products.find((product) => !state.products.some((old) => old.id === product.id))!;
  expect(created).toMatchObject({ unit: "UN", stock: 10, cost: 1000, pricePending: true });
  expect(after.purchasing?.documents[0].lines[0].source).toMatchObject({ unit: "CX", quantity: 1, costCents: 10000 });
  expectNoMoneyOrFiscal(after, state);
});

test("NOM-09/USO-08 repetição da operação não duplica cadastro, vínculo ou recebimento", () => {
  const state = intelligentFixture();
  const document = purchaseDocument({ items: [purchaseLine({ description: "Adaptador VGA para HDMI reforçado" })] });
  const command = input(document, { "line-1": { action: "new", priceCents: 7990 } }, true);
  const once = applyPurchase(state, command);
  const twice = applyPurchase(once, command);
  expect(twice).toEqual(once);
  expect(twice.purchasing?.documents).toHaveLength(1);
  expect(twice.purchasing?.links).toHaveLength(1);
  expect(twice.purchasing?.receipts).toHaveLength(1);
});

test("USO-08 identidade de operação reutilizada com decisões diferentes é rejeitada", () => {
  const state = intelligentFixture();
  const document = purchaseDocument();
  const first = input(document, { "line-1": { action: "link", productId: "cover-15pro", conversion: 1, receivedQuantity: 2 } }, true);
  const once = applyPurchase(state, first);
  const before = structuredClone(once);
  const different = input(document, { "line-1": { action: "link", productId: "cover-15pro", conversion: 1, receivedQuantity: 3 } }, true);
  expect(() => applyPurchase(once, different)).toThrow(/opera|reutiliz|difer|conflit/i);
  expect(once).toEqual(before);
});

test("USO-10 mesma chave de documento com origem alterada não recebe novo saldo", () => {
  const document = purchaseDocument();
  const first = applyPurchase(intelligentFixture(), input(document, { "line-1": { action: "link", productId: "cover-15pro", conversion: 1, receivedQuantity: 2 } }, true));
  const before = structuredClone(first);
  const changed = { ...document, items: [{ ...document.items[0], quantity: 9 }] };
  expect(() => applyPurchase(first, input(changed, { "line-1": { action: "link", productId: "cover-15pro", conversion: 1, receivedQuantity: 3 } }, true, "qa-altered-source"))).toThrow(/document|orig|alter|difer|conflit/i);
  expect(first).toEqual(before);
});

test("NOM-09 parcial posterior recebe somente remanescente sem recriar cadastro", () => {
  const document = purchaseDocument();
  const first = applyPurchase(intelligentFixture(), input(document, { "line-1": { action: "link", productId: "cover-15pro", conversion: 1, receivedQuantity: 2 } }, true));
  const after = applyPurchase(first, input(document, { "line-1": { action: "link", productId: "cover-15pro", conversion: 1, receivedQuantity: 3 } }, true, "qa-part-2"));
  expect(after.products.find((p) => p.id === "cover-15pro")?.stock).toBe(7);
  expect(after.purchasing?.documents).toHaveLength(1);
  expect(after.purchasing?.receipts).toHaveLength(2);
  expect(() => applyPurchase(after, input(document, { "line-1": { action: "link", productId: "cover-15pro", conversion: 1, receivedQuantity: 1 } }, true, "qa-part-3"))).toThrow();
});

test("NOM-09 compra previamente lançada manualmente exige conciliação, nunca uma segunda entrada", () => {
  const state = intelligentFixture();
  const document = purchaseDocument();
  state.imports = [document.key];
  const before = structuredClone(state);
  expect(() => applyPurchase(state, input(document, { "line-1": { action: "link", productId: "cover-15pro", conversion: 1 } }, true))).toThrow(/concilia|revis|utiliz|registr/i);
  expect(state).toEqual(before);
});

test("USO-07/10 total divergente e quantidades inválidas rejeitam o conjunto atomicamente", () => {
  const state = intelligentFixture();
  const before = structuredClone(state);
  const decisions = { "line-1": { action: "link" as const, productId: "cover-15pro", conversion: 1 } };
  for (const document of [purchaseDocument({ totalCents: 1 }), purchaseDocument({ items: [purchaseLine({ quantity: -1 })] }), purchaseDocument({ items: [purchaseLine({ quantity: 1.5 })] })]) {
    expect(() => applyPurchase(state, input(document, decisions, true))).toThrow();
    expect(state).toEqual(before);
  }
});

test("NOM-10 compatibilidade múltipla não multiplica quantidade e cores sortidas não são distribuídas por inferência", () => {
  const state = intelligentFixture();
  const multiple = purchaseDocument({ items: [purchaseLine({ description: "CAPA TRANSPARENTE IPHONE 15 / IPHONE 16", quantity: 3 })] });
  const after = applyPurchase(state, input(multiple, { "line-1": { action: "new", priceCents: 2500 } }, true));
  const created = after.products.find((p) => !state.products.some((old) => old.id === p.id))!;
  expect(created.stock).toBe(3);
  expect(created.attributes?.compatibleModels).toHaveLength(2);
  const mixed = buildPurchasePlan(state, purchaseDocument({ items: [purchaseLine({ description: "CAPA IPHONE 15 PRO CORES SORTIDAS" })] }));
  expect(mixed.lines[0].resolution).toBe("review");
});

test("USO-01 plano de 500 vínculos conhecidos resolve o lote sem decidir item por item", () => {
  const state = intelligentFixture();
  const document = purchaseDocument({ items: Array.from({ length: 500 }, (_, i) => purchaseLine({ id: `line-${i}`, code: `000${i}`, quantity: 1 })) });
  state.purchasing = knownPurchasing(document);
  const before = structuredClone(state);
  const plan = buildPurchasePlan(state, document);
  expect(plan.lines).toHaveLength(500);
  expect(plan.lines.every((line) => line.resolution === "known" && line.productId === "cover-15pro")).toBe(true);
  expect(state).toEqual(before);
});

test("persistência v3 preserva legado e extensões válidas sem fabricar movimentos", () => {
  const original = intelligentFixture();
  const legacy = restoreDemoState(original) as IntelligentState;
  expect(legacy.version).toBe(3);
  expect(legacy.products).toEqual(original.products);
  expect(legacy.finance).toEqual(original.finance);
  const document = purchaseDocument();
  const complete = applyPurchase(original, input(document, { "line-1": { action: "link", productId: "cover-15pro", conversion: 1 } }, true));
  const restored = restoreDemoState(JSON.parse(JSON.stringify(complete))) as IntelligentState;
  expect(restored.purchasing).toEqual((complete as IntelligentState).purchasing);
  expect(restored.products).toEqual(complete.products);
  expect(restored.finance).toEqual(original.finance);
});

test("persistência rejeita extensão de compras adulterada sem consertar silenciosamente", () => {
  const document = purchaseDocument();
  const valid = knownPurchasing(document);
  for (const purchasing of [null, {}, { ...valid, links: [{ ...valid.links[0], conversion: 0 }] }, { ...valid, links: [{ ...valid.links[0], productId: "missing-product" }] }]) {
    const candidate = { ...intelligentFixture(), purchasing };
    const before = JSON.stringify(candidate);
    expect(() => restoreDemoState(candidate)).toThrow();
    expect(JSON.stringify(candidate)).toBe(before);
  }
});

test("USO-03 domínio impede vender produto com preço pendente mesmo que o campo numérico seja zero", () => {
  const state = intelligentFixture();
  const product = state.products.find((p) => p.id === "cover-15pro")!;
  product.price = 0;
  product.pricePending = true;
  const sale = { id: "sale-pending", number: 0, customerId: "c1", items: [{ productId: product.id, quantity: 1, unitPrice: 0 }], status: "confirmed" as const, date: "2026-10-23", total: 0 };
  expect(() => assertSaleEligible(state, sale)).toThrow(/preço|preco|pendente/i);
});

test("USO-03 domínio permite preço definido e mantém compatibilidade com zero legado explicitamente não pendente", () => {
  const state = intelligentFixture();
  const product = state.products.find((p) => p.id === "cover-15pro")!;
  const sale = { id: "sale-defined", number: 0, customerId: "c1", items: [{ productId: product.id, quantity: 1, unitPrice: 2500 }], status: "confirmed" as const, date: "2026-10-23", total: 2500 };
  expect(() => assertSaleEligible(state, sale)).not.toThrow();
  product.price = 0;
  expect(() => assertSaleEligible(state, { ...sale, items: [{ ...sale.items[0], unitPrice: 0 }], total: 0 })).not.toThrow();
});

test("venda conserva bloqueios de quantidade, estoque, consumidor e total incoerentes", () => {
  const state = intelligentFixture();
  const sale = { id: "sale-check", number: 0, customerId: "c1", items: [{ productId: "cover-15pro", quantity: 1, unitPrice: 2500 }], status: "confirmed" as const, date: "2026-10-23", total: 2500 };
  expect(() => assertSaleEligible(state, sale)).not.toThrow();
  for (const invalid of [{ ...sale, customerId: "missing" }, { ...sale, total: 1 }, { ...sale, items: [{ ...sale.items[0], quantity: 2 }], total: 5000 }, { ...sale, items: [{ ...sale.items[0], quantity: 0 }] }, { ...sale, items: [{ ...sale.items[0], quantity: 1.5 }] }]) {
    expect(() => assertSaleEligible(state, invalid)).toThrow();
  }
});
