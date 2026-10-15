"use client";

import type {
  ExceptionFollowUpInput,
  ExceptionKind,
  ExceptionPage,
  StaffRole,
} from "@esim-erp/contracts";
import type { ColumnDef } from "@tanstack/react-table";
import { CircleAlert, Clock3 } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { RecordsTable } from "@/components/common/records-table";
import {
  FulfillmentBadge,
  PaymentBadge,
} from "@/components/common/status-badge";
import { Badge } from "@/components/reui/badge";
import type { DataGridFeatures } from "@/components/reui/data-grid/data-grid";
import { Button } from "@/components/ui/button";
import type { useExceptionListQuery } from "@/hooks/exceptions";
import { formatDate } from "@/lib/format";

export const EXCEPTION_KIND_LABELS: Record<ExceptionKind, string> = {
  reconciliation: "Perlu rekonsiliasi",
  fulfillment_failed: "Penerbitan gagal",
  supplier_unknown: "Hasil supplier tidak pasti",
  paid_unissued: "Lunas, profil belum terbit",
};

export const FOLLOW_UP_LABELS: Record<
  ExceptionFollowUpInput["outcome"],
  string
> = {
  investigating: "Sedang diperiksa",
  waiting_gateway: "Menunggu gateway",
  waiting_supplier: "Menunggu supplier",
  review_complete: "Peninjauan selesai",
};

export type ExceptionEntry = ExceptionPage["exceptions"][number];

type ExceptionRow = ExceptionEntry & { readonly id: string };

export function canRetryException(entry: ExceptionEntry, role: StaffRole) {
  return (
    (role === "admin" || role === "operations") &&
    entry.order.paymentStatus === "paid" &&
    entry.order.fulfillmentStatus === "failed" &&
    !entry.order.reconciliationRequired &&
    !entry.kinds.includes("reconciliation") &&
    !entry.kinds.includes("supplier_unknown")
  );
}

function formatAge(ageMinutes: number) {
  if (ageMinutes < 60) return `${ageMinutes} menit`;
  if (ageMinutes < 1440) {
    const hours = Math.floor(ageMinutes / 60);
    const minutes = ageMinutes % 60;
    return minutes ? `${hours} jam ${minutes} menit` : `${hours} jam`;
  }

  const days = Math.floor(ageMinutes / 1440);
  const hours = Math.floor((ageMinutes % 1440) / 60);
  return hours ? `${days} hari ${hours} jam` : `${days} hari`;
}

function getNextStep(entry: ExceptionEntry) {
  if (
    entry.order.reconciliationRequired ||
    entry.kinds.includes("reconciliation")
  ) {
    return "Minta tim keuangan atau admin memeriksa pembayaran sebelum penerbitan dilanjutkan.";
  }
  if (
    entry.order.fulfillmentStatus === "unknown" ||
    entry.kinds.includes("supplier_unknown")
  ) {
    return "Periksa hasil supplier pada detail order. Jangan coba ulang saat hasil belum pasti.";
  }
  if (entry.order.fulfillmentStatus === "failed") {
    return entry.order.paymentStatus === "paid"
      ? "Admin atau operasional dapat mencoba ulang penerbitan. Periksa hasilnya pada order."
      : "Periksa pembayaran pada detail order. Coba ulang hanya tersedia setelah lunas.";
  }
  if (entry.order.fulfillmentStatus === "processing") {
    return "Pemrosesan sedang berlangsung. Periksa status terbaru sebelum tindakan lain.";
  }

  return "Periksa antrean dan saldo tercatat sebelum memproses penerbitan.";
}

type ExceptionsTableProps = {
  readonly actionsDisabled: boolean;
  readonly error: Error | null;
  readonly isLoading: boolean;
  readonly list: ReturnType<typeof useExceptionListQuery>;
  readonly onFollowUp: (entry: ExceptionEntry) => void;
  readonly onRefresh: () => void;
  readonly onRetry: (entry: ExceptionEntry) => void;
  readonly page?: ExceptionPage;
  readonly pendingRetryId?: string;
  readonly role: StaffRole;
};

