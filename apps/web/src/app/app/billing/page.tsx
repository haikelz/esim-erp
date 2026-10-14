import type { Metadata } from "next";
import { PermissionNotice } from "@/components/common/data-state";
import { BillingPage } from "@/components/operations/billing/billing-page";
import { requireStaff } from "@/server/auth";

export const metadata: Metadata = { title: "Billing & finance" };

export default async function Page() {
  const staff = await requireStaff();

  return staff.role === "admin" || staff.role === "finance" ? (
    <BillingPage />
  ) : (
    <PermissionNotice />
  );
}
