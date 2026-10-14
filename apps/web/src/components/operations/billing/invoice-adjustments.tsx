"use client";

import {
  type Invoice,
  type InvoiceAdjustment,
  type InvoiceAdjustmentInput,
  invoiceAdjustmentInputSchema,
} from "@esim-erp/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { Badge } from "@/components/reui/badge";
import {
  Frame,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@/components/reui/frame";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useRecordInvoiceAdjustment } from "@/hooks/billing";
import { formatDate, formatIdr } from "@/lib/format";

const ADJUSTMENT_OPTIONS = [
  { value: "gateway_fee", label: "Fee payment gateway" },
  { value: "refund", label: "Refund" },
] as const;

type AdjustmentFormDialogProps = {
  readonly invoice: Invoice;
  readonly onClose: () => void;
};

function AdjustmentFormDialog({ invoice, onClose }: AdjustmentFormDialogProps) {
  const form = useForm<InvoiceAdjustmentInput>({
    defaultValues: {
      kind: "gateway_fee",
      amountIdr: 0,
      reference: "",
      reason: "",
    },
    resolver: zodResolver(invoiceAdjustmentInputSchema),
  });
  const adjustment = useRecordInvoiceAdjustment();
  const errors = form.formState.errors;

  async function handleSubmit(values: InvoiceAdjustmentInput) {
    try {
      await adjustment.mutateAsync({ id: invoice.id, values });
      toast.success(
        values.kind === "refund"
          ? "Refund tercatat; belum diajukan ke Midtrans."
          : "Fee gateway dicatat.",
      );
      onClose();
    } catch (error) {
      form.setError("root", {
        message:
          error instanceof Error
            ? error.message
            : "Penyesuaian belum dapat dicatat. Periksa riwayat sebelum mencoba lagi.",
      });
    }
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !adjustment.isPending) onClose();
      }}
      open
    >
      <DialogContent showCloseButton={!adjustment.isPending}>
        <DialogHeader>
          <DialogTitle>Catat penyesuaian</DialogTitle>
          <DialogDescription>
            {invoice.number}. Catatan tidak dapat dihapus dan tidak mengirim
            refund ke Midtrans.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={form.handleSubmit(handleSubmit)}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="adjustment-kind">Jenis penyesuaian</Label>
            <Controller
              control={form.control}
              name="kind"
              render={({ field }) => (
                <Select
                  items={ADJUSTMENT_OPTIONS}
                  onValueChange={(value) => {
                    if (value) field.onChange(value);
                  }}
                  value={field.value}
                >
                  <SelectTrigger
                    className="w-full"
                    id="adjustment-kind"
                    onBlur={field.onBlur}
                    ref={field.ref}
                    size="sm"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ADJUSTMENT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="adjustment-amount">Nominal (Rp)</Label>
            <Input
              aria-describedby="adjustment-amount-help adjustment-amount-error"
              aria-invalid={Boolean(errors.amountIdr)}
              id="adjustment-amount"
              inputMode="numeric"
              min={1}
              step={1}
              type="number"
              {...form.register("amountIdr", { valueAsNumber: true })}
            />
            <p
              className="text-xs text-muted-foreground"
              id="adjustment-amount-help"
            >
              Rupiah bulat, tanpa titik pemisah. Sisa batas refund:{" "}
              {formatIdr(invoice.amountIdr - invoice.refundIdr)}.
            </p>
            {errors.amountIdr ? (
              <p
                className="text-xs text-destructive"
                id="adjustment-amount-error"
              >
                {errors.amountIdr.message}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="adjustment-reference">
              Referensi bukti transaksi
            </Label>
            <Input
              aria-describedby={
                errors.reference ? "adjustment-reference-error" : undefined
              }
              aria-invalid={Boolean(errors.reference)}
              id="adjustment-reference"
              maxLength={100}
              placeholder="Nomor settlement atau refund"
              {...form.register("reference")}
            />
            {errors.reference ? (
              <p
                className="text-xs text-destructive"
                id="adjustment-reference-error"
              >
                {errors.reference.message}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="adjustment-reason">Alasan pencatatan</Label>
            <Textarea
              aria-describedby={
                errors.reason ? "adjustment-reason-error" : undefined
              }
              aria-invalid={Boolean(errors.reason)}
              id="adjustment-reason"
              maxLength={500}
              rows={3}
              {...form.register("reason")}
            />
            {errors.reason ? (
              <p
                className="text-xs text-destructive"
                id="adjustment-reason-error"
              >
                {errors.reason.message}
              </p>
            ) : null}
          </div>
          {errors.root ? (
            <Alert variant="destructive">
              <AlertDescription>{errors.root.message}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button
              disabled={adjustment.isPending}
              onClick={onClose}
              size="sm"
              type="button"
              variant="outline"
            >
              Batal
            </Button>
            <Button
              aria-busy={adjustment.isPending}
              disabled={adjustment.isPending}
              size="sm"
              type="submit"
            >
              Simpan penyesuaian
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type InvoiceAdjustmentsProps = {
  readonly adjustments: InvoiceAdjustment[];
  readonly invoice: Invoice;
};

export function InvoiceAdjustments({
  adjustments,
  invoice,
}: InvoiceAdjustmentsProps) {
  const [isRecording, setIsRecording] = useState(false);
  const hasFeeRecord = adjustments.some(
    (adjustment) => adjustment.kind === "gateway_fee",
  );

  return (
    <>
      <Frame>
        <FrameHeader className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <FrameTitle>
              <h2>Fee & refund</h2>
            </FrameTitle>
          </div>
          <Button
            aria-describedby="invoice-adjustment-help"
            disabled={invoice.paymentStatus !== "paid"}
            onClick={() => setIsRecording(true)}
            size="sm"
            type="button"
            variant="outline"
          >
            <Plus aria-hidden="true" data-icon="inline-start" />
            Catat penyesuaian
          </Button>
        </FrameHeader>
        <FramePanel className="flex flex-col gap-4">
          <dl className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-muted-foreground">
                Fee gateway tercatat
              </dt>
              <dd className="tabular-nums">
                {hasFeeRecord
                  ? formatIdr(invoice.gatewayFeeIdr)
                  : "Belum dicatat"}
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-muted-foreground">Refund tercatat</dt>
              <dd className="tabular-nums">{formatIdr(invoice.refundIdr)}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-muted-foreground">
                Margin neto tercatat
              </dt>
              <dd className="tabular-nums">
                {invoice.netMarginIdr === null
                  ? "Belum terealisasi"
                  : formatIdr(invoice.netMarginIdr)}
              </dd>
            </div>
          </dl>
          <p
            className="text-xs text-muted-foreground"
            id="invoice-adjustment-help"
          >
            Hanya invoice lunas yang dapat diberi penyesuaian. Refund tidak
            mengubah status lunas dan tidak dikirim ke gateway. Margin neto
            belum mencakup pajak atau biaya yang belum dicatat.
          </p>
          {adjustments.length ? (
            <ul className="flex flex-col gap-4 border-t pt-4">
              {adjustments.map((adjustment) => (
                <li
                  className="flex flex-col gap-2 border-b pb-4 last:border-b-0 last:pb-0"
                  key={adjustment.id}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge variant="outline">
                      {adjustment.kind === "gateway_fee"
                        ? "Fee gateway"
                        : "Refund"}
                    </Badge>
                    <span className="font-medium tabular-nums">
                      {formatIdr(adjustment.amountIdr)}
                    </span>
                  </div>
                  <p className="break-words text-sm">{adjustment.reason}</p>
                  <p className="break-all font-mono text-xs">
                    {adjustment.reference}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {adjustment.actorName} · {formatDate(adjustment.createdAt)}{" "}
                    WIB
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Belum ada penyesuaian. Cocokkan dengan bukti transaksi sebelum
              mencatat fee atau refund.
            </p>
          )}
        </FramePanel>
      </Frame>
      {isRecording ? (
        <AdjustmentFormDialog
          invoice={invoice}
          onClose={() => setIsRecording(false)}
        />
      ) : null}
    </>
  );
}
