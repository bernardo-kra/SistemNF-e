"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Plus,
  ShoppingBag,
  Wallet,
  CheckCircle2,
  Clock3,
  ArrowDownLeft,
} from "lucide-react";
import { useDemo, uid } from "@/lib/demo-store";
import {
  dateLabel,
  matches,
  money,
  sumOrder,
  TODAY,
  type ServiceOrder,
} from "@/lib/domain";
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

export { FinancePage } from "./finance/page";

export function SalesPage() {
  const { state, createSale, deliverSale } = useDemo();
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState("");
  const eligible = state.products.filter(
    (p) => !p.serialized && p.stock - p.reserved > 0,
  );
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("nova")) {
      setCreating(true);
      setProductId(eligible[0]?.id || "");
    }
  }, []);
  const product = state.products.find((p) => p.id === productId);
  const sales = state.sales.filter((s) =>
    matches(
      `${s.number} ${state.customers.find((c) => c.id === s.customerId)?.name}`,
      query,
    ),
  );
  return (
    <>
      <PageHeader
        eyebrow="DA VENDA À ENTREGA"
        title="Vendas"
        description="Organize os pedidos e reserve o que precisa ser entregue."
        action={
          <button
            className="button button-primary"
            onClick={() => {
              setError("");
              setProductId(eligible[0]?.id || "");
              setQuantity(1);
              setCreating(true);
            }}
          >
            <Plus size={18} />
            Nova venda
          </button>
        }
      />
      <div className="summary-strip">
        <div>
          <span className="summary-icon blue">
            <ShoppingBag size={20} />
          </span>
          <span>
            <small>Pedidos registrados</small>
            <strong>{state.sales.length}</strong>
          </span>
        </div>
        <div>
          <span className="summary-icon orange">
            <Clock3 size={20} />
          </span>
          <span>
            <small>Aguardando entrega</small>
            <strong>
              {state.sales.filter((s) => s.status === "confirmed").length}
            </strong>
          </span>
        </div>
        <div>
          <span className="summary-icon green">
            <CheckCircle2 size={20} />
          </span>
          <span>
            <small>Total dos pedidos</small>
            <strong>
              {money(state.sales.reduce((s, x) => s + x.total, 0))}
            </strong>
          </span>
        </div>
      </div>
      <section className="panel">
        <div className="list-toolbar">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Buscar pedido ou cliente…"
          />
          <span className="toolbar-label">
            Estoque reservado na confirmação
          </span>
        </div>
        {sales.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>PEDIDO</th>
                  <th>CLIENTE</th>
                  <th>PRODUTOS</th>
                  <th>DATA</th>
                  <th className="number">TOTAL</th>
                  <th>SITUAÇÃO</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sales.map((s) => {
                  const serial = s.items.some(
                    (i) =>
                      state.products.find((p) => p.id === i.productId)
                        ?.serialized,
                  );
                  return (
                    <tr key={s.id}>
                      <td className="strong">#{s.number}</td>
                      <td>
                        {
                          state.customers.find((c) => c.id === s.customerId)
                            ?.name
                        }
                      </td>
                      <td>
                        <div className="stack-cell">
                          <span>
                            {s.items
                              .map(
                                (i) =>
                                  `${i.quantity} × ${state.products.find((p) => p.id === i.productId)?.name}`,
                              )
                              .join(", ")}
                          </span>
                          {serial && (
                            <small>Conferência de série pendente</small>
                          )}
                        </div>
                      </td>
                      <td>{dateLabel(s.date)}</td>
                      <td className="number strong">{money(s.total)}</td>
                      <td>
                        <Badge
                          tone={s.status === "delivered" ? "success" : "info"}
                        >
                          {s.status === "delivered" ? "Entregue" : "Confirmado"}
                        </Badge>
                      </td>
                      <td>
                        <Link
                          className="button button-small button-secondary"
                          href={`/financeiro/?source=sale:${s.id}`}
                        >
                          Organizar pagamento
                        </Link>
                        <Link
                          className="button button-small button-secondary"
                          href={`/fiscal/?source=sale:${s.id}`}
                        >
                          Preparar fiscal
                        </Link>
                        {s.status !== "delivered" && (
                          <button
                            className="button button-small button-secondary"
                            disabled={serial}
                            title={
                              serial
                                ? "Conferência individual de séries ainda não disponível no protótipo"
                                : undefined
                            }
                            onClick={() => {
                              try {
                                deliverSale(s.id);
                              } catch (err) {
                                setError((err as Error).message);
                              }
                            }}
                          >
                            Entregar
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState />
        )}
        <PaginationInfo count={sales.length} noun="pedidos" />
      </section>
      <FormError message={!creating ? error : ""} />
      <div className="notice notice-info">
        A nova venda demonstra um item por pedido, com reserva e entrega de
        produtos sem controle por série. Conferência individual de séries e
        faturamento serão adicionados depois.
      </div>
      {creating && (
        <Modal
          title="Nova venda"
          description="Confirme o pedido para reservar a quantidade em estoque."
          onClose={() => setCreating(false)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!product) return;
              const f = new FormData(e.currentTarget);
              try {
                createSale({
                  id: uid(),
                  number: 0,
                  customerId: String(f.get("customerId")),
                  items: [{ productId, quantity, unitPrice: product.price }],
                  date: TODAY,
                  status: "confirmed",
                  total: product.price * quantity,
                });
                setCreating(false);
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            <Field label="Cliente *">
              <select name="customerId" required>
                {state.customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Produto *">
              <select
                value={productId}
                required
                onChange={(e) => {
                  setProductId(e.target.value);
                  setQuantity(1);
                }}
              >
                {!eligible.length && (
                  <option value="">Nenhum produto disponível</option>
                )}
                {eligible.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name} · {p.stock - p.reserved} disponíveis
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Quantidade *">
              <input
                name="quantity"
                type="number"
                min="1"
                step="1"
                max={product ? product.stock - product.reserved : 0}
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                required
              />
            </Field>
            <div className="amount-highlight">
              <span>Total do pedido</span>
              <strong>{money((product?.price || 0) * quantity)}</strong>
            </div>
            <FormError message={error} />
            <FormActions
              onClose={() => setCreating(false)}
              label="Confirmar e reservar"
            />
          </form>
        </Modal>
      )}
    </>
  );
}

export { FiscalDocumentsPage as FiscalPage } from "./fiscal/documents";
