import type { Metadata } from "next";
import { Suspense } from "react";
import {
  DetailLoading,
  PermissionNotice,
} from "@/components/common/data-state";
import { SalesBreakdownPage } from "@/components/operations/billing/sales-breakdown-page";
import { requireStaff } from "@/server/auth";

export const metadata: Metadata = { title: "Rincian penjualan" };

export default async function Page() {
  const staff = await requireStaff();

  return staff.role === "admin" || staff.role === "finance" ? (
    <Suspense fallback={<DetailLoading />}>
      <SalesBreakdownPage />
    </Suspense>
  ) : (
    <PermissionNotice />
  );
}
