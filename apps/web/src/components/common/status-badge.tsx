import type { Order } from "@esim-erp/contracts";
import { CircleAlert, CircleCheck, Clock3 } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/reui/badge";

const PAYMENT_LABELS: Record<
  Order["paymentStatus"],
  { label: string; variant: BadgeProps["variant"] }
> = {
  unpaid: { label: "Belum dibayar", variant: "secondary" },
  pending: { label: "Menunggu pembayaran", variant: "warning-light" },
  paid: { label: "Lunas", variant: "success-light" },
  expired: { label: "Kedaluwarsa", variant: "secondary" },
  failed: { label: "Pembayaran gagal", variant: "destructive-light" },
};

const FULFILLMENT_LABELS: Record<
  Order["fulfillmentStatus"],
  { label: string; variant: BadgeProps["variant"] }
> = {
  waiting_payment: { label: "Menunggu pelunasan", variant: "secondary" },
  queued: { label: "Dalam antrean", variant: "info-light" },
  processing: { label: "Diproses", variant: "info-light" },
  ready: { label: "Profil siap", variant: "success-light" },
  failed: { label: "Provisioning gagal", variant: "destructive-light" },
  unknown: { label: "Perlu pemeriksaan", variant: "warning-light" },
};

type PaymentBadgeProps = { readonly status: Order["paymentStatus"] };

export function PaymentBadge({ status }: PaymentBadgeProps) {
  const presentation = PAYMENT_LABELS[status];
  const Icon =
    status === "paid"
      ? CircleCheck
      : status === "failed"
        ? CircleAlert
        : Clock3;

  return (
    <Badge variant={presentation.variant}>
      <Icon aria-hidden="true" />
      {presentation.label}
    </Badge>
  );
}

type FulfillmentBadgeProps = { readonly status: Order["fulfillmentStatus"] };

export function FulfillmentBadge({ status }: FulfillmentBadgeProps) {
  const presentation = FULFILLMENT_LABELS[status];
  const Icon =
    status === "ready"
      ? CircleCheck
      : status === "failed" || status === "unknown"
        ? CircleAlert
        : Clock3;

  return (
    <Badge variant={presentation.variant}>
      <Icon aria-hidden="true" />
      {presentation.label}
    </Badge>
  );
}
