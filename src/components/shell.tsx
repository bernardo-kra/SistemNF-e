"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  ShoppingBag,
  Wrench,
  UsersRound,
  Package,
  Layers3,
  Handshake,
  Wallet,
  FileText,
  Settings2,
  CircleHelp,
  ChevronDown,
  Bell,
  Search,
  Menu,
  X,
  ArrowUpRight,
  LogOut,
  Building2,
  Command,
  Plus,
} from "lucide-react";
import { useDemo } from "@/lib/demo-store";
import { matches } from "@/lib/domain";
import { Avatar, Modal } from "./ui";

const groups = [
  {
    title: "OPERAÇÃO",
    items: [
      { href: "/", label: "Visão geral", icon: LayoutDashboard },
      { href: "/vendas/", label: "Vendas", icon: ShoppingBag },
      { href: "/ordens/", label: "Ordens de serviço", icon: Wrench },
      { href: "/clientes/", label: "Clientes", icon: UsersRound },
    ],
  },
  {
    title: "GESTÃO",
    items: [
      { href: "/produtos/", label: "Produtos", icon: Package },
      { href: "/estoque/", label: "Estoque", icon: Layers3 },
      { href: "/parceiros/", label: "Parceiros", icon: Handshake },
      { href: "/financeiro/", label: "Financeiro", icon: Wallet },
      { href: "/fiscal/", label: "Documentos fiscais", icon: FileText },
    ],
  },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { state, notify, storageAvailable } = useDemo();
  const [mobile, setMobile] = useState(false);
  const [search, setSearch] = useState(false);
  const [query, setQuery] = useState("");
  const [notifications, setNotifications] = useState(false);
  const [profile, setProfile] = useState(false);
  const [help, setHelp] = useState(false);
  useEffect(() => {
    setMobile(false);
    setNotifications(false);
    setProfile(false);
  }, [path]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "k") {
        event.preventDefault();
        setSearch((value) => !value);
      }
      if (event.key === "Escape") {
        setNotifications(false);
        setProfile(false);
        setMobile(false);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  const go = (href: string) => {
    setSearch(false);
    setQuery("");
    if (href.split("?")[0] === path) window.location.assign(href);
    else router.push(href);
  };
  const activeLabel =
    groups.flatMap((g) => g.items).find((item) => item.href === path)?.label ||
    (path.includes("importar") ? "Importação de produtos" : "Configurações");
  return (
    <div className="application">
      <a className="skip-link" href="#main-content">
        Ir para o conteúdo
      </a>
      {mobile && (
        <button
          className="sidebar-backdrop"
          aria-label="Fechar navegação"
          onClick={() => setMobile(false)}
        />
      )}
      <aside
        className={`sidebar ${mobile ? "is-open" : ""}`}
        aria-label="Navegação principal"
      >
        <Link href="/" className="brand">
          <span className="brand-mark">
            <Layers3 size={23} strokeWidth={2} />
          </span>
          <span>
            sistem<span className="brand-period">.</span>
          </span>
        </Link>
        <div className="workspace-select">
          <span className="company-icon">
            <Building2 size={19} />
          </span>
          <div>
            <strong>Eletrônica Central</strong>
            <span>Unidade principal</span>
          </div>
          <ChevronDown size={14} />
        </div>
        <nav>
          {groups.map((group) => (
            <div className="nav-group" key={group.title}>
              <span className="nav-group-label">{group.title}</span>
              {group.items.map((item) => {
                const active = path === item.href;
                return (
                  <Link
                    className={`nav-item ${active ? "active" : ""}`}
                    href={item.href}
                    key={item.href}
                    aria-current={active ? "page" : undefined}
                  >
                    <item.icon size={19} />
                    <span>{item.label}</span>
                    {item.href === "/ordens/" && (
                      <span className="nav-count">
                        {
                          state.orders.filter((o) => o.stage !== "delivered")
                            .length
                        }
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="plan-card">
            <div>
              <span className="plan-spark">✦</span>
              <strong>Seu negócio, conectado.</strong>
            </div>
            <p>Vendas e assistência no mesmo lugar.</p>
            <Link href="/configuracoes/">
              Conhecer a plataforma <ArrowUpRight size={14} />
            </Link>
          </div>
          <Link
            className={`nav-item ${path === "/configuracoes/" ? "active" : ""}`}
            href="/configuracoes/"
          >
            <Settings2 size={18} />
            Configurações
          </Link>
          <button className="nav-item" onClick={() => setHelp(true)}>
            <CircleHelp size={18} />
            Central de ajuda
            <ArrowUpRight size={14} className="push-right" />
          </button>
          <div className="sidebar-version">
            <span className="status-dot" />
            Ambiente de demonstração<span>v0.1</span>
          </div>
        </div>
      </aside>
      <div className="app-body">
        <header className="topbar">
          <div className="topbar-location">
            <button
              className="icon-button mobile-toggle"
              aria-label="Abrir navegação"
              onClick={() => setMobile(true)}
            >
              <Menu size={22} />
            </button>
            <span className="breadcrumb-home">Área de trabalho</span>
            <span className="breadcrumb-separator">/</span>
            <strong>{activeLabel}</strong>
          </div>
          <div className="topbar-actions">
            <button className="global-search" onClick={() => setSearch(true)}>
              <Search size={16} />
              <span>Buscar na plataforma</span>
              <kbd>⌘ K</kbd>
            </button>
            <span className="demo-tag">
              <span />
              Demonstração
            </span>
            <div className="popover-anchor">
              <button
                className="icon-button notification-trigger"
                aria-label="Notificações"
                aria-expanded={notifications}
                onClick={() => {
                  setNotifications(!notifications);
                  setProfile(false);
                }}
              >
                <Bell size={19} />
                <span />
              </button>
              {notifications && (
                <div className="popover notification-popover">
                  <h3>Precisa da sua atenção</h3>
                  <Link href="/ordens/">
                    Orçamentos aguardando aprovação <ArrowUpRight size={14} />
                  </Link>
                  <Link href="/estoque/">
                    Produtos com estoque baixo <ArrowUpRight size={14} />
                  </Link>
                  <Link href="/fiscal/">
                    Pendência fiscal demonstrativa <ArrowUpRight size={14} />
                  </Link>
                </div>
              )}
            </div>
            <div className="topbar-divider" />
            <div className="popover-anchor">
              <button
                className="profile-button"
                aria-label="Menu do usuário André Martins"
                aria-expanded={profile}
                onClick={() => {
                  setProfile(!profile);
                  setNotifications(false);
                }}
              >
                <Avatar name="André Martins" />
                <span>
                  <strong>André Martins</strong>
                  <small>Administrador</small>
                </span>
                <ChevronDown size={14} />
              </button>
              {profile && (
                <div className="popover profile-popover">
                  <Link href="/configuracoes/">Configurações da empresa</Link>
                  <Link href="/entrar/">
                    <LogOut size={16} />
                    Sair da demonstração
                  </Link>
                </div>
              )}
            </div>
          </div>
        </header>
        <main id="main-content" className="main-content">
          {!storageAvailable && (
            <div className="notice notice-warning">
              Seu navegador não permite salvar os dados. As alterações ficam
              disponíveis somente nesta sessão.
            </div>
          )}
          {children}
        </main>
        <footer className="app-footer">
          <span>© 2026 Sistem · Gestão e assistência</span>
          <span>
            Dados fictícios <span className="footer-dot">·</span> Nenhuma
            emissão fiscal real
          </span>
        </footer>
      </div>
      {search && (
        <Modal
          title="Buscar na plataforma"
          description="Encontre clientes, produtos e ordens de serviço."
          onClose={() => setSearch(false)}
        >
          <label className="search-field search-large">
            <Search size={20} />
            <span className="sr-only">Buscar na plataforma</span>
            <input
              autoFocus
              placeholder="Nome, produto, equipamento ou série…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="search-results">
            {query.trim() ? (
              <>
                {state.orders
                  .filter((o) =>
                    matches(`${o.number} ${o.equipment} ${o.serial}`, query),
                  )
                  .slice(0, 4)
                  .map((o) => (
                    <button
                      key={o.id}
                      onClick={() => go(`/ordens/?os=${o.id}`)}
                    >
                      <Wrench size={18} />
                      <span>
                        <strong>OS #{o.number}</strong>
                        <small>{o.equipment}</small>
                      </span>
                      <ArrowUpRight size={16} />
                    </button>
                  ))}
                {state.products
                  .filter((p) => matches(`${p.name} ${p.sku}`, query))
                  .slice(0, 4)
                  .map((p) => (
                    <button
                      key={p.id}
                      onClick={() =>
                        go(`/produtos/?q=${encodeURIComponent(p.sku)}`)
                      }
                    >
                      <Package size={18} />
                      <span>
                        <strong>{p.name}</strong>
                        <small>{p.sku}</small>
                      </span>
                      <ArrowUpRight size={16} />
                    </button>
                  ))}
                {state.customers
                  .filter((c) => matches(c.name, query))
                  .slice(0, 4)
                  .map((c) => (
                    <button
                      key={c.id}
                      onClick={() =>
                        go(`/clientes/?q=${encodeURIComponent(c.name)}`)
                      }
                    >
                      <UsersRound size={18} />
                      <span>
                        <strong>{c.name}</strong>
                        <small>{c.email}</small>
                      </span>
                      <ArrowUpRight size={16} />
                    </button>
                  ))}
                {!state.orders.some((o) =>
                  matches(`${o.number} ${o.equipment} ${o.serial}`, query),
                ) &&
                  !state.products.some((p) =>
                    matches(`${p.name} ${p.sku}`, query),
                  ) &&
                  !state.customers.some((c) => matches(c.name, query)) && (
                    <p className="muted">Nenhum resultado para esta busca.</p>
                  )}
              </>
            ) : (
              <div className="search-hint">
                <Command size={24} />
                <p>Comece digitando para encontrar um registro.</p>
              </div>
            )}
          </div>
        </Modal>
      )}
      {help && (
        <Modal
          title="Conheça seu protótipo"
          description="Um espaço para testar a rotina da loja."
          onClose={() => setHelp(false)}
        >
          <div className="help-content">
            <p>
              Cadastre produtos e clientes, abra uma ordem de serviço e percorra
              as etapas até a entrega. Em Produtos, experimente a importação
              assistida de XML.
            </p>
            <p>
              As alterações ficam neste navegador. Use Configurações para
              restaurar os exemplos. Não há autenticação, banco de dados ou
              emissão fiscal reais.
            </p>
            <Link
              className="button button-primary"
              href="/ordens/"
              onClick={() => setHelp(false)}
            >
              <Plus size={17} />
              Explorar ordens de serviço
            </Link>
          </div>
        </Modal>
      )}
    </div>
  );
}
