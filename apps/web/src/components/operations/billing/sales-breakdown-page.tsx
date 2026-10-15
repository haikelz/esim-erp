"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { ErrorNotice } from "@/components/common/data-state";
import { PageHeader } from "@/components/common/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@/components/reui/frame";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useInvoiceListQuery, useSalesBreakdown } from "@/hooks/billing";
import { formatIdr } from "@/lib/format";
import { FinancePeriodFilter } from "./finance-period-filter";

const DAY_FORMAT = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeZone: "Asia/Jakarta",
});

type BreakdownRow = {
  readonly key: string;
  readonly label: string;
  readonly detail?: string;
  readonly orderCount: number;
  readonly grossIdr: number;
};

type BreakdownGroupProps = {
  readonly description?: string;
  readonly isLoading: boolean;
  readonly rows: BreakdownRow[];
  readonly title: string;
};

function BreakdownGroup({
  description,
  isLoading,
  rows,
  title,
}: BreakdownGroupProps) {
  return (
    <Frame spacing="default">
      <FrameHeader>
        <FrameTitle>
          <h2>{title}</h2>
        </FrameTitle>
        {description ? (
          <FrameDescription>{description}</FrameDescription>
        ) : null}
      </FrameHeader>
      <FramePanel>
        {isLoading ? (
          <div
            aria-label={`Memuat ${title.toLowerCase()}`}
            className="flex flex-col gap-4"
            role="status"
          >
            {[1, 2, 3].map((row) => (
              <div
                className="flex items-center justify-between gap-4"
                key={row}
              >
                <Skeleton className="h-5 w-2/5" />
                <Skeleton className="h-5 w-1/4" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <Empty role="status">
            <EmptyHeader>
              <EmptyTitle>Belum ada invoice lunas</EmptyTitle>
              <EmptyDescription>
                Penjualan lunas akan muncul setelah pembayaran tercatat.
              </EmptyDescription>
            </EmptyHeader>
            <Button
              nativeButton={false}
              render={<Link href="/app/billing" />}
              size="sm"
              variant="outline"
            >
              Buka invoice
            </Button>
          </Empty>
        ) : (
          <ul className="flex flex-col">
            {rows.map((row) => (
              <li
                className="flex flex-wrap items-start justify-between gap-3 border-b py-3 first:pt-0 last:border-b-0 last:pb-0"
                key={row.key}
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-medium">{row.label}</span>
                  {row.detail ? (
                    <span className="break-all font-mono text-xs text-muted-foreground">
                      {row.detail}
                    </span>
                  ) : null}
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {row.orderCount.toLocaleString("id-ID")} order lunas
                  </span>
                </div>
                <span className="font-medium tabular-nums">
                  {formatIdr(row.grossIdr)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </FramePanel>
    </Frame>
  );
}

export function SalesBreakdownPage() {
  const filters = useInvoiceListQuery();
  const period = filters.query
    ? { from: filters.query.from, to: filters.query.to }
    : undefined;
  const breakdown = useSalesBreakdown(period);
  const data = breakdown.data;

  return (
    <>
      <PageHeader
        action={
          <Button
            nativeButton={false}
            render={<Link href="/app/billing" />}
            size="sm"
            variant="outline"
          >
            Kembali ke billing
          </Button>
        }
        description="Invoice lunas menurut negara, paket, dan hari terbit."
        title="Rincian penjualan"
      />
      <FinancePeriodFilter
        helpText="Periode tanggal terbit (WIB); hanya invoice yang kini lunas."
        key={filters.params}
        onReset={filters.resetFilters}
        onSubmit={filters.setPeriod}
        period={period}
      />
      {filters.validationError ? (
        <Alert variant="warning">
          <TriangleAlert aria-hidden="true" />
          <AlertTitle>Filter belum valid</AlertTitle>
          <AlertDescription>{filters.validationError}</AlertDescription>
        </Alert>
      ) : breakdown.error ? (
        <ErrorNotice
          error={breakdown.error}
          onRetry={() => {
            void breakdown.refetch();
          }}
        />
      ) : (
        <>
          <Frame
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            spacing="default"
          >
            <FramePanel>
              <dl className="flex flex-col gap-2">
                <dt className="text-xs font-medium text-muted-foreground">
                  Order lunas
                </dt>
                <dd className="text-2xl font-semibold tracking-tight tabular-nums">
                  {breakdown.isPending ? (
                    <Skeleton className="h-8 w-28" />
                  ) : (
                    (data?.totalOrders ?? 0).toLocaleString("id-ID")
                  )}
                </dd>
              </dl>
            </FramePanel>
            <FramePanel>
              <dl className="flex flex-col gap-2">
                <dt className="text-xs font-medium text-muted-foreground">
                  Penjualan bruto
                </dt>
                <dd className="text-2xl font-semibold tracking-tight tabular-nums">
                  {breakdown.isPending ? (
                    <Skeleton className="h-8 w-32" />
                  ) : (
                    formatIdr(data?.paidGrossIdr ?? 0)
                  )}
                </dd>
              </dl>
            </FramePanel>
          </Frame>
          <div className="grid min-w-0 items-start gap-6 lg:grid-cols-2">
            <BreakdownGroup
              description="Paket regional tercatat di tiap negara; jangan jumlahkan baris antarnegara."
              isLoading={breakdown.isPending}
              rows={
                data?.byCountry.map((row) => ({
                  key: row.country,
                  label: row.country,
                  orderCount: row.orderCount,
                  grossIdr: row.grossIdr,
                })) ?? []
              }
              title="Negara cakupan"
            />
            <BreakdownGroup
              isLoading={breakdown.isPending}
              rows={
                data?.byPackage.map((row) => ({
                  key: `${row.providerSku}-${row.packageName}`,
                  label: row.packageName,
                  detail: row.providerSku,
                  orderCount: row.orderCount,
                  grossIdr: row.grossIdr,
                })) ?? []
              }
              title="Paket"
            />
          </div>
          <BreakdownGroup
            isLoading={breakdown.isPending}
            rows={
              data?.byDay.map((row) => ({
                key: row.date,
                label: DAY_FORMAT.format(
                  new Date(`${row.date}T00:00:00+07:00`),
                ),
                orderCount: row.orderCount,
                grossIdr: row.grossIdr,
              })) ?? []
            }
            title="Tanggal terbit (WIB)"
          />
        </>
      )}
    </>
  );
}
