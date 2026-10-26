"use client";

import Link from "next/link";
import { useFinancialDate } from "@/components/use-financial-date";
import {
  Plus,
  ArrowRight,
  ArrowUpRight,
  Wrench,
  Package,
  Clock3,
  Wallet,
  CalendarDays,
  ChevronRight,
  CircleAlert,
  Check,
  ShoppingBag,
  FileText,
  Upload,
  Sparkles,
} from "lucide-react";
import { useDemo } from "@/lib/demo-store";
import { technicianNameKey, techniciansForState } from "@/lib/technicians";
import { money, stages, TODAY, dateLabel } from "@/lib/domain";
import { installmentBalance } from "@/lib/finance/engine";
import { Avatar, Badge, PageHeader, Panel } from "@/components/ui";

export function Dashboard() {
  const { state } = useDemo();
  const financeDay = useFinancialDate(state.finance);
  const active = state.orders.filter((o) => o.stage !== "delivered");
  const pending = active.filter((o) => o.stage === "awaiting_approval");
  const late = active.filter((o) => o.due < TODAY);
  const due = state.finance.installments
    .filter((item) => item.due <= financeDay)
    .reduce((sum, item) => sum + installmentBalance(state, item.id), 0);
  const low = state.products.filter((p) => p.stock - p.reserved < p.minimum);
  const metrics = [
    {
      label: "Ordens em andamento",
      value: active.length.toString().padStart(2, "0"),
      icon: Wrench,
      caption: `${pending.length} aguardando aprovação`,
      className: "blue",
      href: "/ordens/",
    },
    {
      label: "Prontas para retirada",
      value: active
        .filter((o) => o.stage === "ready_for_pickup")
        .length.toString()
        .padStart(2, "0"),
      icon: Package,
      caption: "Equipamentos com testes concluídos",
      className: "green",
      href: "/ordens/",
    },
    {
      label: "Ordens em atraso",
      value: late.length.toString().padStart(2, "0"),
      icon: Clock3,
      caption: "Prazos que precisam de atenção",
      className: "orange",
      href: "/ordens/",
    },
    {
      label: "Parcelas a receber até hoje",
      value: money(due),
      icon: Wallet,
      caption: "Acordos com vencimento financeiro definido",
      className: "purple",
      href: "/financeiro/",
    },
  ];
  return (
    <>
      <PageHeader
        eyebrow="SEU NEGÓCIO EM MOVIMENTO"
        title="Visão geral"
        description="Acompanhe a operação. Cuide do que importa."
        action={
          <>
            <span className="date-pill">
              <CalendarDays size={16} />
              16 de outubro, 2026
            </span>
            <Link href="/ordens/?nova=1" className="button button-primary">
              <Plus size={18} />
              Nova ordem de serviço
            </Link>
          </>
        }
      />
      <section className="welcome-banner">
        <div>
          <span className="welcome-kicker">
            <span />
            TUDO EM UM SÓ LUGAR
          </span>
          <h2>
            Bom dia, André <span className="greeting-dot">.</span>
          </h2>
          <p>
            Sua loja e sua assistência, trabalhando juntas.
            <br className="desktop-break" /> Você tem{" "}
            <strong>
              {pending.length}{" "}
              {pending.length === 1
                ? "orçamento aguardando"
                : "orçamentos aguardando"}{" "}
              aprovação
            </strong>{" "}
            para acompanhar hoje.
          </p>
          <Link href="/ordens/" className="welcome-link">
            Acompanhar minha operação <ArrowRight size={16} />
          </Link>
        </div>
        <div className="banner-illustration" aria-hidden="true">
          <div className="illustration-orbit orbit-one" />
          <div className="illustration-orbit orbit-two" />
          <div className="illustration-card card-back">
            <div className="illustration-icon">
              <ShoppingBag size={22} />
            </div>
            <span>Venda confirmada</span>
            <strong>Mais negócios.</strong>
            <div className="illustration-line" />
            <div className="illustration-line short" />
          </div>
          <div className="illustration-card card-front">
            <span className="illustration-check">
              <Check size={19} />
            </span>
            <span>Serviço concluído</span>
            <strong>Mais tranquilidade.</strong>
            <div className="mini-progress">
              <span />
            </div>
            <small>Etapas conectadas, do início ao fim.</small>
          </div>
          <div className="floating-spark">
            <Sparkles size={20} />
          </div>
        </div>
      </section>
      <section className="metrics-grid" aria-label="Indicadores da operação">
        {metrics.map((metric) => (
          <Link href={metric.href} className="metric-card" key={metric.label}>
            <div className="metric-top">
              <span>{metric.label}</span>
              <span className={`metric-icon ${metric.className}`}>
                <metric.icon size={19} />
              </span>
            </div>
            <strong className="metric-value">{metric.value}</strong>
            <div className="metric-bottom">
              <span>{metric.caption}</span>
              <ArrowUpRight size={15} />
            </div>
          </Link>
        ))}
      </section>
      <div className="dashboard-main-grid">
        <Panel
          title="Ordens de serviço"
          subtitle="Os próximos passos da sua assistência"
          href="/ordens/"
          linkLabel="Ver todas"
        >
          <div className="table-scroll">
            <table className="orders-table dashboard-table">
              <thead>
                <tr>
                  <th>ORDEM / EQUIPAMENTO</th>
                  <th>CLIENTE</th>
                  <th>ETAPA</th>
                  <th>PRAZO</th>
                  <th>
                    <span className="sr-only">Abrir ordem</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {active.slice(0, 5).map((order) => {
                  const customer = state.customers.find(
                    (c) => c.id === order.customerId,
                  );
                  return (
                    <tr key={order.id}>
                      <td>
                        <Link
                          href={`/ordens/?os=${order.id}`}
                          className="order-cell"
                        >
                          <span className="device-icon">
                            <Wrench size={17} />
                          </span>
                          <span>
                            <strong>
                              #{order.number}{" "}
                              <span>{order.equipment.split(" · ")[0]}</span>
                            </strong>
                            <small>{order.serial}</small>
                          </span>
                        </Link>
                      </td>
                      <td>
                        <span className="customer-name">{customer?.name}</span>
                      </td>
                      <td>
                        <Badge tone={stages[order.stage].tone}>
                          {stages[order.stage].label}
                        </Badge>
                      </td>
                      <td>
                        <span
                          className={order.due < TODAY ? "overdue" : "due-date"}
                        >
                          {order.due < TODAY ? (
                            <>
                              <span className="status-dot" />
                              Atrasado
                            </>
                          ) : order.due === TODAY ? (
                            "Hoje"
                          ) : (
                            dateLabel(order.due)
                          )}
                        </span>
                      </td>
                      <td>
                        <Link
                          className="row-arrow"
                          href={`/ordens/?os=${order.id}`}
                          aria-label={`Abrir OS ${order.number}`}
                        >
                          <ChevronRight size={17} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="panel-footer">
            <span>
              <span className="status-dot" />
              {active.length} ordens ativas na assistência
            </span>
            <Link href="/ordens/">
              Acessar assistência <ArrowRight size={14} />
            </Link>
          </div>
        </Panel>
        <Panel
          title="Precisa de atenção"
          subtitle="Resolva uma pendência por vez"
          className="attention-panel"
        >
          <Link href="/fiscal/" className="attention-item">
            <span className="attention-icon danger">
              <FileText size={19} />
            </span>
            <div>
              <strong>Documento fiscal pendente</strong>
              <p>Confira o cadastro e a situação da nota.</p>
              <span>
                Revisar documento <ArrowUpRight size={13} />
              </span>
            </div>
          </Link>
          <Link href="/estoque/" className="attention-item">
            <span className="attention-icon warning">
              <Package size={19} />
            </span>
            <div>
              <strong>{low.length} produtos com estoque baixo</strong>
              <p>Evite faltar uma peça na próxima venda.</p>
              <span>
                Conferir estoque <ArrowUpRight size={13} />
              </span>
            </div>
          </Link>
          <Link href="/ordens/" className="attention-item">
            <span className="attention-icon info">
              <Clock3 size={19} />
            </span>
            <div>
              <strong>
                {late.length}{" "}
                {late.length === 1
                  ? "ordem com prazo vencido"
                  : "ordens com prazo vencido"}
              </strong>
              <p>Revise a previsão e alinhe com o cliente.</p>
              <span>
                Acompanhar ordens <ArrowUpRight size={13} />
              </span>
            </div>
          </Link>
          <div className="attention-note">
            <CircleAlert size={15} />
            <span>Um detalhe resolvido faz a operação fluir.</span>
          </div>
        </Panel>
      </div>
      <div className="dashboard-bottom-grid">
        <Panel title="Acesso rápido" subtitle="Menos cliques para a sua rotina">
          <div className="quick-actions">
            <Link href="/vendas/?nova=1">
              <span className="quick-icon blue">
                <ShoppingBag size={21} />
              </span>
              <strong>Nova venda</strong>
              <span>
                Criar pedido <ArrowUpRight size={13} />
              </span>
            </Link>
            <Link href="/clientes/?novo=1">
              <span className="quick-icon purple">
                <Plus size={21} />
              </span>
              <strong>Cadastrar cliente</strong>
              <span>
                Começar um atendimento <ArrowUpRight size={13} />
              </span>
            </Link>
            <Link href="/importar/">
              <span className="quick-icon green">
                <Upload size={21} />
              </span>
              <strong>Importar produtos</strong>
              <span>
                Usar XML da compra <ArrowUpRight size={13} />
              </span>
            </Link>
          </div>
        </Panel>
        <Panel
          title="Sua equipe na assistência"
          subtitle="Responsáveis pelos atendimentos"
        >
          <div className="team-list">
            {techniciansForState(state).map(({ id, name }) => (
              <div key={id}>
                <Avatar name={name} />
                <span>
                  <strong>{name}</strong>
                  <small>
                    {active.filter((o) => technicianNameKey(o.technician) === technicianNameKey(name)).length} ordens
                    em andamento
                  </small>
                </span>
                <Badge tone="success">Na operação</Badge>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </>
  );
}
