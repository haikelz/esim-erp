import type { Metadata } from "next";
import { Suspense } from "react";
import { OrdersPage } from "@/components/operations/orders/orders-page";
import { requireStaff } from "@/server/auth";

export const metadata: Metadata = { title: "Order & fulfillment" };

export default async function Page() {
  const staff = await requireStaff();

  return (
    <Suspense>
      <OrdersPage role={staff.role} />
    </Suspense>
  );
}
