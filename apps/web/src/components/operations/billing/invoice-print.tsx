"use client";

import type { InvoiceDetail } from "@esim-erp/contracts";
import { Printer, Radio } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatDate, formatIdr } from "@/lib/format";

const PAYMENT_LABELS: Record<
  InvoiceDetail["invoice"]["paymentStatus"],
  string
> = {
  unpaid: "Belum dibayar",
  pending: "Menunggu pembayaran",
  paid: "Lunas",
  failed: "Pembayaran gagal",
  expired: "Kedaluwarsa",
  cancelled: "Dibatalkan",
};

type InvoicePrintProps = { readonly detail: InvoiceDetail };

export function InvoicePrint({ detail }: InvoicePrintProps) {
  const { invoice, attempts } = detail;
  const isInternalPayment =
    invoice.paymentStatus === "paid" &&
    attempts.some(
      (attempt) => attempt.source === "demo" && attempt.status === "paid",
    );

  return (
    <main className="invoice-print min-h-screen bg-muted px-4 py-6 print:bg-background print:p-0 sm:px-6">
      <div className="mx-auto flex w-full max-w-[210mm] flex-col gap-4">
        <nav
          aria-label="Tindakan invoice"
          className="flex flex-wrap items-center justify-between gap-3 print:hidden"
        >
          <Button
            nativeButton={false}
            render={<Link href={`/app/billing/${invoice.id}`} />}
            size="sm"
            variant="outline"
          >
            Kembali ke invoice
          </Button>
          <Button onClick={() => window.print()} size="sm" type="button">
            <Printer aria-hidden="true" data-icon="inline-start" />
            Cetak / Simpan PDF
          </Button>
        </nav>
        <article className="invoice-paper min-h-[250mm] rounded-lg bg-card p-6 text-card-foreground ring-1 ring-border print:min-h-0 print:rounded-none print:p-0 print:ring-0 sm:p-10">
          <header className="flex flex-wrap items-start justify-between gap-6 border-b pb-8">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Radio aria-hidden="true" className="size-5" />
                eSIM ERP
              </div>
              <h1 className="text-3xl font-semibold tracking-tight">Invoice</h1>
            </div>
            <div className="flex flex-col items-start gap-2 sm:items-end print:items-end">
              <span className="font-mono text-lg font-semibold">
                {invoice.number}
              </span>
              <span className="rounded-md border px-2.5 py-1 text-xs font-medium">
                {PAYMENT_LABELS[invoice.paymentStatus]}
              </span>
            </div>
          </header>

          <dl className="grid gap-7 border-b py-8 sm:grid-cols-2 print:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-2">
              <dt className="text-xs font-medium text-muted-foreground">
                Ditagihkan kepada
              </dt>
              <dd className="font-semibold">{invoice.customerName}</dd>
              <dd className="break-all text-sm text-muted-foreground">
                {invoice.customerEmail}
              </dd>
              <dd className="text-sm text-muted-foreground">
                {invoice.customerPhone}
              </dd>
            </div>
            <div className="flex flex-col gap-2">
              <div>
                <dt className="text-xs font-medium text-muted-foreground">
                  Terbit (WIB)
                </dt>
                <dd className="mt-1 text-sm">
                  {formatDate(invoice.createdAt)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">
                  Referensi order
                </dt>
                <dd className="mt-1 font-mono text-sm">
                  {invoice.orderNumber}
                </dd>
              </div>
              {invoice.paidAt ? (
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">
                    Dicatat lunas (WIB)
                  </dt>
                  <dd className="mt-1 text-sm">{formatDate(invoice.paidAt)}</dd>
                </div>
              ) : null}
              {invoice.cancelledAt ? (
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">
                    Dibatalkan (WIB)
                  </dt>
                  <dd className="mt-1 text-sm">
                    {formatDate(invoice.cancelledAt)}
                  </dd>
                </div>
              ) : null}
            </div>
          </dl>

          <section className="py-8" aria-labelledby="invoice-items">
            <h2
              className="text-xs font-medium text-muted-foreground"
              id="invoice-items"
            >
              Rincian tagihan
            </h2>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-b pb-5 text-sm">
              <span className="font-medium">{invoice.packageName}</span>
              <span className="tabular-nums">
                {formatIdr(invoice.amountIdr)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-4 pt-5">
              <span className="text-sm font-medium">Total tagihan</span>
              <strong className="text-xl tabular-nums sm:text-2xl">
                {formatIdr(invoice.amountIdr)}
              </strong>
            </div>
          </section>

          <footer className="mt-8 border-t pt-5 text-xs leading-relaxed text-muted-foreground">
            <p>
              Dokumen ini bukan faktur pajak. Status pembayaran mengikuti
              pencatatan ERP pada saat halaman dibuka; periksa detail invoice
              untuk status terbaru.
            </p>
            {isInternalPayment ? (
              <p className="mt-2 font-medium text-card-foreground">
                Pelunasan dicatat melalui pengujian internal, bukan verifikasi
                Midtrans.
              </p>
            ) : null}
          </footer>
        </article>
      </div>
    </main>
  );
}
