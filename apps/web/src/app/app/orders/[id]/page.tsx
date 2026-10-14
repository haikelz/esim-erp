import { idParamsSchema } from "@esim-erp/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrderDetail } from "@/components/operations/orders/order-detail";
import { requireStaff } from "@/server/auth";

export const metadata: Metadata = { title: "Detail order" };

export default async function Page({ params }: PageProps<"/app/orders/[id]">) {
  const parsed = idParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();

  const staff = await requireStaff();

  return <OrderDetail id={parsed.data.id} role={staff.role} />;
}
