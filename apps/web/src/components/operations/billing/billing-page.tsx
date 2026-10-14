"use client";

import type { Invoice } from "@esim-erp/contracts";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
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
import {
  useExportInvoices,
  useFinanceSummary,
  useInvoiceListQuery,
  useInvoices,
} from "@/hooks/billing";
import { formatDate, formatIdr } from "@/lib/format";
import { FinancePeriodFilter } from "./finance-period-filter";

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
    header: "Margin bruto",
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
  {
    accessorKey: "gatewayFeeIdr",
    header: "Fee tercatat",
    size: 140,
    meta: {
      cellClassName: "text-right tabular-nums",
      headerClassName: "text-right",
    },
    cell: ({ row }) => formatIdr(row.original.gatewayFeeIdr),
  },
  {
    accessorKey: "refundIdr",
    header: "Refund tercatat",
    size: 145,
    meta: {
      cellClassName: "text-right tabular-nums",
      headerClassName: "text-right",
    },
    cell: ({ row }) => formatIdr(row.original.refundIdr),
  },
  {
    accessorKey: "netMarginIdr",
    header: "Margin neto tercatat",
    size: 175,
    meta: {
      cellClassName: "text-right tabular-nums",
      headerClassName: "text-right",
    },
    cell: ({ row }) =>
      row.original.netMarginIdr === null ? (
        <span className="text-muted-foreground">Belum terealisasi</span>
      ) : (
        formatIdr(row.original.netMarginIdr)
      ),
  },
];

export function BillingPage() {
  const filters = useInvoiceListQuery();
  const invoices = useInvoices(filters.query);
  const period = filters.query
    ? { from: filters.query.from, to: filters.query.to }
    : undefined;
  const summary = useFinanceSummary(period);
  const exportCsv = useExportInvoices();

  async function handleExport() {
    if (!filters.query || exportCsv.isPending) return;

    try {
      const blob = await exportCsv.mutateAsync(filters.query);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `invoices-${filters.query.from ?? "all"}-${filters.query.to ?? "periods"}.csv`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(
        "CSV memuat seluruh hasil pencarian dalam periode, bukan hanya halaman ini.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Laporan belum dapat diekspor.",
        { duration: Number.POSITIVE_INFINITY },
      );
    } finally {
      exportCsv.reset();
    }
  }

  return (
    <>
      <PageHeader
        action={
          <Button
            aria-busy={exportCsv.isPending}
            disabled={!filters.query || exportCsv.isPending}
            onClick={() => void handleExport()}
            size="sm"
            type="button"
            variant="outline"
          >
            <Download aria-hidden="true" data-icon="inline-start" />
            Ekspor CSV
          </Button>
        }
        description="Invoice dalam IDR; margin neto hanya mencakup fee dan refund yang dicatat, belum termasuk pajak."
        title="Billing & finance"
      />
      <FinancePeriodFilter
        key={filters.params}
        onReset={filters.resetFilters}
        onSubmit={filters.setPeriod}
        period={period}
      />
      {filters.validationError ? (
        <Alert variant="warning">
          <AlertTitle>Filter belum valid</AlertTitle>
          <AlertDescription>{filters.validationError}</AlertDescription>
        </Alert>
      ) : summary.error ? (
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
              label: "Pembayaran bruto",
              value: formatIdr(summary.data?.paidGrossIdr ?? 0),
              description: "Invoice lunas sebelum refund",
            },
            {
              label: "Invoice belum lunas",
              value: formatIdr(summary.data?.outstandingIdr ?? 0),
              description: "Termasuk yang gagal atau kedaluwarsa",
            },
            {
              label: "Pengeluaran supplier",
              value: formatIdr(summary.data?.supplierSpendIdr ?? 0),
              description: "Debit supplier yang sudah dicatat",
            },
            {
              label: "Margin bruto",
              value: formatIdr(summary.data?.realizedMarginIdr ?? 0),
              description: "Lunas, profil siap, dan debit tercatat",
            },
            {
              label: "Fee gateway tercatat",
              value: formatIdr(summary.data?.gatewayFeesIdr ?? 0),
              description: "Cocokkan dengan laporan gateway",
            },
            {
              label: "Refund tercatat",
              value: formatIdr(summary.data?.refundsIdr ?? 0),
              description: "Tidak mengubah status lunas",
            },
            {
              label: "Margin neto tercatat",
              value: formatIdr(summary.data?.netRecordedMarginIdr ?? 0),
              description:
                "Margin bruto dikurangi fee dan refund invoice terealisasi",
            },
            {
              label: "Fee belum dicatat",
              value: String(summary.data?.feesUnrecordedInvoices ?? 0),
              description: "Periksa biaya di laporan gateway",
            },
          ]}
        />
      )}
      {summary.data &&
      summary.data.feesUnrecordedInvoices > 0 &&
      filters.query ? (
        <Alert role="status" variant="info">
          <AlertTitle>Fee gateway belum lengkap</AlertTitle>
          <AlertDescription>
            {summary.data.feesUnrecordedInvoices} invoice lunas belum memiliki
            catatan fee. Nominal fee nol bukan bukti bebas biaya; cocokkan
            dengan laporan gateway sebelum memakai margin neto untuk penutupan
            buku.
          </AlertDescription>
        </Alert>
      ) : null}
      {summary.data && summary.data.needsReconciliation > 0 && filters.query ? (
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
      {filters.query ? (
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
          emptyDescription="Invoice muncul setelah order dibuat."
          error={invoices.error}
          isLoading={invoices.isPending || invoices.isPlaceholderData}
          list={filters.list}
          onRetry={() => {
            void invoices.refetch();
          }}
          rows={
            invoices.isPlaceholderData ? [] : (invoices.data?.invoices ?? [])
          }
          title="Invoice"
          total={invoices.data?.total ?? 0}
        />
      ) : null}
    </>
  );
}
