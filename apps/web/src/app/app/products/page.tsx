import type { Metadata } from "next";
import { Suspense } from "react";
import { ProductsPage } from "@/components/operations/products/products-page";
import { requireStaff } from "@/server/auth";

export const metadata: Metadata = { title: "Paket & supplier" };

export default async function Page() {
  const staff = await requireStaff();

  return (
    <Suspense>
      <ProductsPage role={staff.role} />
    </Suspense>
  );
}
