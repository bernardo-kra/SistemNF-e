import { notFound } from "next/navigation";
import { Dashboard } from "@/features/dashboard";
import { ProductsPage } from "@/features/products";
import { CustomersPage } from "@/features/customers";
import { OrdersPage } from "@/features/service-orders";
import { SalesPage, FinancePage, FiscalPage } from "@/features/commercial";
import { PartnersPage, SettingsPage } from "@/features/settings";
import { ReportsPage } from "@/features/reports";
import { DiagnosticsPage } from "@/features/diagnostics";
import { XmlImportPage } from "@/features/xml-import";
import { FiscalConfigurationPage } from "@/features/fiscal/configuration";
import { FiscalReviewPage } from "@/features/fiscal/review";
import { demoPages } from "../../../../shared/workspace-routes.mjs";
export const dynamicParams = false;
export function generateStaticParams() { return demoPages.map((path) => ({ slug: path.split("/").filter(Boolean) })); }
export default async function DemoPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const path = (await params).slug?.join("/") ?? "";
  switch (path) {
    case "": return <Dashboard />;
    case "produtos": return <ProductsPage />;
    case "estoque": return <ProductsPage inventory />;
    case "clientes": return <CustomersPage />;
    case "ordens": return <OrdersPage />;
    case "vendas": return <SalesPage />;
    case "financeiro": return <FinancePage />;
    case "fiscal": return <FiscalPage />;
    case "fiscal/configuracao": return <FiscalConfigurationPage />;
    case "fiscal/revisao": return <FiscalReviewPage />;
    case "parceiros": return <PartnersPage />;
    case "configuracoes": return <SettingsPage />;
    case "relatorios": return <ReportsPage />;
    case "diagnostico": return <DiagnosticsPage />;
    case "importar": return <XmlImportPage />;
    default: notFound();
  }
}
