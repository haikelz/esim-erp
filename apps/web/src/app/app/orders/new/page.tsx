import type { Metadata } from "next";
import { PermissionNotice } from "@/components/common/data-state";
import { OrderForm } from "@/components/operations/orders/order-form";
import { requireStaff } from "@/server/auth";

export const metadata: Metadata = { title: "Buat order" };

export default async function Page() {
  const staff = await requireStaff();

  return staff.role === "admin" || staff.role === "sales" ? (
    <OrderForm />
  ) : (
    <PermissionNotice />
  );
}
