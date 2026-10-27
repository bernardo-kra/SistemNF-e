"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Building2, LayoutDashboard, ShoppingBag, Wrench, UsersRound, Package, Layers3, Wallet, FileText, Settings2, Menu, LogOut, ClipboardList } from "lucide-react";
import { Avatar, Field } from "@/components/ui";
import { useWorkspace } from "./workspace-session";
import { workspaceReturnPath } from "../../shared/workspace-routes.mjs";
import styles from "./workspace.module.css";

export const workspaceModules = [
  { href: "/", label: "Visão geral", permission: "", icon: LayoutDashboard },
  { href: "/vendas/", label: "Vendas", permission: "sales.read", icon: ShoppingBag },
  { href: "/ordens/", label: "Ordens de serviço", permission: "orders.read", icon: Wrench },
  { href: "/clientes/", label: "Clientes", permission: "customers.read", icon: UsersRound },
  { href: "/produtos/", label: "Produtos", permission: "products.read", icon: Package },
  { href: "/estoque/", label: "Estoque", permission: "stock.read", icon: Layers3 },
  { href: "/compras/", label: "Compras", permission: "purchases.read", icon: ClipboardList },
  { href: "/financeiro/", label: "Financeiro", permission: "finance.read", icon: Wallet },
  { href: "/acessos/", label: "Equipe e acessos", permission: "team.manage", icon: UsersRound },
];
const pending = [{ href: "/fiscal/", label: "Documentos fiscais" }, { href: "/relatorios/", label: "Relatórios" }, { href: "/parceiros/", label: "Parceiros" }];
export function WorkspaceShell({ children }: { children: ReactNode }) {
  const session = useWorkspace(), path = usePathname(), router = useRouter(), [mobile, setMobile] = useState(false);
  const company = session.identity?.tenants.find((entry) => entry.id === session.tenant), rights = company?.permissions ?? [];
  const module = workspaceModules.find((entry) => entry.href === path);
  useEffect(() => {
    if (session.phase === "login") router.replace(`/entrar/?next=${encodeURIComponent(workspaceReturnPath(window.location.pathname + window.location.search))}`);
  }, [session.phase, router]);
  useEffect(() => { setMobile(false); }, [path]);
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === "Escape") setMobile(false); }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, []);
  if (session.phase === "loading" || session.phase === "login") return <main className={styles.connecting}><p role="status">Conectando à sua conta…</p></main>;
  if (session.phase === "error") return <main className={styles.connecting}><h1>Sistem</h1><p role="alert" className="notice notice-warning">{session.error}</p><button className="button button-primary" onClick={() => void session.refresh()}>Tentar novamente</button></main>;
  const title = module?.label ?? (path.startsWith("/fiscal/") ? "Documentos fiscais" : pending.find((entry) => entry.href === path)?.label ?? "Configurações");
  return <div className="application">
    <a className="skip-link" href="#main-content">Ir para o conteúdo</a>
    {mobile && <button className="sidebar-backdrop" aria-label="Fechar navegação" onClick={() => setMobile(false)} />}
    <aside className={`sidebar ${mobile ? "is-open" : ""}`} aria-label="Navegação principal">
      <Link href="/" className="brand"><span className="brand-mark"><Layers3 size={23} /></span><span>sistem<span className="brand-period">.</span></span></Link>
      <div className={styles.company}><Building2 size={20} /><Field label="Empresa"><select aria-label="Empresa" value={session.tenant} onChange={(event) => session.selectCompany(event.target.value)}><option value="">Selecione a empresa</option>{session.identity!.tenants.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></Field></div>
      <nav aria-label="Navegação principal"><div className="nav-group"><span className="nav-group-label">ÁREA DE TRABALHO</span>{workspaceModules.filter((entry) => !entry.permission || rights.includes(entry.permission)).map((entry) => <Link href={entry.href} key={entry.href} className={`nav-item ${path === entry.href ? "active" : ""}`} aria-current={path === entry.href ? "page" : undefined}><entry.icon size={18} /><span>{entry.label}</span></Link>)}</div>
        <div className="nav-group"><span className="nav-group-label">EM PREPARAÇÃO</span>{pending.map((entry) => <Link key={entry.href} href={entry.href} className={`nav-item ${path.startsWith(entry.href) ? "active" : ""}`}><FileText size={18} /><span>{entry.label}</span></Link>)}</div>
      </nav>
      <div className="sidebar-bottom"><Link className="nav-item" href="/configuracoes/"><Settings2 size={18} /><span>Configurações</span></Link><Link prefetch={false} className={styles.demoLink} href="/demo/">Explorar demonstração</Link></div>
    </aside>
    <div className="app-body"><header className="topbar"><div className="topbar-location"><button className={`icon-button ${styles.menu}`} aria-label="Abrir navegação" aria-expanded={mobile} onClick={() => setMobile((value) => !value)}><Menu size={21} /></button><span className="breadcrumb-home">Área de trabalho</span><span className="breadcrumb-separator">/</span><strong>{title}</strong></div>
      <div className={`topbar-actions ${styles.identity}`}><Avatar name={session.identity!.user.name} /><span><strong>{session.identity!.user.name}</strong><small>{company?.name ?? "Escolha a empresa"}</small></span><button className="button button-secondary" disabled={session.signingOut} onClick={() => void session.signOut()}><LogOut size={15} />Sair</button></div>
    </header><main id="main-content" className="main-content">
      {session.error && <p role="alert" className="notice notice-warning">{session.error}</p>}
      {!session.identity!.tenants.length ? <p>Sua conta não possui vínculo ativo com uma empresa.</p> : !session.tenant ? <p>Selecione uma empresa para continuar.</p> : module?.permission && !rights.includes(module.permission) ? <p role="alert">{path === "/acessos/" ? "Seu perfil não permite administrar a equipe." : "Seu perfil não tem permissão para acessar este módulo."}</p> : <div key={`${session.tenant}:${session.epoch}`}>{children}</div>}
    </main><footer className="app-footer"><span>© 2026 Sistem · Gestão e assistência</span><span>{company?.name ?? "Sua empresa"} · Horários de Brasília</span></footer></div>
  </div>;
}
