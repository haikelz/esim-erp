"use client";

import type { Invoice } from "@esim-erp/contracts";
import type { ColumnDef } from "@tanstack/react-table";
import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { ErrorNotice } from "@/components/common/data-state";
import { MetricStrip } from "@/components/common/metric-strip";
import { PageHeader } from "@/components/common/page-header";
import { RecordsTable } from "@/components/common/records-table";
import {
  FulfillmentBadge,
  PaymentBadge,
} from "@/components/common/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { Badge } from "@/components/reui/badge";
import type { DataGridFeatures } from "@/components/reui/data-grid/data-grid";
import { Button } from "@/components/ui/button";
import { useFinanceSummary, useInvoices } from "@/hooks/billing";
import { useListQuery } from "@/hooks/list-query";
import { formatDate, formatIdr } from "@/lib/format";

const INVOICE_COLUMNS: ColumnDef<DataGridFeatures, Invoice>[] = [
  {
    accessorKey: "number",
    header: "Invoice",
    size: 175,
    cell: ({ row }) => (
      <div className="flex flex-col gap-1">
        <Link
          className="font-mono text-xs font-medium underline-offset-4 hover:underline"
          href={`/app/billing/${row.original.id}`}
        >
          {row.original.number}
        </Link>
        <span className="text-xs text-muted-foreground">
          {formatDate(row.original.createdAt)}
        </span>
      </div>
    ),
  },
  {
    accessorKey: "customerName",
    header: "Pelanggan",
    size: 195,
    cell: ({ row }) => (
      <div className="flex flex-col gap-1">
        <span className="font-medium">{row.original.customerName}</span>
        <span className="text-xs text-muted-foreground">
          {row.original.packageName}
        </span>
      </div>
    ),
  },
  {
    accessorKey: "amountIdr",
    header: "Nominal",
    size: 140,
    meta: {
      cellClassName: "text-right tabular-nums",
      headerClassName: "text-right",
    },
    cell: ({ row }) => formatIdr(row.original.amountIdr),
  },
  {
    accessorKey: "paymentStatus",
    header: "Pembayaran",
    size: 205,
    cell: ({ row }) => (
      <div className="flex flex-col items-start gap-1">
        <PaymentBadge status={row.original.paymentStatus} />
        {row.original.reconciliationRequired ? (
          <Badge variant="warning-light">Perlu rekonsiliasi</Badge>
        ) : null}
      </div>
    ),
  },
  {
    accessorKey: "fulfillmentStatus",
    header: "Fulfillment",
    size: 195,
    cell: ({ row }) => (
      <FulfillmentBadge status={row.original.fulfillmentStatus} />
    ),
  },
  {
    accessorKey: "marginIdr",
    header: "Margin terealisasi",
    size: 155,
    meta: {
      cellClassName: "text-right tabular-nums",
      headerClassName: "text-right",
    },
    cell: ({ row }) =>
      row.original.marginIdr === null ? (
        <span className="text-muted-foreground">
          <span aria-hidden="true">—</span>
          <span className="sr-only">Margin belum terealisasi</span>
        </span>
      ) : (
        formatIdr(row.original.marginIdr)
      ),
  },
];

export function BillingPage() {
  const list = useListQuery();
  const invoices = useInvoices(list.query);
  const summary = useFinanceSummary();

  return (
    <>
      <PageHeader
        description="Posisi keuangan kumulatif dalam IDR. Margin operasional belum mencakup fee payment gateway dan pajak."
        title="Billing & finance"
      />
      {summary.error ? (
        <ErrorNotice
          error={summary.error}
          onRetry={() => {
            void summary.refetch();
          }}
        />
      ) : (
        <MetricStrip
          isLoading={summary.isPending}
          metrics={[
            {
              label: "Pembayaran diterima",
              value: formatIdr(summary.data?.paidGrossIdr ?? 0),
              description: "Total invoice yang sudah lunas",
            },
            {
              label: "Belum diterima",
              value: formatIdr(summary.data?.outstandingIdr ?? 0),
              description: "Invoice yang belum lunas",
            },
            {
              label: "Pengeluaran supplier",
              value: formatIdr(summary.data?.supplierSpendIdr ?? 0),
              description: "Debit supplier yang sudah dicatat",
            },
            {
              label: "Margin terealisasi",
              value: formatIdr(summary.data?.realizedMarginIdr ?? 0),
              description: "Lunas, profil siap, dan debit tercatat",
            },
          ]}
        />
      )}
      {summary.data && summary.data.needsReconciliation > 0 ? (
        <Alert variant="warning">
          <TriangleAlert aria-hidden="true" />
          <AlertTitle>
            {summary.data.needsReconciliation} invoice perlu rekonsiliasi
          </AlertTitle>
          <AlertDescription>
            Periksa transaksi bertumpuk, refund, atau chargeback melalui detail
            invoice dan dashboard Midtrans.
          </AlertDescription>
        </Alert>
      ) : null}
      <RecordsTable
        columns={INVOICE_COLUMNS}
        emptyAction={
          <Button
            nativeButton={false}
            render={<Link href="/app/orders" />}
            size="sm"
            variant="outline"
          >
            Buka daftar order
          </Button>
        }
        emptyDescription="Invoice dibuat otomatis saat sales membuat order."
        error={invoices.error}
        isLoading={invoices.isPending}
        list={list}
        onRetry={() => {
          void invoices.refetch();
        }}
        rows={invoices.data?.invoices ?? []}
        title="Invoice"
        total={invoices.data?.total ?? 0}
      />
    </>
  );
}
