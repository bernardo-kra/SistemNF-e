import { money } from "@/lib/domain";

type ProductProfitProps = {
  cost: number | null;
  price: number | null;
  announce?: boolean;
};

const validCents = (value: number | null): value is number =>
  value !== null && Number.isSafeInteger(value) && value >= 0;

const marginFormat = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Catalog estimate per unit; historical transactions retain their own values. */
export function ProductProfit({ cost, price, announce = false }: ProductProfitProps) {
  const profit = validCents(cost) && validCents(price) ? price - cost : null;
  const margin = profit !== null && price !== null && price > 0 ? profit / price * 100 : null;

  return <div className={`product-profit${profit !== null && profit < 0 ? " product-profit-negative" : ""}`}>
    <output aria-label="Lucro estimado por unidade" aria-live={announce ? "polite" : "off"}>
      {profit === null ? "A calcular" : money(profit)}
    </output>
    <small>{margin === null ? "Margem indisponível" : `Margem de ${marginFormat.format(margin)}%`}</small>
  </div>;
}
