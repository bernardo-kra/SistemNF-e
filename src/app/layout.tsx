import type { Metadata } from "next";
import "./tokens.css";
import "./globals.css";
import { WorkspaceSession } from "@/features/workspace-session";

export const metadata: Metadata = {
  title: "Sistem · Gestão e assistência",
  description:
    "Gestão para lojas de eletrônicos e assistência de TI.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" data-scroll-behavior="smooth">
      <body>
        <WorkspaceSession>{children}</WorkspaceSession>
      </body>
    </html>
  );
}
