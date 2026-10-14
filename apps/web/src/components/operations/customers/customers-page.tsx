"use client";

import type { Customer } from "@esim-erp/contracts";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/common/page-header";
import { RecordsTable } from "@/components/common/records-table";
import type { DataGridFeatures } from "@/components/reui/data-grid/data-grid";
import { Button } from "@/components/ui/button";
import { useCustomers } from "@/hooks/customers";
import { useListQuery } from "@/hooks/list-query";
import { formatDate, formatIdr } from "@/lib/format";

const CUSTOMER_COLUMNS: ColumnDef<DataGridFeatures, Customer>[] = [
  {
    accessorKey: "name",
    header: "Pelanggan",
    size: 200,
    cell: ({ row }) => (
      <Link
        className="font-medium underline-offset-4 hover:underline"
        href={`/app/customers/${row.original.id}`}
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    accessorKey: "email",
    header: "Email",
    size: 260,
    cell: ({ row }) => (
      <span className="break-all text-xs">{row.original.email}</span>
    ),
  },
  {
    accessorKey: "phone",
    header: "Telepon terakhir",
    size: 165,
  },
  {
    accessorKey: "orderCount",
    header: "Order",
    size: 90,
    meta: {
      cellClassName: "text-right tabular-nums",
      headerClassName: "text-right",
    },
  },
  {
    accessorKey: "paidGrossIdr",
    header: "Pembayaran lunas",
    size: 175,
    meta: {
      cellClassName: "text-right tabular-nums",
      headerClassName: "text-right",
    },
    cell: ({ row }) => formatIdr(row.original.paidGrossIdr),
  },
  {
    accessorKey: "lastOrderAt",
    header: "Order terakhir",
    size: 180,
    cell: ({ row }) => (
      <time className="text-xs" dateTime={row.original.lastOrderAt}>
        {formatDate(row.original.lastOrderAt)}
      </time>
    ),
  },
];

export function CustomersPage() {
  const list = useListQuery();
  const customers = useCustomers(list.query);
  const orderAction = (
    <Button
      nativeButton={false}
      render={<Link href="/app/orders/new" />}
      size="sm"
    >
      <Plus aria-hidden="true" data-icon="inline-start" />
      Buat order
    </Button>
  );

  return (
    <>
      <PageHeader
        action={orderAction}
        description="Kontak dari order, dikelompokkan menurut email."
        title="Pelanggan"
      />
      <RecordsTable
        columns={CUSTOMER_COLUMNS}
        emptyAction={orderAction}
        emptyDescription="Pelanggan muncul setelah order dibuat."
        error={customers.error}
        isLoading={customers.isPending || customers.isPlaceholderData}
        list={list}
        onRetry={() => {
          void customers.refetch();
        }}
        rows={
          customers.isPlaceholderData ? [] : (customers.data?.customers ?? [])
        }
        searchPlaceholder="Cari nama, email, atau telepon…"
        title="Daftar pelanggan"
        total={customers.data?.total ?? 0}
      />
    </>
  );
}
