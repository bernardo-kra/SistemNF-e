"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Plus,
  ShoppingBag,
  CheckCircle2,
  Clock3,
} from "lucide-react";
import { useDemo } from "@/lib/demo-store";
import { SaleEditor } from "@/components/sale-editor";
import {
  dateLabel,
  matches,
  money,
} from "@/lib/domain";
import {
  Badge,
  EmptyState,
  FormError,
  Modal,
  PageHeader,
  PaginationInfo,
  SearchField,
} from "@/components/ui";

export { FinancePage } from "./finance/page";

export function SalesPage() {
  const { state, hydrated, deliverSale } = useDemo();
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const openSale = () => { setError(""); setCreating(true); };
  const closeSale = () => setCreating(false);
  useEffect(() => {
    if (hydrated && new URLSearchParams(window.location.search).has("nova")) openSale();
  }, [hydrated]);
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
            onClick={openSale}
            disabled={!hydrated}
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
        Confirme os produtos juntos para reservar. Entrega, recebimento e preparação fiscal têm ações próprias.
        Produtos com controle individual de série continuam bloqueados neste recorte.
      </div>
      {creating && <Modal title="Nova venda" description="Confira os produtos e confirme o pedido para reservar suas quantidades." wide onClose={closeSale}>
        <SaleEditor onSaved={closeSale} onCancel={closeSale} />
      </Modal>}
    </>
  );
}

export { FiscalDocumentsPage as FiscalPage } from "./fiscal/documents";
