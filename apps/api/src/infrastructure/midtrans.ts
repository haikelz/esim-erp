import { z } from "zod";
import type {
  MidtransNotification,
  PaymentGateway,
  VerifiedPayment,
} from "../modules/billing/usecase";
import { DomainError } from "../modules/errors";
import { secureEqual } from "./crypto";

export const midtransNotificationSchema = z.object({
  order_id: z.string().min(1).max(100),
  status_code: z.string().regex(/^\d{3}$/),
  gross_amount: z
    .string()
    .regex(/^\d+(?:\.\d{2})?$/)
    .max(30),
  signature_key: z.string().regex(/^[a-fA-F0-9]{128}$/),
});

const snapResponseSchema = z.object({
  token: z.string().min(1),
  redirect_url: z.url(),
});
const statusResponseSchema = z.object({
  order_id: z.string(),
  gross_amount: z.string().regex(/^\d+(?:\.\d{2})?$/),
  transaction_id: z.string().min(1),
  transaction_status: z.string(),
  currency: z.literal("IDR"),
  fraud_status: z.enum(["accept", "challenge", "deny"]).optional(),
});

export function createMidtransGateway(
  serverKey: string | undefined,
  transport: typeof fetch = fetch,
): PaymentGateway {
  if (!serverKey) {
    throw new DomainError(
      "midtrans_not_configured",
      503,
      "Server Key sandbox Midtrans belum dikonfigurasi.",
    );
  }

  const headers = {
    Accept: "application/json",
    Authorization: `Basic ${btoa(`${serverKey}:`)}`,
    "Content-Type": "application/json",
  };

  async function createLink(
    input: Parameters<PaymentGateway["createLink"]>[0],
  ) {
    const response = await transport(
      "https://app.sandbox.midtrans.com/snap/v1/transactions",
      {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(8000),
        body: JSON.stringify({
          transaction_details: {
            order_id: input.gatewayOrderId,
            gross_amount: input.amountIdr,
          },
          customer_details: {
            first_name: input.customerName,
            email: input.customerEmail,
          },
          credit_card: { secure: true },
        }),
      },
    );
    if (!response.ok) {
      const isRejected = response.status === 401 || response.status === 403;
      throw new DomainError(
        isRejected ? "payment_rejected" : "payment_creation_uncertain",
        502,
        isRejected
          ? "Midtrans menolak autentikasi. Periksa Server Key sandbox."
          : "Hasil pembuatan link Midtrans belum pasti. Rekonsiliasi sebelum mencoba lagi.",
      );
    }

    const payload: unknown = await response.json();
    const parsed = snapResponseSchema.parse(payload);
    const redirect = new URL(parsed.redirect_url);
    if (
      redirect.protocol !== "https:" ||
      redirect.hostname !== "app.sandbox.midtrans.com" ||
      redirect.port ||
      redirect.username ||
      redirect.password
    ) {
      throw new DomainError(
        "invalid_payment_url",
        502,
        "Midtrans mengembalikan alamat pembayaran yang tidak valid.",
      );
    }

    return parsed.redirect_url;
  }

  async function verifyNotification(notification: MidtransNotification) {
    const input =
      notification.order_id +
      notification.status_code +
      notification.gross_amount +
      serverKey;
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-512", new TextEncoder().encode(input)),
    );
    const signature = Array.from(digest, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");

    return secureEqual(signature, notification.signature_key.toLowerCase());
  }

  async function getStatus(gatewayOrderId: string): Promise<VerifiedPayment> {
    const response = await transport(
      `https://api.sandbox.midtrans.com/v2/${encodeURIComponent(gatewayOrderId)}/status`,
      { headers, signal: AbortSignal.timeout(8000) },
    );
    if (!response.ok) {
      throw new DomainError(
        "payment_status_unavailable",
        502,
        "Status Midtrans belum tersedia. Periksa dashboard sandbox sebelum mencoba lagi.",
      );
    }

    const payload: unknown = await response.json();
    const parsed = statusResponseSchema.safeParse(payload);
    if (!parsed.success || parsed.data.order_id !== gatewayOrderId) {
      throw new DomainError(
        "invalid_payment_status",
        502,
        "Status Midtrans tidak sesuai dengan kontrak pembayaran.",
      );
    }

    const transaction = parsed.data;
    let status: VerifiedPayment["status"];
    switch (transaction.transaction_status) {
      case "settlement":
        status = "paid";
        break;
      case "capture":
        status =
          transaction.fraud_status === "accept"
            ? "paid"
            : transaction.fraud_status === "deny"
              ? "failed"
              : "pending";
        break;
      case "pending":
      case "authorize":
        status = "pending";
        break;
      case "expire":
        status = "expired";
        break;
      case "deny":
      case "cancel":
      case "failure":
        status = "failed";
        break;
      case "refund":
      case "partial_refund":
      case "chargeback":
      case "partial_chargeback":
        status = "review";
        break;
      default:
        throw new DomainError(
          "unsupported_payment_status",
          502,
          "Status pembayaran memerlukan pemeriksaan manual di Midtrans.",
        );
    }

    return {
      gatewayOrderId: transaction.order_id,
      grossAmount: transaction.gross_amount,
      status,
      transactionId: transaction.transaction_id,
    };
  }

  return { createLink, getStatus, verifyNotification };
}
