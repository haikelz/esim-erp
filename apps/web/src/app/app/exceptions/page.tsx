import type { Metadata } from "next";
import { Suspense } from "react";
import { DetailLoading } from "@/components/common/data-state";
import { ExceptionsPage } from "@/components/operations/exceptions/exceptions-page";
import { requireStaff } from "@/server/auth";

export const metadata: Metadata = { title: "Pengecualian operasional" };

export default async function Page() {
  const staff = await requireStaff();

  return (
    <Suspense fallback={<DetailLoading />}>
      <ExceptionsPage role={staff.role} />
    </Suspense>
  );
}
