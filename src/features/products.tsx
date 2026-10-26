"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Plus,
  Upload,
  Package,
  Pencil,
  SlidersHorizontal,
  Boxes,
  ScanLine,
} from "lucide-react";
import { useDemo, uid } from "@/lib/demo-store";
import { matches, money, type Product } from "@/lib/domain";
import { ProductEditor, StockEntryEditor } from "@/components/contextual-catalog";
import { ProductProfit } from "@/components/product-profit";
import { BulkPricingEditor } from "@/components/bulk-pricing-editor";
import {
  Badge,
  EmptyState,
  Modal,
  PageHeader,
  PaginationInfo,
  SearchField,
} from "@/components/ui";

export function ProductsPage({ inventory = false }: { inventory?: boolean }) {
  const { state } = useDemo();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [stockProduct, setStockProduct] = useState<Product | null>(null);
  const [pricing, setPricing] = useState(false);
  useEffect(() => {
    setQuery(new URLSearchParams(window.location.search).get("q") || "");
  }, []);
  const filtered = state.products.filter(
    (p) =>
      matches(`${p.name} ${p.sku}`, query) &&
      (!category || p.category === category) &&
      (!lowOnly || p.stock - p.reserved < p.minimum),
  );
  const openNew = () => {
    setEditing({
      id: uid(),
      sku: "",
      name: "",
      category: "Acessórios",
      unit: "UN",
      cost: 0,
      price: 0,
      stock: 0,
      reserved: 0,
      minimum: 2,
      serialized: false,
      ncm: "",
    });
  };
  return (
    <>
      <PageHeader
        eyebrow="CATÁLOGO E DISPONIBILIDADE"
        title={inventory ? "Estoque" : "Produtos"}
        description={
          inventory
            ? "Cada entrada, reserva e saída no seu lugar."
            : "Organize o que sua loja vende e sua assistência utiliza."
        }
        action={
          <>
            {!inventory && <button className="button button-secondary" onClick={() => setPricing(true)}>Definir preços em lote</button>}
            <Link className="button button-secondary" href="/importar/">
              <Upload size={17} />
              Importar XML
            </Link>
            <button className="button button-primary" onClick={openNew}>
              <Plus size={18} />
              Novo produto
            </button>
          </>
        }
      />
      <div className="summary-strip">
        <div>
          <span className="summary-icon blue">
            <Package size={20} />
          </span>
          <span>
            <small>Produtos no catálogo</small>
            <strong>{state.products.length}</strong>
          </span>
        </div>
        <div>
          <span className="summary-icon green">
            <Boxes size={20} />
          </span>
          <span>
            <small>Unidades disponíveis</small>
            <strong>
              {state.products.reduce((n, p) => n + p.stock - p.reserved, 0)}
            </strong>
          </span>
        </div>
        <div>
          <span className="summary-icon orange">
            <SlidersHorizontal size={20} />
          </span>
          <span>
            <small>Abaixo do mínimo</small>
            <strong>
              {
                state.products.filter((p) => p.stock - p.reserved < p.minimum)
                  .length
              }{" "}
              produtos
            </strong>
          </span>
        </div>
      </div>
      <section className={`panel${inventory ? "" : " products-catalog"}`}>
        <div className="list-toolbar">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Buscar por nome ou SKU…"
          />
          <div className="toolbar-right">
            <label className="sr-only" htmlFor="category-filter">
              Filtrar categoria
            </label>
            <select
              id="category-filter"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">Todas as categorias</option>
              {[...new Set(state.products.map((p) => p.category))].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <button
              className={`button button-secondary ${lowOnly ? "selected" : ""}`}
              aria-pressed={lowOnly}
              onClick={() => setLowOnly(!lowOnly)}
            >
              <SlidersHorizontal size={16} />
              Estoque baixo
            </button>
          </div>
        </div>
        {!inventory && <p className="product-pricing-note">Valores por unidade. Compra: referência do cadastro. Lucro estimado antes de impostos, taxas e outras despesas; margem sobre a venda.</p>}
        {filtered.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>PRODUTO</th>
                  <th>CATEGORIA</th>
                  {!inventory && <th className="number">PREÇO DE COMPRA</th>}
                  <th className="number">
                    {inventory ? "FÍSICO" : "PREÇO DE VENDA"}
                  </th>
                  {!inventory && <th className="number">LUCRO ESTIMADO</th>}
                  <th className="number">RESERVADO</th>
                  <th className="number">DISPONÍVEL</th>
                  <th>SITUAÇÃO</th>
                  <th>
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div className="product-cell">
                        <span className="product-icon">
                          <Package size={21} />
                        </span>
                        <span>
                          <strong>{p.name}</strong>
                          <small>
                            {p.sku}
                            {p.serialized
                              ? " · Controle por série"
                              : ` · ${p.unit}`}
                          </small>
                        </span>
                      </div>
                    </td>
                    <td className="muted">{p.category}</td>
                    {!inventory && <td className="number">{money(p.cost)}</td>}
                    <td className="number strong">
                      {inventory ? p.stock : p.pricePending ? "Preço pendente" : money(p.price)}
                    </td>
                    {!inventory && <td className="number"><ProductProfit cost={p.cost} price={p.pricePending ? null : p.price} /></td>}
                    <td className="number muted">{p.reserved}</td>
                    <td className="number strong">
                      {p.stock - p.reserved}{" "}
                      <span className="muted">{p.unit}</span>
                    </td>
                    <td>
                      <Badge
                        tone={
                          p.stock - p.reserved < p.minimum
                            ? "warning"
                            : "success"
                        }
                      >
                        {p.stock - p.reserved < p.minimum
                          ? "Estoque baixo"
                          : "Disponível"}
                      </Badge>
                    </td>
                    <td>
                      {inventory ? (
                        <button
                          className="button button-small button-secondary"
                          onClick={() => {
                            setStockProduct(p);
                          }}
                        >
                          <Plus size={14} />
                          Entrada
                        </button>
                      ) : (
                        <button
                          className="icon-button"
                          aria-label={`Editar ${p.name}`}
                          onClick={() => {
                            setEditing(p);
                          }}
                        >
                          <Pencil size={16} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState />
        )}
        <PaginationInfo count={filtered.length} noun="produtos" />
      </section>
      {!inventory && (
        <div className="context-tip">
          <span className="quick-icon blue">
            <ScanLine size={22} />
          </span>
          <div>
            <strong>Cadastre mais, digite menos.</strong>
            <p>
              Importe os itens da nota de compra e confira os vínculos antes de
              cadastrar.
            </p>
          </div>
          <Link className="text-link" href="/importar/">
            Conhecer importação <Upload size={15} />
          </Link>
        </div>
      )}
      {editing && (
        <Modal
          title={
            state.products.some((p) => p.id === editing.id)
              ? "Editar produto"
              : "Novo produto"
          }
          description="Cadastro não altera a quantidade em estoque."
          onClose={() => setEditing(null)}
        >
          <ProductEditor
            product={editing}
            onSaved={() => setEditing(null)}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}
      {pricing && <Modal title="Definir preços em lote" description="Confira os novos valores e confirme o conjunto selecionado." wide onClose={() => setPricing(false)}>
        <BulkPricingEditor onSaved={() => setPricing(false)} onCancel={() => setPricing(false)} />
      </Modal>}
      {stockProduct && (
        <Modal
          title="Registrar entrada manual"
          description={stockProduct.name}
          onClose={() => setStockProduct(null)}
        >
          <StockEntryEditor
            product={stockProduct}
            onSaved={() => setStockProduct(null)}
            onCancel={() => setStockProduct(null)}
          />
        </Modal>
      )}
    </>
  );
}
