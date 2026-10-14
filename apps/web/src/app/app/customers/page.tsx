import type { Metadata } from "next";
import { Suspense } from "react";
import {
  DetailLoading,
  PermissionNotice,
} from "@/components/common/data-state";
import { CustomersPage } from "@/components/operations/customers/customers-page";
import { requireStaff } from "@/server/auth";

export const metadata: Metadata = { title: "Pelanggan" };

export default async function Page() {
  const staff = await requireStaff();

  return staff.role === "admin" || staff.role === "sales" ? (
    <Suspense fallback={<DetailLoading />}>
      <CustomersPage />
    </Suspense>
  ) : (
    <PermissionNotice />
  );
}
