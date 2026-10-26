"use client";

import { useEffect, useRef, useState } from "react";
import type { Product } from "@/lib/domain";
import { money } from "@/lib/domain";
import { useDemo } from "@/lib/demo-store";
import { MAX_MARKUP_BASIS_POINTS, MAX_PRODUCT_PRICE, priceWithMarkup } from "@/lib/catalog-pricing";
import { parseMoney } from "@/lib/finance/engine";
import { ProductProfit } from "./product-profit";
import { Field, FormActions, FormError } from "./ui";

const parseAmount = (raw: string, maximum: number) => {
  try {
    const value = parseMoney(raw);
    return value <= maximum ? value : null;
  } catch { return null; }
};

export function BulkPricingEditor({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const { state, setProductPrices } = useDemo();
  // Freeze the reference used by this preview; the command revalidates it before saving.
  const [initial] = useState<Product[]>(() => structuredClone(state.products));
  const [includePriced, setIncludePriced] = useState(false);
  const [markup, setMarkup] = useState("");
  const [manual, setManual] = useState<Record<string, string>>({});
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState("");
  const submitted = useRef(false);
  const markupInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => markupInput.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);
  const basisPoints = parseAmount(markup, MAX_MARKUP_BASIS_POINTS);
  const rows = initial.filter((product) => product.pricePending || includePriced).map((product) => {
    const isManual = Object.hasOwn(manual, product.id);
    let price: number | null = null;
    let hint = "Escolha um acréscimo ou informe o preço.";
    if (isManual) {
      price = parseAmount(manual[product.id], MAX_PRODUCT_PRICE);
      hint = "Informe um preço de 0 a 9.999.999,00, com até duas casas.";
    } else if (!product.cost) {
      hint = "Compra zero: informe o preço ou retire este produto do lote.";
    } else if (basisPoints !== null) {
      try { price = priceWithMarkup(product.cost, basisPoints); }
      catch (failure) { hint = failure instanceof Error ? failure.message : "Confira o preço sugerido."; }
    }
    return { product, price, hint, isManual, selected: !excluded.has(product.id) };
  });
  const selected = rows.filter((row) => row.selected);
  const missing = selected.filter((row) => row.price === null).length;
  const invalidMarkup = markup !== "" && basisPoints === null;
  const canSave = selected.length > 0 && !missing && !invalidMarkup;

  return <form className="bulk-pricing-editor" onSubmit={(event) => {
    event.preventDefault();
    if (submitted.current || !canSave) return;
    try {
      submitted.current = true;
      setProductPrices(selected.map(({ product, price }) => ({
        productId: product.id, expectedCost: product.cost, expectedPrice: product.price,
        expectedPricePending: Boolean(product.pricePending), price: price!,
      })));
      onSaved();
    } catch (failure) {
      submitted.current = false;
      setError(failure instanceof Error ? failure.message : "Não foi possível gravar os preços. Tente novamente.");
    }
  }}>
    <p className="contextual-note">O lote começa com todos os preços pendentes do catálogo e não usa os filtros da lista. Confira a prévia e salve o conjunto uma vez.</p>
    <div className="bulk-pricing-controls">
      <Field label="Acréscimo sobre a compra (%)">
        <input ref={markupInput} type="number" min="0" max="9999.99" step="0.01" value={markup} autoFocus
          placeholder="Informe o percentual" onChange={(event) => setMarkup(event.target.value)} />
      </Field>
      <label className="checkbox-field"><input type="checkbox" checked={includePriced}
        onChange={(event) => setIncludePriced(event.target.checked)} />Incluir produtos já precificados</label>
    </div>
    <p className="bulk-pricing-note">Compra é a referência por unidade do cadastro. Acréscimo de 50% sobre compra de R$ 20,00 sugere venda de R$ 30,00; a margem sobre a venda é 33,33%. Estimativa antes de impostos, taxas e despesas.</p>
    {invalidMarkup && <p className="bulk-pricing-validation">Use um acréscimo de 0 a 9999,99%, com até duas casas decimais.</p>}
    <p className="bulk-pricing-count" aria-live="polite">{selected.length} produtos selecionados · {missing} precisam de preço. A confirmação altera somente seus preços de venda.</p>
    {rows.length ? <div className="table-scroll bulk-pricing-table" role="region" aria-label="Prévia dos preços" tabIndex={0}>
      <table>
        <thead><tr><th>PRODUTO</th><th className="number">COMPRA / UN.</th><th className="number">VENDA ATUAL</th><th>NOVO PREÇO (R$)</th><th className="number">LUCRO ESTIMADO / UN.</th></tr></thead>
        <tbody>{rows.map(({ product, price, hint, isManual, selected: checked }) => <tr key={product.id}>
          <td><label className="bulk-pricing-select"><input type="checkbox" checked={checked} aria-label={`Selecionar ${product.name}`}
            onChange={(event) => setExcluded((previous) => {
              const next = new Set(previous);
              if (event.target.checked) next.delete(product.id); else next.add(product.id);
              return next;
            })} /><span><strong>{product.name}</strong><small>{product.sku}</small></span></label></td>
          <td className="number">{money(product.cost)}</td>
          <td className="number">{product.pricePending ? "Preço pendente" : money(product.price)}</td>
          <td><input aria-label={`Novo preço de ${product.name}`} type="number" min="0" max="9999999" step="0.01"
            value={isManual ? manual[product.id] : price === null ? "" : String(price / 100)} required={checked} disabled={!checked}
            onChange={(event) => { const value = event.target.value; setManual((previous) => ({ ...previous, [product.id]: value })); }} />
            {isManual ? <button type="button" className="text-link bulk-pricing-reset" onClick={() => setManual((previous) => {
              const next = { ...previous }; delete next[product.id]; return next;
            })}>Usar percentual</button> : null}
            {checked && price === null && <small className="bulk-pricing-validation">{hint}</small>}
          </td>
          <td className="number"><ProductProfit cost={product.cost} price={price} /></td>
        </tr>)}</tbody>
      </table>
    </div> : <div className="notice notice-info">Nenhum produto com preço pendente. Para revisar os demais, escolha incluir produtos já precificados.</div>}
    <FormError message={error} />
    <FormActions onClose={onCancel} label="Salvar preços" disabled={!canSave} />
  </form>;
}
