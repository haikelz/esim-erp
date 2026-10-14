import type { Order } from "@esim-erp/contracts";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import {
  FulfillmentBadge,
  PaymentBadge,
} from "@/components/common/status-badge";
import type { DataGridFeatures } from "@/components/reui/data-grid/data-grid";
import { formatDate, formatIdr, formatQuota } from "@/lib/format";

export const ORDER_COLUMNS: ColumnDef<DataGridFeatures, Order>[] = [
  {
    accessorKey: "number",
    header: "Order",
    size: 140,
    cell: ({ row }) => (
      <Link
        className="font-mono text-xs font-medium underline-offset-4 hover:underline"
        href={`/app/orders/${row.original.id}`}
      >
        {row.original.number}
      </Link>
    ),
  },
  {
    accessorKey: "customerName",
    header: "Pelanggan",
    size: 180,
    cell: ({ row }) => (
      <div className="flex flex-col gap-1">
        <span className="font-medium">{row.original.customerName}</span>
        <span className="text-xs text-muted-foreground">
          {formatDate(row.original.createdAt)}
        </span>
      </div>
    ),
  },
  {
    id: "package",
    header: "Paket",
    size: 200,
    cell: ({ row }) => (
      <div className="flex flex-col gap-1">
        <span>{row.original.package.name}</span>
        <span className="text-xs text-muted-foreground">
          {formatQuota(row.original.package.dataMb)} ·{" "}
          {row.original.package.validityDays} hari
        </span>
      </div>
    ),
  },
  {
    id: "total",
    header: "Total",
    size: 135,
    meta: {
      headerClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    cell: ({ row }) => formatIdr(row.original.package.sellingPriceIdr),
  },
  {
    accessorKey: "paymentStatus",
    header: "Pembayaran",
    size: 190,
    cell: ({ row }) => <PaymentBadge status={row.original.paymentStatus} />,
  },
  {
    accessorKey: "fulfillmentStatus",
    header: "Fulfillment",
    size: 185,
    cell: ({ row }) => (
      <FulfillmentBadge status={row.original.fulfillmentStatus} />
    ),
  },
];
