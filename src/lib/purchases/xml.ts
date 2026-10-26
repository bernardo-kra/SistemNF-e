import type { PurchaseDocument } from "./types";
import { normalizeDocument } from "../fiscal/identifiers";

const child = (element: Element, tag: string) =>
  element.getElementsByTagNameNS("*", tag)[0]?.textContent?.trim() || "";

/** Lê valores decimais documentados sem multiplicação binária de moeda. */
export function decimalCents(value: string): number {
  if (!/^\d+(?:\.\d+)?$/.test(value))
    throw new Error("Valor monetário inválido no XML.");
  const [whole, fraction = ""] = value.split(".");
  const cents =
    Number(`${whole}${fraction.slice(0, 2).padEnd(2, "0")}`) +
    (Number(fraction[2] || "0") >= 5 ? 1 : 0);
  if (!Number.isSafeInteger(cents))
    throw new Error("Valor monetário fora do limite da demonstração.");
  return cents;
}

export function parsePurchaseXml(text: string): PurchaseDocument {
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error("O arquivo contém declarações XML não permitidas.");
  const parsed = new DOMParser().parseFromString(text, "application/xml");
  if (parsed.getElementsByTagName("parsererror").length)
    throw new Error(
      "Não foi possível ler este XML. Confira se o arquivo está completo.",
    );
  const info = parsed.getElementsByTagNameNS("*", "infNFe")[0];
  if (!info)
    throw new Error("Não encontramos os dados de uma NF-e neste arquivo.");
  const key = info.getAttribute("Id");
  if (!key) throw new Error("O XML não tem identificação do documento.");
  const issuer = info.getElementsByTagNameNS("*", "emit")[0];
  const supplierName = issuer && child(issuer, "xNome");
  if (!supplierName) throw new Error("Fornecedor não informado no XML.");
  const cnpj = normalizeDocument(child(issuer, "CNPJ"));
  const supplierId =
    cnpj ||
    `local-name:${supplierName
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim()}`;
  const lines = Array.from(info.getElementsByTagNameNS("*", "det"));
  if (!lines.length || lines.length > 500)
    throw new Error("Envie um XML com 1 a 500 itens para a demonstração.");
  const items = lines.map((line, index) => {
    const product = line.getElementsByTagNameNS("*", "prod")[0];
    if (!product) throw new Error(`O item ${index + 1} está incompleto.`);
    const description = child(product, "xProd");
    const code = child(product, "cProd");
    const unit = child(product, "uCom");
    const rawQuantity = child(product, "qCom");
    const rawUnitCost = child(product, "vUnCom");
    const quantity = Number(rawQuantity);
    if (
      !description ||
      !code ||
      !unit ||
      !/^\d+(?:\.\d+)?$/.test(rawQuantity) ||
      !Number.isSafeInteger(quantity) ||
      quantity <= 0 ||
      !rawUnitCost
    )
      throw new Error(
        `Revise descrição, código, unidade, quantidade inteira e valor do item ${index + 1}.`,
      );
    const total = child(product, "vProd");
    return {
      id: line.getAttribute("nItem") || String(index + 1),
      code,
      description,
      unit,
      quantity,
      costCents: decimalCents(rawUnitCost),
      ncm: child(product, "NCM"),
      rawQuantity,
      rawUnitCost,
      ...(child(product, "cEAN") ? { gtin: child(product, "cEAN") } : {}),
      ...(total ? { totalCents: decimalCents(total) } : {}),
    };
  });
  const total = info.getElementsByTagNameNS("*", "ICMSTot")[0];
  const totalValue = total && child(total, "vNF");
  // Somente componentes presentes são considerados. Não se inventa uma diferença
  // para fazer um documento divergente parecer conciliado.
  const adjustments = total
    ? ["vFrete", "vSeg", "vOutro", "vIPI", "vST"].reduce(
        (sum, tag) =>
          sum + (child(total, tag) ? decimalCents(child(total, tag)) : 0),
        0,
      ) - (child(total, "vDesc") ? decimalCents(child(total, "vDesc")) : 0)
    : 0;
  return {
    key,
    supplierId,
    supplierName,
    number: child(info, "nNF") || key,
    items,
    originalXml: text,
    ...(totalValue ? { totalCents: decimalCents(totalValue) } : {}),
    ...(adjustments ? { totalsAdjustmentCents: adjustments } : {}),
  };
}
