import { DemoProvider } from "@/lib/demo-store";
import { Shell } from "@/components/shell";
export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return <DemoProvider><Shell>{children}</Shell></DemoProvider>;
}
