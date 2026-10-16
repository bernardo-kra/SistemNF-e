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
import {
  Badge,
  EmptyState,
  Field,
  FormActions,
  FormError,
  Modal,
  PageHeader,
  PaginationInfo,
  SearchField,
} from "@/components/ui";

export function ProductsPage({ inventory = false }: { inventory?: boolean }) {
  const { state, saveProduct, receiveStock } = useDemo();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [stockProduct, setStockProduct] = useState<Product | null>(null);
  const [error, setError] = useState("");
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
    setError("");
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
      <section className="panel">
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
        {filtered.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>PRODUTO</th>
                  <th>CATEGORIA</th>
                  <th className="number">
                    {inventory ? "FÍSICO" : "PREÇO DE VENDA"}
                  </th>
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
                    <td className="number strong">
                      {inventory ? p.stock : money(p.price)}
                    </td>
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
                            setError("");
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
                            setError("");
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
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                saveProduct({
                  ...editing,
                  name: String(f.get("name")).trim(),
                  sku: String(f.get("sku")).trim(),
                  category: String(f.get("category")),
                  price: Math.round(Number(f.get("price")) * 100),
                  cost: Math.round(Number(f.get("cost")) * 100),
                  ncm: String(f.get("ncm")).trim(),
                  serialized: f.get("serialized") === "on",
                });
                setEditing(null);
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            <div className="form-grid">
              <Field label="Nome do produto *" className="full">
                <input
                  name="name"
                  required
                  maxLength={100}
                  defaultValue={editing.name}
                />
              </Field>
              <Field label="SKU / código interno *">
                <input
                  name="sku"
                  required
                  maxLength={30}
                  defaultValue={editing.sku}
                />
              </Field>
              <Field label="Categoria">
                <select name="category" defaultValue={editing.category}>
                  {[
                    ...new Set([
                      "Acessórios",
                      "Armazenamento",
                      "Componentes",
                      "Periféricos",
                      "Computadores",
                      editing.category,
                    ]),
                  ].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <Field label="Preço de venda (R$) *">
                <input
                  name="price"
                  type="number"
                  min="0"
                  max="9999999"
                  step="0.01"
                  required
                  defaultValue={editing.price / 100}
                />
              </Field>
              <Field label="Custo de referência (R$)">
                <input
                  name="cost"
                  type="number"
                  min="0"
                  max="9999999"
                  step="0.01"
                  defaultValue={editing.cost / 100}
                />
              </Field>
              <Field label="NCM">
                <input
                  name="ncm"
                  defaultValue={editing.ncm}
                  placeholder="Completar após revisão fiscal"
                  maxLength={8}
                  pattern="[0-9]{8}|"
                />
              </Field>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  name="serialized"
                  defaultChecked={editing.serialized}
                />
                Controlar por número de série
              </label>
            </div>
            <FormError message={error} />
            <FormActions
              onClose={() => setEditing(null)}
              label="Salvar produto"
            />
          </form>
        </Modal>
      )}
      {stockProduct && (
        <Modal
          title="Registrar entrada manual"
          description={stockProduct.name}
          onClose={() => setStockProduct(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                receiveStock(
                  stockProduct.id,
                  Number(f.get("quantity")),
                  String(f.get("reason")),
                );
                setStockProduct(null);
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            <div className="notice notice-info">
              A quantidade será somada ao estoque físico. Esta entrada
              demonstrativa não gera nota fiscal ou conta a pagar.
            </div>
            <Field label="Quantidade recebida *">
              <input
                name="quantity"
                type="number"
                min="1"
                max="100000"
                step="1"
                required
                defaultValue={1}
              />
            </Field>
            <Field label="Motivo / referência *">
              <input
                name="reason"
                required
                maxLength={160}
                placeholder="Ex.: conferência da compra recebida"
              />
            </Field>
            <FormError message={error} />
            <FormActions
              onClose={() => setStockProduct(null)}
              label="Confirmar entrada"
            />
          </form>
        </Modal>
      )}
    </>
  );
}
