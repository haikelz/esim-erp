import type { Metadata } from "next";
import { DashboardPage } from "@/components/operations/dashboard/dashboard-page";
import { requireStaff } from "@/server/auth";

export const metadata: Metadata = { title: "Ringkasan" };

export default async function Page() {
  const staff = await requireStaff();

  return <DashboardPage role={staff.role} />;
}
