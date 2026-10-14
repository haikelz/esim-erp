import type { Metadata } from "next";
import { Suspense } from "react";
import {
  DetailLoading,
  PermissionNotice,
} from "@/components/common/data-state";
import { StaffPage } from "@/components/operations/staff/staff-page";
import { requireStaff } from "@/server/auth";

export const metadata: Metadata = { title: "Administrasi staf" };

export default async function Page() {
  const staff = await requireStaff();

  return staff.role === "admin" ? (
    <Suspense fallback={<DetailLoading />}>
      <StaffPage currentStaffId={staff.id} />
    </Suspense>
  ) : (
    <PermissionNotice />
  );
}
