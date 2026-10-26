import { LoginPage } from "@/features/settings";
import { DemoProvider } from "@/lib/demo-store";
export default function Page() {
  return <DemoProvider><LoginPage /></DemoProvider>;
}
