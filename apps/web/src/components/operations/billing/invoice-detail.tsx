"use client";

import type { PaymentAttempt } from "@esim-erp/contracts";
import {
  Copy,
  ExternalLink,
  Link2,
  LoaderCircle,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
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
import { Badge, type BadgeProps } from "@/components/reui/badge";
import {
  Frame,
  FrameDescription,
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
import {
  useCreatePaymentLink,
  useInvoice,
  useReconcilePayment,
  useSimulatePayment,
} from "@/hooks/billing";
import { useDashboard } from "@/hooks/dashboard";
import { formatDate, formatIdr } from "@/lib/format";
import { InvoiceAdjustments } from "./invoice-adjustments";

const ATTEMPT_STATES: Record<
  PaymentAttempt["status"],
  { label: string; variant: BadgeProps["variant"] }
> = {
  creating: { label: "Link sedang dibuat", variant: "info-light" },
  pending: { label: "Menunggu pembayaran", variant: "warning-light" },
  paid: { label: "Lunas", variant: "success-light" },
  failed: { label: "Gagal", variant: "destructive-light" },
  expired: { label: "Kedaluwarsa", variant: "secondary" },
  unknown: { label: "Perlu pemeriksaan", variant: "warning-light" },
};

type InvoiceDetailProps = { readonly id: string };

export function InvoiceDetail({ id }: InvoiceDetailProps) {
  const [isSimulationOpen, setSimulationOpen] = useState(false);
  const detail = useInvoice(id);
  const dashboard = useDashboard();
  const createLink = useCreatePaymentLink();
  const reconcile = useReconcilePayment();
  const simulate = useSimulatePayment();

  async function handleCreateLink() {
    try {
      await createLink.mutateAsync(id);
      toast.success("Payment link Midtrans siap dibagikan.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Payment link belum dapat dibuat.",
        { duration: Number.POSITIVE_INFINITY },
      );
    }
  }

  async function handleReconcile() {
    try {
      await reconcile.mutateAsync(id);
      toast.success("Status pembayaran diperiksa langsung ke Midtrans.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Status Midtrans belum dapat diperiksa.",
        { duration: Number.POSITIVE_INFINITY },
      );
    }
  }

  async function handleSimulate() {
    try {
      await simulate.mutateAsync(id);
      setSimulationOpen(false);
      toast.success(
        "Pelunasan simulasi dicatat. Penerbitan profil dijadwalkan.",
      );
    } catch {
      void detail.refetch();
    }
  }

  async function handleCopyLink() {
    if (!activeAttempt?.redirectUrl) return;

    try {
      await navigator.clipboard.writeText(activeAttempt.redirectUrl);
      toast.success("Payment link disalin.");
    } catch {
      toast.error(
        "Clipboard tidak tersedia. Buka halaman Midtrans dan salin alamatnya.",
        { duration: Number.POSITIVE_INFINITY },
      );
    }
  }

  const invoice = detail.data?.invoice;
  const attempts = detail.data?.attempts ?? [];
  const activeAttempt = attempts.find(
    (attempt) =>
      attempt.source === "midtrans" &&
      ["creating", "pending", "unknown"].includes(attempt.status),
  );
  const hasMidtransAttempt = attempts.some(
    (attempt) => attempt.source === "midtrans",
  );
  const hasSimulatedPayment = attempts.some(
    (attempt) => attempt.source === "demo" && attempt.status === "paid",
  );
  const isBusy =
    createLink.isPending || reconcile.isPending || simulate.isPending;

  return (
    <>
      <PageHeader
        action={
          <div className="flex flex-wrap items-center gap-2">
            {invoice ? (
              <Button
                nativeButton={false}
                render={
                  <Link
                    href={`/print/invoices/${invoice.id}`}
                    rel="noopener noreferrer"
                    target="_blank"
                  />
                }
                size="sm"
                variant="outline"
              >
                Cetak / Simpan PDF
              </Button>
            ) : null}
            <Button
              nativeButton={false}
              render={<Link href="/app/billing" />}
              size="sm"
              variant="outline"
            >
              Kembali ke invoice
            </Button>
          </div>
        }
        description={
          invoice
            ? `Dibuat ${formatDate(invoice.createdAt)} · ${invoice.customerName}`
            : "Detail invoice dan pembayaran."
        }
        title={invoice?.number ?? "Detail invoice"}
      />
      {detail.isPending ? (
        <DetailLoading />
      ) : detail.error ? (
        <ErrorNotice
          error={detail.error}
          onRetry={() => {
            void detail.refetch();
          }}
        />
      ) : invoice ? (
        <>
          {invoice.reconciliationRequired ? (
            <Alert variant="warning">
              <TriangleAlert aria-hidden="true" />
              <AlertTitle>Perlu rekonsiliasi manual</AlertTitle>
              <AlertDescription>
                Periksa transaksi ganda, refund, atau chargeback di Midtrans.
                Status lunas tidak berubah otomatis setelah refund.
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.6fr)]">
            <div className="flex min-w-0 flex-col gap-6">
              <Frame>
                <FrameHeader>
                  <FrameTitle>
                    <h2>Ringkasan invoice</h2>
                  </FrameTitle>
                </FrameHeader>
                <FramePanel className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <PaymentBadge status={invoice.paymentStatus} />
                    {hasSimulatedPayment ? (
                      <Badge variant="info-light">Simulasi internal</Badge>
                    ) : null}
                  </div>
                  <dl className="grid gap-4 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <dt className="text-xs text-muted-foreground">Order</dt>
                      <dd>
                        <Link
                          className="font-mono text-xs font-medium underline-offset-4 hover:underline"
                          href={`/app/orders/${invoice.orderId}`}
                        >
                          {invoice.orderNumber}
                        </Link>
                      </dd>
                    </div>
                    <div className="flex flex-col gap-1">
                      <dt className="text-xs text-muted-foreground">Paket</dt>
                      <dd>{invoice.packageName}</dd>
                    </div>
                    <div className="flex flex-col gap-1">
                      <dt className="text-xs text-muted-foreground">
                        Nominal invoice
                      </dt>
                      <dd className="text-2xl font-semibold tracking-tight tabular-nums">
                        {formatIdr(invoice.amountIdr)}
                      </dd>
                    </div>
                    <div className="flex flex-col gap-1">
                      <dt className="text-xs text-muted-foreground">
                        Biaya supplier paket
                      </dt>
                      <dd className="tabular-nums">
                        {formatIdr(invoice.supplierCostIdr)}
                      </dd>
                    </div>
                    <div className="flex flex-col gap-1">
                      <dt className="text-xs text-muted-foreground">
                        Margin bruto
                      </dt>
                      <dd className="tabular-nums">
                        {invoice.marginIdr === null
                          ? "Belum terealisasi"
                          : formatIdr(invoice.marginIdr)}
                      </dd>
                    </div>
                    <div className="flex flex-col gap-1">
                      <dt className="text-xs text-muted-foreground">
                        Dicatat lunas
                      </dt>
                      <dd className="text-xs">
                        {invoice.paidAt
                          ? formatDate(invoice.paidAt)
                          : "Belum lunas"}
                      </dd>
                    </div>
                    {invoice.cancelledAt ? (
                      <div className="flex flex-col gap-1">
                        <dt className="text-xs text-muted-foreground">
                          Dibatalkan
                        </dt>
                        <dd className="text-xs">
                          {formatDate(invoice.cancelledAt)}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                  <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                    <span className="text-xs text-muted-foreground">
                      Penerbitan profil
                    </span>
                    <FulfillmentBadge status={invoice.fulfillmentStatus} />
                  </div>
                </FramePanel>
              </Frame>
              <InvoiceAdjustments
                adjustments={detail.data?.adjustments ?? []}
                invoice={invoice}
              />
              <Frame>
                <FrameHeader>
                  <FrameTitle>
                    <h2>Riwayat upaya pembayaran</h2>
                  </FrameTitle>
                </FrameHeader>
                <FramePanel>
                  {attempts.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Belum ada upaya pembayaran.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-4">
                      {attempts.map((attempt) => (
                        <li
                          className="flex flex-wrap items-start justify-between gap-3 border-b pb-4 last:border-b-0 last:pb-0"
                          key={attempt.id}
                        >
                          <div className="flex min-w-0 flex-col gap-1">
                            <p className="font-medium">
                              {attempt.source === "demo"
                                ? "Simulasi internal · validasi ERP"
                                : "Midtrans Snap"}
                            </p>
                            <p className="break-all font-mono text-xs">
                              {attempt.gatewayOrderId}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatDate(attempt.createdAt)}
                            </p>
                          </div>
                          <Badge
                            variant={ATTEMPT_STATES[attempt.status].variant}
                          >
                            {ATTEMPT_STATES[attempt.status].label}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </FramePanel>
              </Frame>
            </div>
            <Frame>
              <FrameHeader>
                <FrameTitle>
                  <h2>Pembayaran</h2>
                </FrameTitle>
                <FrameDescription>
                  {dashboard.data?.demoPaymentsEnabled
                    ? "Midtrans Snap atau simulasi internal."
                    : "Pembayaran melalui Midtrans Snap (sandbox)."}
                </FrameDescription>
              </FrameHeader>
              <FramePanel className="flex flex-col gap-4">
                {dashboard.isPending ? (
                  <p
                    aria-live="polite"
                    className="text-sm text-muted-foreground"
                  >
                    Memeriksa konfigurasi pembayaran…
                  </p>
                ) : dashboard.error ? (
                  <ErrorNotice
                    error={dashboard.error}
                    onRetry={() => {
                      void dashboard.refetch();
                    }}
                  />
                ) : (
                  <>
                    {!dashboard.data?.midtransConfigured ? (
                      <Alert variant="warning">
                        <AlertTitle>Midtrans belum tersedia</AlertTitle>
                        <AlertDescription>
                          Hubungi administrator untuk mengaktifkan integrasi
                          Midtrans.
                        </AlertDescription>
                      </Alert>
                    ) : null}
                    {invoice.paymentStatus === "paid" ? (
                      <p className="text-sm text-muted-foreground">
                        {hasSimulatedPayment
                          ? "Invoice lunas melalui simulasi internal, bukan transaksi Midtrans."
                          : "Invoice sudah lunas. Payment link baru tidak diperlukan."}
                      </p>
                    ) : invoice.paymentStatus === "cancelled" ? (
                      <p className="text-sm text-muted-foreground">
                        Order dibatalkan sebelum upaya pembayaran. Invoice tidak
                        dapat ditagih.
                      </p>
                    ) : activeAttempt ? (
                      <>
                        <Badge
                          variant={ATTEMPT_STATES[activeAttempt.status].variant}
                        >
                          {ATTEMPT_STATES[activeAttempt.status].label}
                        </Badge>
                        {activeAttempt.redirectUrl ? (
                          <div className="flex flex-col gap-2">
                            <Button
                              nativeButton={false}
                              render={
                                <a
                                  href={activeAttempt.redirectUrl}
                                  rel="noopener noreferrer"
                                  target="_blank"
                                />
                              }
                              size="sm"
                              variant="outline"
                            >
                              <ExternalLink
                                aria-hidden="true"
                                data-icon="inline-start"
                              />
                              Buka pembayaran
                            </Button>
                            <Button
                              onClick={handleCopyLink}
                              size="sm"
                              type="button"
                              variant="outline"
                            >
                              <Copy
                                aria-hidden="true"
                                data-icon="inline-start"
                              />
                              Salin payment link
                            </Button>
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            Link belum tersedia. Periksa status sebelum membuat
                            upaya pembayaran baru.
                          </p>
                        )}
                      </>
                    ) : (
                      <Button
                        disabled={isBusy || !dashboard.data?.midtransConfigured}
                        onClick={handleCreateLink}
                        size="sm"
                        type="button"
                      >
                        {createLink.isPending ? (
                          <LoaderCircle
                            aria-hidden="true"
                            className="animate-spin motion-reduce:animate-none"
                          />
                        ) : (
                          <Link2 aria-hidden="true" data-icon="inline-start" />
                        )}
                        Buat payment link
                      </Button>
                    )}
                    {hasMidtransAttempt ? (
                      <Button
                        disabled={isBusy || !dashboard.data?.midtransConfigured}
                        onClick={handleReconcile}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <RefreshCw
                          aria-hidden="true"
                          className={
                            reconcile.isPending
                              ? "animate-spin motion-reduce:animate-none"
                              : undefined
                          }
                          data-icon="inline-start"
                        />
                        Periksa status Midtrans
                      </Button>
                    ) : null}
                    {dashboard.data?.demoPaymentsEnabled &&
                    invoice.paymentStatus === "unpaid" &&
                    !invoice.reconciliationRequired &&
                    attempts.length === 0 ? (
                      <div className="flex flex-col gap-2">
                        <Button
                          disabled={isBusy}
                          onClick={() => {
                            simulate.reset();
                            setSimulationOpen(true);
                          }}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          Simulasikan pelunasan
                        </Button>
                        <p className="text-xs text-muted-foreground">
                          Tanpa transaksi Midtrans; dicatat sebagai simulasi
                          internal.
                        </p>
                      </div>
                    ) : null}
                  </>
                )}
              </FramePanel>
            </Frame>
          </div>
        </>
      ) : null}
      {invoice && isSimulationOpen ? (
        <AlertDialog
          onOpenChange={(open) => {
            if (!open && !simulate.isPending) {
              setSimulationOpen(false);
              simulate.reset();
            }
          }}
          open
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Simulasikan pelunasan {invoice.number}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                ERP akan memvalidasi invoice {formatIdr(invoice.amountIdr)} dan
                mencatatnya lunas tanpa transaksi Midtrans. Penerbitan profil
                akan dijadwalkan.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {simulate.error ? (
              <Alert variant="destructive">
                <AlertTitle>Pelunasan belum tercatat</AlertTitle>
                <AlertDescription>
                  {simulate.error instanceof Error
                    ? simulate.error.message
                    : "Periksa status invoice sebelum mencoba lagi."}
                </AlertDescription>
              </Alert>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={simulate.isPending} size="sm">
                Kembali
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={simulate.isPending}
                onClick={() => void handleSimulate()}
                size="sm"
                type="button"
              >
                {simulate.isPending
                  ? "Mencatat pelunasan…"
                  : "Catat pelunasan simulasi"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </>
  );
}
