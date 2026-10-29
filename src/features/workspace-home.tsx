"use client";
import Link from "next/link";
import { ShoppingBag, Wrench, UsersRound, Package, Wallet, ClipboardList } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { useWorkspace } from "./workspace-session";
import styles from "./workspace.module.css";
import { BrandingSettings } from "./company-branding";
const actions = [
  { href: "/vendas/?novo=1", label: "Nova venda", permission: "sales.create", description: "Produtos, entrega e condições de pagamento no mesmo atendimento.", icon: ShoppingBag },
  { href: "/ordens/?novo=1", label: "Nova ordem de serviço", permission: "orders.create", description: "Registre o equipamento, o serviço e o técnico responsável.", icon: Wrench },
  { href: "/clientes/?novo=1", label: "Novo cliente", permission: "customers.create", description: "Cadastre o contato para os próximos atendimentos.", icon: UsersRound },
  { href: "/produtos/", label: "Consultar produtos", permission: "products.read", description: "Preços, disponibilidade e histórico do catálogo.", icon: Package },
  { href: "/financeiro/", label: "Receber de um cliente", permission: "finance.receive", description: "Confira as parcelas e registre o valor recebido.", icon: Wallet },
  { href: "/compras/", label: "Conferir compras", permission: "purchases.read", description: "Importação e recebimento do conjunto no estoque.", icon: ClipboardList },
];
export function WorkspaceHome() {
  const { identity, tenant } = useWorkspace(), company = identity!.tenants.find((entry) => entry.id === tenant)!;
  const visible = actions.filter((action) => company.permissions.includes(action.permission));
  return <><PageHeader eyebrow={company.name} title={`Olá, ${identity!.user.name.split(" ")[0]}.`} description="O que vamos fazer hoje? Escolha uma ação ou acesse os módulos pelo menu." />
    <div className={styles.cards}>{visible.map((action) => <Link href={action.href} className={styles.card} key={action.href}><action.icon size={24} /><strong>{action.label}</strong><p>{action.description}</p></Link>)}</div>
    {!visible.length && <p>Consulte os módulos disponíveis no menu. O gestor pode ajustar suas permissões.</p>}</>;
}
export function WorkspacePending({ title }: { title: string }) {
  return <><PageHeader eyebrow="SEU SISTEM" title={title} description="Este recurso ainda não está disponível para a operação da empresa." /><section className={styles.pending}><span className="badge">Em preparação</span><p>Estamos preparando este módulo para trabalhar com os dados da sua empresa. Nenhum resultado demonstrativo é apresentado aqui.</p><Link href="/">Voltar à visão geral</Link></section></>;
}
export function WorkspaceSettings() {
  const { identity, tenant } = useWorkspace(), company = identity!.tenants.find((entry) => entry.id === tenant)!;
  return <><PageHeader eyebrow="SUA EMPRESA" title="Configurações" description="Sua empresa, sua conta e a apresentação das ordens de serviço." /><section className={styles.pending}><h2>{company.name}</h2><p>{identity!.user.name}<br />{identity!.user.email}</p>{company.permissions.includes("team.manage") && <Link href="/acessos/">Gerenciar funcionários e permissões</Link>}<p>As configurações fiscais e os demais ajustes da empresa estão em preparação.</p></section><BrandingSettings tenant={tenant} companyName={company.name} canManage={company.permissions.includes("team.manage")} /></>;
}
