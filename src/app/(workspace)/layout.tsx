import { Shell } from "@/components/shell";
import { DemoProvider } from "@/lib/demo-store";
export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DemoProvider><Shell>{children}</Shell></DemoProvider>;
}
