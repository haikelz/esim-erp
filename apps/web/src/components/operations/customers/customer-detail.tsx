"use client";

import Link from "next/link";
import { DetailLoading, ErrorNotice } from "@/components/common/data-state";
import { PageHeader } from "@/components/common/page-header";
import { RecordsTable } from "@/components/common/records-table";
import { ORDER_COLUMNS } from "@/components/operations/orders/order-columns";
import {
  Frame,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@/components/reui/frame";
import { Button } from "@/components/ui/button";
import { useCustomer } from "@/hooks/customers";
import { useListQuery } from "@/hooks/list-query";
import { formatDate, formatIdr } from "@/lib/format";

type CustomerDetailProps = { readonly id: string };

export function CustomerDetail({ id }: CustomerDetailProps) {
  const list = useListQuery();
  const detail = useCustomer(id, {
    page: list.query.page,
    limit: list.query.limit,
  });
  const customer = detail.data?.customer;

  return (
    <>
      <PageHeader
        action={
          <Button
            nativeButton={false}
            render={<Link href="/app/customers" />}
            size="sm"
            variant="outline"
          >
            Kembali ke pelanggan
          </Button>
        }
        description="Riwayat order untuk alamat email yang sama."
        title={customer?.name ?? "Riwayat pelanggan"}
      />
      {detail.isPending || detail.isPlaceholderData ? (
        <DetailLoading />
      ) : detail.error ? (
        <ErrorNotice
          error={detail.error}
          onRetry={() => {
            void detail.refetch();
          }}
        />
      ) : customer ? (
        <>
          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>
                <h2>Kontak pelanggan</h2>
              </FrameTitle>
            </FrameHeader>
            <FramePanel>
              <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <dt className="text-xs text-muted-foreground">Email</dt>
                  <dd className="break-all">{customer.email}</dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-xs text-muted-foreground">
                    Telepon terakhir
                  </dt>
                  <dd>{customer.phone}</dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-xs text-muted-foreground">
                    Jumlah order
                  </dt>
                  <dd className="font-semibold tabular-nums">
                    {customer.orderCount.toLocaleString("id-ID")}
                  </dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-xs text-muted-foreground">
                    Bruto invoice lunas
                  </dt>
                  <dd className="font-semibold tabular-nums">
                    {formatIdr(customer.paidGrossIdr)}
                  </dd>
                </div>
              </dl>
              <p className="mt-4 text-xs text-muted-foreground">
                Nama dan telepon mengikuti order terbaru. Order terakhir:{" "}
                {formatDate(customer.lastOrderAt)} WIB.
              </p>
            </FramePanel>
          </Frame>
          <RecordsTable
            columns={ORDER_COLUMNS}
            emptyDescription="Belum ada order untuk pelanggan ini."
            error={detail.error}
            isLoading={detail.isPending || detail.isPlaceholderData}
            list={list}
            onRetry={() => {
              void detail.refetch();
            }}
            rows={detail.data?.orders ?? []}
            showSearch={false}
            title="Riwayat order"
            total={detail.data?.total ?? 0}
          />
        </>
      ) : null}
    </>
  );
}
