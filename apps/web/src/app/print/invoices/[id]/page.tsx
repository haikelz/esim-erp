import { idParamsSchema, invoiceDetailSchema } from "@esim-erp/contracts";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { PermissionNotice } from "@/components/common/data-state";
import { InvoicePrint } from "@/components/operations/billing/invoice-print";
import { HttpError } from "@/lib/http";
import { requireStaff, SESSION_COOKIE } from "@/server/auth";
import { backendJson, backendRequest } from "@/server/backend";

export const metadata: Metadata = { title: "Cetak invoice" };

export default async function Page({
  params,
}: PageProps<"/print/invoices/[id]">) {
  const parsed = idParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();

  const staff = await requireStaff();
  if (staff.role !== "admin" && staff.role !== "finance")
    return <PermissionNotice />;

  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/auth/login");

  try {
    const detail = await backendJson(
      await backendRequest(`/api/invoices/${parsed.data.id}`, {}, token),
      invoiceDetailSchema,
    );

    return <InvoicePrint detail={detail} />;
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) notFound();
    throw error;
  }
}
