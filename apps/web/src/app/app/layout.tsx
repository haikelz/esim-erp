import { AppShell } from "@/components/common/app-shell";
import { requireStaff } from "@/server/auth";

export default async function AppLayout({ children }: LayoutProps<"/app">) {
  const staff = await requireStaff();

  return <AppShell staff={staff}>{children}</AppShell>;
}
