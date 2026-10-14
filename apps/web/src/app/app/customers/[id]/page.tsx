import { idParamsSchema } from "@esim-erp/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PermissionNotice } from "@/components/common/data-state";
import { CustomerDetail } from "@/components/operations/customers/customer-detail";
import { requireStaff } from "@/server/auth";

export const metadata: Metadata = { title: "Riwayat pelanggan" };

export default async function Page({
  params,
}: PageProps<"/app/customers/[id]">) {
  const parsed = idParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();

  const staff = await requireStaff();
  if (staff.role !== "admin" && staff.role !== "sales")
    return <PermissionNotice />;

  return <CustomerDetail id={parsed.data.id} />;
}
