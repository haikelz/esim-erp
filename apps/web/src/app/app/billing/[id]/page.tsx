import { idParamsSchema } from "@esim-erp/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PermissionNotice } from "@/components/common/data-state";
import { InvoiceDetail } from "@/components/operations/billing/invoice-detail";
import { requireStaff } from "@/server/auth";

export const metadata: Metadata = { title: "Detail invoice" };

export default async function Page({ params }: PageProps<"/app/billing/[id]">) {
  const parsed = idParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();

  const staff = await requireStaff();

  return staff.role === "admin" || staff.role === "finance" ? (
    <InvoiceDetail id={parsed.data.id} />
  ) : (
    <PermissionNotice />
  );
}
