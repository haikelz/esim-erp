import type { Metadata } from "next";
import { Suspense } from "react";
import {
  DetailLoading,
  PermissionNotice,
} from "@/components/common/data-state";
import { AuditPage } from "@/components/operations/audit/audit-page";
import { requireStaff } from "@/server/auth";

export const metadata: Metadata = { title: "Riwayat audit" };

export default async function Page() {
  const staff = await requireStaff();

  return staff.role === "admin" ? (
    <Suspense fallback={<DetailLoading />}>
      <AuditPage />
    </Suspense>
  ) : (
    <PermissionNotice />
  );
}