export function ExceptionsTable({
  actionsDisabled,
  error,
  isLoading,
  list,
  onFollowUp,
  onRefresh,
  onRetry,
  page,
  pendingRetryId,
  role,
}: ExceptionsTableProps) {
  const rows = useMemo(
    () =>
      page?.exceptions.map((entry) => ({ ...entry, id: entry.order.id })) ?? [],
    [page],
  );
  const columns = useMemo<ColumnDef<DataGridFeatures, ExceptionRow>[]>(
    () => [
      {
        id: "order",
        header: "Order & pelanggan",
        size: 220,
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col gap-1 whitespace-normal break-words">
            <span className="font-mono text-xs font-medium">
              {row.original.order.number}
            </span>
            <span className="font-medium">
              {row.original.order.customerName}
            </span>
            <span className="text-xs text-muted-foreground">
              {row.original.order.package.name}
            </span>
          </div>
        ),
      },
      {
        id: "kinds",
        header: "Pengecualian & tindak lanjut",
        size: 280,
        cell: ({ row }) => (
          <div className="flex flex-col items-start gap-2 whitespace-normal">
            <div className="flex flex-wrap gap-1">
              {row.original.kinds.map((kind) => (
                <Badge
                  key={kind}
                  variant={
                    kind === "paid_unissued"
                      ? "warning-light"
                      : "destructive-light"
                  }
                >
                  {EXCEPTION_KIND_LABELS[kind]}
                </Badge>
              ))}
            </div>
            <p
              className="text-xs text-muted-foreground"
              id={`exception-guidance-${row.original.id}`}
            >
              {getNextStep(row.original)}
            </p>
            {row.original.followUp ? (
              <div className="flex flex-col gap-0.5 border-t pt-2 text-xs text-muted-foreground">
                <span>
                  {FOLLOW_UP_LABELS[row.original.followUp.outcome]} ·{" "}
                  {row.original.followUp.assignee?.name ?? "Belum ditugaskan"}
                </span>
                <time dateTime={row.original.followUp.createdAt}>
                  {formatDate(row.original.followUp.createdAt)} WIB
                </time>
              </div>
            ) : null}
          </div>
        ),
      },
      {
        id: "status",
        header: "Status order",
        size: 190,
        cell: ({ row }) => (
          <div className="flex flex-col items-start gap-2">
            <PaymentBadge status={row.original.order.paymentStatus} />
            <FulfillmentBadge status={row.original.order.fulfillmentStatus} />
          </div>
        ),
      },
      {
        id: "age",
        header: "Usia",
        size: 195,
        cell: ({ row }) => (
          <div className="flex flex-col items-start gap-2 whitespace-normal">
            <Badge
              variant={
                row.original.severity === "critical"
                  ? "destructive-light"
                  : "warning-light"
              }
            >
              {row.original.severity === "critical" ? (
                <CircleAlert aria-hidden="true" />
              ) : (
                <Clock3 aria-hidden="true" />
              )}
              {row.original.severity === "critical" ? "Kritis" : "Perhatian"}
            </Badge>
            <span className="font-medium tabular-nums">
              {formatAge(row.original.ageMinutes)}
            </span>
            <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              <span>
                {row.original.order.paymentStatus === "paid"
                  ? "Sejak pelunasan"
                  : "Sejak invoice terbit"}
              </span>
              <time dateTime={row.original.since}>
                {formatDate(row.original.since)} WIB
              </time>
            </div>
          </div>
        ),
      },
      {
        id: "actions",
        header: "Tindakan",
        size: 175,
        cell: ({ row }) => (
          <div className="flex flex-col items-start gap-2">
            <Button
              aria-label={`Lihat order ${row.original.order.number}`}
              nativeButton={false}
              render={
                <Link
                  href={`/app/orders/${encodeURIComponent(row.original.id)}`}
                />
              }
              role="link"
              size="sm"
              variant="ghost"
            >
              Lihat order
            </Button>
            {role === "admin" || role === "finance" ? (
              <Button
                aria-label={`Lihat invoice ${row.original.order.invoiceNumber}`}
                nativeButton={false}
                render={
                  <Link
                    href={`/app/billing/${encodeURIComponent(row.original.order.invoiceId)}`}
                  />
                }
                role="link"
                size="sm"
                variant="ghost"
              >
                Lihat invoice
              </Button>
            ) : null}
            {role !== "sales" ? (
              <Button
                aria-label={`Catat tindak lanjut ${row.original.order.number}`}
                disabled={actionsDisabled}
                id={`exception-follow-up-${row.original.id}`}
                onClick={() => onFollowUp(row.original)}
                size="sm"
                type="button"
                variant="ghost"
              >
                Catat tindak lanjut
              </Button>
            ) : null}
            {canRetryException(row.original, role) ? (
              <Button
                aria-busy={pendingRetryId === row.original.id}
                aria-describedby={`exception-guidance-${row.original.id}`}
                aria-label={`Coba ulang penerbitan ${row.original.order.number}`}
                disabled={actionsDisabled}
                onClick={() => onRetry(row.original)}
                size="sm"
                type="button"
                variant="ghost"
              >
                Coba ulang
              </Button>
            ) : null}
          </div>
        ),
      },
    ],
    [actionsDisabled, onFollowUp, onRetry, pendingRetryId, role],
  );
  const isFiltered = Boolean(list.query.kind || list.query.search);

  return (
    // Expose the shared table's search label locally without changing its API.
    <div className="min-w-0 [&_form]:flex-wrap [&_form>label]:not-sr-only [&_form>label]:w-full [&_form>label]:text-xs [&_form>label]:font-medium [&_form>input]:flex-1">
      <RecordsTable
        columns={columns}
        emptyAction={
          isFiltered ? (
            <Button
              onClick={list.resetFilters}
              size="sm"
              type="button"
              variant="outline"
            >
              Reset filter
            </Button>
          ) : undefined
        }
        emptyDescription={
          isFiltered
            ? "Tidak ada pengecualian yang cocok."
            : "Tidak ada order yang perlu ditangani saat ini."
        }
        error={error}
        isLoading={isLoading}
        list={list}
        onRetry={onRefresh}
        rows={rows}
        title="Pengecualian"
        total={page?.total ?? 0}
      />
    </div>
  );
}
