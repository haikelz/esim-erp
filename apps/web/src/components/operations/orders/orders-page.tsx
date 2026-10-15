"use client";

import type { StaffRole } from "@esim-erp/contracts";
import { Plus } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/common/page-header";
import { RecordsTable } from "@/components/common/records-table";
import { Button } from "@/components/ui/button";
import { useListQuery } from "@/hooks/list-query";
import { useOrders } from "@/hooks/orders";
import { ORDER_COLUMNS } from "./order-columns";

type OrdersPageProps = { readonly role: StaffRole };

export function OrdersPage({ role }: OrdersPageProps) {
  const list = useListQuery();
  const orders = useOrders(list.query);
  const canCreateOrder = role === "admin" || role === "sales";
  const orderAction = canCreateOrder ? (
    <Button
      nativeButton={false}
      render={<Link href="/app/orders/new" />}
      size="sm"
    >
      <Plus aria-hidden="true" data-icon="inline-start" />
      Buat order
    </Button>
  ) : undefined;

  return (
    <>
      <PageHeader
        action={orderAction}
        description="Pantau pembayaran dan penerbitan profil eSIM."
        title="Order & penerbitan"
      />
      <RecordsTable
        columns={ORDER_COLUMNS}
        emptyAction={orderAction}
        emptyDescription={
          canCreateOrder
            ? "Buat order untuk mencatat penjualan."
            : "Order yang dibuat sales akan muncul di sini."
        }
        error={orders.error}
        isLoading={orders.isPending || orders.isPlaceholderData}
        list={list}
        onRetry={() => {
          void orders.refetch();
        }}
        rows={orders.data?.orders ?? []}
        title="Daftar order"
        total={orders.data?.total ?? 0}
      />
    </>
  );
}
