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

export function FinancePage() {
  const { state, receivePayment } = useDemo();
  const [payment, setPayment] = useState<ServiceOrder | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("open");
  const [error, setError] = useState("");
  const orders = state.orders.filter((o) => o.approved);
  const open = orders.reduce((total, o) => total + sumOrder(o) - o.received, 0);
  const received = orders.reduce((total, o) => total + o.received, 0);
  const filtered = orders.filter(
    (o) =>
      matches(
        `${o.number} ${state.customers.find((c) => c.id === o.customerId)?.name}`,
        query,
      ) &&
      (filter === "all" ||
        (filter === "open"
          ? sumOrder(o) > o.received
          : sumOrder(o) === o.received)),
  );
  return (
    <>
      <PageHeader
        eyebrow="CLAREZA PARA DECIDIR"
        title="Financeiro"
        description="Acompanhe os recebimentos da assistência, sem confundir previsão com caixa."
      />
      <div className="summary-strip">
        <div>
          <span className="summary-icon orange">
            <Clock3 size={20} />
          </span>
          <span>
            <small>Saldo a receber</small>
            <strong>{money(open)}</strong>
          </span>
        </div>
        <div>
          <span className="summary-icon green">
            <ArrowDownLeft size={20} />
          </span>
          <span>
            <small>Valor recebido nas OS</small>
            <strong>{money(received)}</strong>
          </span>
        </div>
        <div>
          <span className="summary-icon blue">
            <Wallet size={20} />
          </span>
          <span>
            <small>OS com orçamento aprovado</small>
            <strong>{orders.length} atendimentos</strong>
          </span>
        </div>
      </div>
      <section className="panel">
        <div className="list-toolbar">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Buscar cliente ou ordem…"
          />
          <label className="sr-only" htmlFor="financial-filter">
            Situação financeira
          </label>
          <select
            id="financial-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="open">Em aberto</option>
            <option value="paid">Quitados</option>
            <option value="all">Todos os recebíveis</option>
          </select>
        </div>
        {filtered.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>ORIGEM / CLIENTE</th>
                  <th>PREVISÃO</th>
                  <th className="number">VALOR</th>
                  <th className="number">RECEBIDO</th>
                  <th className="number">SALDO</th>
                  <th>SITUAÇÃO</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <div className="stack-cell">
                        <strong>OS #{o.number}</strong>
                        <small>
                          {
                            state.customers.find((c) => c.id === o.customerId)
                              ?.name
                          }
                        </small>
                      </div>
                    </td>
                    <td>{dateLabel(o.due)}</td>
                    <td className="number">{money(sumOrder(o))}</td>
                    <td className="number muted">{money(o.received)}</td>
                    <td className="number strong">
                      {money(sumOrder(o) - o.received)}
                    </td>
                    <td>
                      <Badge
                        tone={
                          o.received >= sumOrder(o)
                            ? "success"
                            : o.received > 0
                              ? "info"
                              : "warning"
                        }
                      >
                        {o.received >= sumOrder(o)
                          ? "Quitado"
                          : o.received > 0
                            ? "Parcial"
                            : "Em aberto"}
                      </Badge>
                    </td>
                    <td>
                      {o.received < sumOrder(o) && (
                        <button
                          className="button button-small button-secondary"
                          onClick={() => {
                            setError("");
                            setPayment(o);
                          }}
                        >
                          Receber
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="Nenhum recebível nesta seleção"
            text="Orçamentos sem aprovação não geram dívida automaticamente."
          />
        )}
        <PaginationInfo count={filtered.length} noun="recebíveis" />
      </section>
      <div className="notice notice-info">
        Nesta etapa, o financeiro demonstra recebimentos manuais de OS
        aprovadas. Cobrança bancária, parcelas e contas a pagar serão integradas
        nas próximas etapas.
      </div>
      {payment && (
        <Modal
          title="Registrar recebimento"
          description={`OS #${payment.number} · ${state.customers.find((c) => c.id === payment.customerId)?.name}`}
          onClose={() => setPayment(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                receivePayment(
                  payment.id,
                  Math.round(Number(f.get("amount")) * 100),
                  String(f.get("method")),
                );
                setPayment(null);
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            <div className="amount-highlight">
              <span>Saldo a receber</span>
              <strong>{money(sumOrder(payment) - payment.received)}</strong>
            </div>
            <div className="form-grid">
              <Field label="Valor recebido (R$) *">
                <input
                  name="amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={(sumOrder(payment) - payment.received) / 100}
                  defaultValue={(sumOrder(payment) - payment.received) / 100}
                  required
                />
              </Field>
              <Field label="Forma de pagamento">
                <select name="method">
                  <option>Pix</option>
                  <option>Dinheiro</option>
                  <option>Cartão de débito</option>
                  <option>Cartão de crédito</option>
                  <option>Transferência</option>
                </select>
              </Field>
            </div>
            <p className="form-note">
              Registro demonstrativo. Não realiza transação bancária.
            </p>
            <FormError message={error} />
            <FormActions
              onClose={() => setPayment(null)}
              label="Confirmar recebimento"
            />
          </form>
        </Modal>
      )}
    </>
  );
}

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
