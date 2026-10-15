"use client";

import type { StaffRole } from "@esim-erp/contracts";
import { RefreshCw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { DetailLoading, ErrorNotice } from "@/components/common/data-state";
import { PageHeader } from "@/components/common/page-header";
import {
  FulfillmentBadge,
  PaymentBadge,
} from "@/components/common/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import {
  Frame,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@/components/reui/frame";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useCancelOrder, useOrder, useRetryProvisioning } from "@/hooks/orders";
import { formatDate, formatIdr, formatQuota } from "@/lib/format";
import { InstallationPanel } from "./installation-panel";

type OrderDetailProps = { readonly id: string; readonly role: StaffRole };

export function OrderDetail({ id, role }: OrderDetailProps) {
  const [isCancelOpen, setCancelOpen] = useState(false);
  const orderQuery = useOrder(id);
  const cancel = useCancelOrder();
  const retry = useRetryProvisioning();

  async function handleCancel() {
    try {
      await cancel.mutateAsync(id);
      setCancelOpen(false);
      toast.success("Order dibatalkan. Invoice tidak lagi dapat ditagih.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Pembatalan belum dapat dipastikan. Periksa status terbaru.",
        { duration: Number.POSITIVE_INFINITY },
      );
    }
  }

  async function handleRetry() {
    try {
      await retry.mutateAsync(id);
      toast.success(
        "Penerbitan dijadwalkan ulang. Periksa status profil pada order.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Penerbitan belum dapat dicoba ulang.",
        { duration: Number.POSITIVE_INFINITY },
      );
    }
  }

  const order = orderQuery.data;
  const canReadBilling = role === "admin" || role === "finance";
  const canManageOrder = role === "admin" || role === "sales";
  const canRetry = role === "admin" || role === "operations";
  const canReveal =
    role === "admin" || role === "operations" || role === "sales";

  return (
    <>
      <PageHeader
        action={
          <div className="flex flex-wrap items-center gap-2">
            {order?.paymentStatus === "unpaid" && canManageOrder ? (
              <Button
                disabled={cancel.isPending}
                onClick={() => setCancelOpen(true)}
                size="sm"
                type="button"
                variant="outline"
              >
                Batalkan order
              </Button>
            ) : null}
            <Button
              nativeButton={false}
              render={<Link href="/app/orders" />}
              size="sm"
              variant="outline"
            >
              Kembali ke order
            </Button>
          </div>
        }
        description={
          order
            ? `Dibuat ${formatDate(order.createdAt)}`
            : "Detail penjualan dan penerbitan profil eSIM."
        }
        title={order?.number ?? "Detail order"}
      />
      {orderQuery.isPending ? (
        <DetailLoading />
      ) : orderQuery.error ? (
        <ErrorNotice
          error={orderQuery.error}
          onRetry={() => {
            void orderQuery.refetch();
          }}
        />
      ) : order ? (
        <>
          {order.reconciliationRequired ? (
            <Alert variant="warning">
              <TriangleAlert aria-hidden="true" />
              <AlertTitle>Pembayaran perlu diperiksa</AlertTitle>
              <AlertDescription>
                Periksa transaksi bersama tim keuangan. Refund dan chargeback
                tidak diselesaikan otomatis.
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.6fr)]">
            <div className="flex min-w-0 flex-col gap-6">
              <Frame>
                <FrameHeader>
                  <FrameTitle>
                    <h2>Pelanggan & paket</h2>
                  </FrameTitle>
                </FrameHeader>
                <FramePanel className="grid gap-4 sm:grid-cols-2">
                  <dl className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                      <dt className="text-xs text-muted-foreground">
                        Pelanggan
                      </dt>
                      <dd className="font-medium">
                        {canManageOrder ? (
                          <Link
                            className="underline-offset-4 hover:underline"
                            href={`/app/customers/${order.customerId}`}
                          >
                            {order.customerName}
                          </Link>
                        ) : (
                          order.customerName
                        )}
                      </dd>
                    </div>
                    <div className="flex flex-col gap-1">
                      <dt className="text-xs text-muted-foreground">Email</dt>
                      <dd className="break-all">{order.customerEmail}</dd>
                    </div>
                    <div className="flex flex-col gap-1">
                      <dt className="text-xs text-muted-foreground">Telepon</dt>
                      <dd>{order.customerPhone}</dd>
                    </div>
                  </dl>
                  <dl className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                      <dt className="text-xs text-muted-foreground">
                        Paket pesanan
                      </dt>
                      <dd className="font-medium">{order.package.name}</dd>
                    </div>
                    <div className="flex flex-col gap-1">
                      <dt className="text-xs text-muted-foreground">Cakupan</dt>
                      <dd>{order.package.countries.join(", ")}</dd>
                    </div>
                    <div className="flex flex-col gap-1">
                      <dt className="text-xs text-muted-foreground">
                        Kuota / masa berlaku
                      </dt>
                      <dd className="tabular-nums">
                        {formatQuota(order.package.dataMb)} /{" "}
                        {order.package.validityDays} hari
                      </dd>
                    </div>
                  </dl>
                  {order.note ? (
                    <div className="flex flex-col gap-1 border-t pt-4 sm:col-span-2">
                      <p className="text-xs text-muted-foreground">
                        Catatan internal
                      </p>
                      <p className="whitespace-pre-wrap break-words">
                        {order.note}
                      </p>
                    </div>
                  ) : null}
                </FramePanel>
              </Frame>
              {order.fulfillmentStatus === "ready" && canReveal ? (
                <InstallationPanel orderId={order.id} />
              ) : null}
            </div>
            <div className="flex min-w-0 flex-col gap-6">
              <Frame>
                <FrameHeader>
                  <FrameTitle>
                    <h2>Pembayaran</h2>
                  </FrameTitle>
                </FrameHeader>
                <FramePanel className="flex flex-col gap-4">
                  <PaymentBadge status={order.paymentStatus} />
                  {order.paymentStatus === "cancelled" ? (
                    <p className="text-sm text-muted-foreground">
                      Dibatalkan sebelum upaya pembayaran. Invoice tidak dapat
                      ditagih.
                    </p>
                  ) : null}
                  <dl className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                      <dt className="text-xs text-muted-foreground">Invoice</dt>
                      <dd className="font-mono text-xs">
                        {order.invoiceNumber}
                      </dd>
                    </div>
                    <div className="flex flex-col gap-1">
                      <dt className="text-xs text-muted-foreground">Total</dt>
                      <dd className="text-2xl font-semibold tracking-tight tabular-nums">
                        {formatIdr(order.package.sellingPriceIdr)}
                      </dd>
                    </div>
                  </dl>
                  {canReadBilling ? (
                    <Button
                      nativeButton={false}
                      render={<Link href={`/app/billing/${order.invoiceId}`} />}
                      size="sm"
                      variant="outline"
                    >
                      Buka invoice
                    </Button>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Tim keuangan menangani tautan pembayaran.
                    </p>
                  )}
                </FramePanel>
              </Frame>
              <Frame>
                <FrameHeader>
                  <FrameTitle>
                    <h2>Penerbitan profil</h2>
                  </FrameTitle>
                </FrameHeader>
                <FramePanel className="flex flex-col gap-4">
                  <FulfillmentBadge status={order.fulfillmentStatus} />
                  {order.fulfillmentStatus === "ready" ? (
                    <p className="text-xs text-muted-foreground">
                      Pemasangan dan aktivasi pelanggan belum terpantau.
                    </p>
                  ) : null}
                  {order.fulfillmentError ? (
                    <Alert variant="destructive">
                      <AlertDescription>
                        {order.fulfillmentError}
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  {order.fulfillmentStatus === "failed" && canRetry ? (
                    <Button
                      disabled={retry.isPending}
                      onClick={handleRetry}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <RefreshCw
                        aria-hidden="true"
                        className={
                          retry.isPending
                            ? "animate-spin motion-reduce:animate-none"
                            : undefined
                        }
                        data-icon="inline-start"
                      />
                      Coba ulang penerbitan
                    </Button>
                  ) : null}
                  {order.fulfillmentStatus === "unknown" ? (
                    <p className="text-sm text-muted-foreground">
                      Periksa status supplier sebelum menerbitkan profil lagi.
                    </p>
                  ) : null}
                </FramePanel>
              </Frame>
            </div>
          </div>
        </>
      ) : null}
      {order && isCancelOpen ? (
        <AlertDialog
          onOpenChange={(open) => {
            if (!open && !cancel.isPending) setCancelOpen(false);
          }}
          open
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Batalkan {order.number}?</AlertDialogTitle>
              <AlertDialogDescription>
                Order hanya dapat dibatalkan sebelum upaya pembayaran dibuat.
                Setelah dibatalkan, invoice tidak bisa ditagih. Tindakan ini
                tidak bisa dibatalkan.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={cancel.isPending}>
                Kembali
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={cancel.isPending}
                onClick={() => void handleCancel()}
                size="sm"
                type="button"
                variant="destructive"
              >
                {cancel.isPending ? "Membatalkan…" : "Batalkan order"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </>
  );
}
