"use client";
import { Field } from "@/components/ui";
import { money } from "@/lib/domain";
import { parseLiveMoney } from "./finance-live";
import op from "./operations-page.module.css";

export function saleLineAmounts(unitPriceCents: number, quantity: number, discount?: string) {
  const grossCents = unitPriceCents * quantity;
  if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0 || !Number.isSafeInteger(quantity) || quantity <= 0 || !Number.isSafeInteger(grossCents)) throw new Error("Confira o preço e a quantidade do item.");
  const discountCents = discount === undefined || discount.trim() === "" ? 0 : parseLiveMoney(discount);
  if (discountCents > grossCents) throw new Error("O desconto não pode superar o valor do item.");
  return { grossCents, discountCents, totalCents: grossCents - discountCents };
}

export function SaleItemPricing({ index, unitPriceCents, quantity, discount, canDiscount, onDiscount }: {
  index: number; unitPriceCents: number | null; quantity: number; discount?: string; canDiscount: boolean; onDiscount: (value: string | undefined) => void;
}) {
  let amounts: ReturnType<typeof saleLineAmounts> | undefined, error = "";
  if (unitPriceCents !== null) { try { amounts = saleLineAmounts(unitPriceCents, quantity, discount); } catch (failure) { error = (failure as Error).message; } }
  return <div className={op.salePricing}>
    <p>Preço unitário: {unitPriceCents === null ? "Pendente" : money(unitPriceCents)} · Bruto: {amounts ? money(amounts.grossCents) : "Confira o item"}</p>
    {canDiscount && (discount === undefined ? <button type="button" onClick={() => onDiscount("0")}>Dar desconto ao item {index}</button> : <>
      <Field label={`Desconto total do item ${index} (R$)`}><input inputMode="decimal" value={discount} aria-invalid={Boolean(error)} aria-describedby={`sale-discount-help-${index}`} onChange={(event) => onDiscount(event.target.value)} /></Field>
      <small id={`sale-discount-help-${index}`}>Abatimento sobre o total desta linha, sem multiplicar pela quantidade.{error && ` ${error}`}</small>
      <button type="button" onClick={() => onDiscount(undefined)}>Remover desconto do item {index}</button>
    </>)}
    <strong data-testid={`sale-item-total-${index}`}>Subtotal do item: {amounts ? money(amounts.totalCents) : "Confira o item"}</strong>
  </div>;
}

export function SaleTotals({ grossCents, discountCents, totalCents }: { grossCents: number; discountCents: number; totalCents: number }) {
  return <div className={op.saleTotals} data-testid="sale-totals"><span>Subtotal bruto: {money(grossCents)}</span><span>Descontos: {money(discountCents)}</span><strong>Total: {money(totalCents)}</strong></div>;
}
