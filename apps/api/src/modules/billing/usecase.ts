import type {
  FinanceSummary,
  InvoiceDetail,
  InvoicePage,
  ListQuery,
  PaymentAttempt,
  Staff,
} from "@esim-erp/contracts";
import { requireRole } from "../auth/usecase";
import { DomainError } from "../errors";

export type VerifiedPayment = {
  gatewayOrderId: string;
  grossAmount: string;
  status: "pending" | "paid" | "failed" | "expired" | "review";
  transactionId: string;
};

export type MidtransNotification = {
  order_id: string;
  status_code: string;
  gross_amount: string;
  signature_key: string;
};

export type PaymentGateway = {
  createLink: (input: {
    gatewayOrderId: string;
    amountIdr: number;
    customerName: string;
    customerEmail: string;
  }) => Promise<string>;
  verifyNotification: (notification: MidtransNotification) => Promise<boolean>;
  getStatus: (gatewayOrderId: string) => Promise<VerifiedPayment>;
};

export type BillingRepository = {
  list: (query: ListQuery) => Promise<InvoicePage>;
  find: (id: string) => Promise<InvoiceDetail | undefined>;
  summary: () => Promise<FinanceSummary>;
  reserveAttempt: (
    invoiceId: string,
    source: "midtrans" | "demo",
  ) => Promise<{
    attempt: PaymentAttempt;
    amountIdr: number;
    customerName: string;
    customerEmail: string;
    isNew: boolean;
  }>;
  saveLink: (attemptId: string, redirectUrl: string) => Promise<void>;
  failCreation: (attemptId: string, isAmbiguous: boolean) => Promise<void>;
  recordVerifiedPayment: (
    payment: VerifiedPayment,
    source: "midtrans" | "demo",
  ) => Promise<void>;
};

export function assertBillingRole(staff: Staff) {
  requireRole(staff, ["admin", "finance"]);
}

export async function getInvoice(
  repository: BillingRepository,
  staff: Staff,
  id: string,
) {
  assertBillingRole(staff);

  const invoice = await repository.find(id);
  if (!invoice) {
    throw new DomainError("invoice_not_found", 404, "Invoice tidak ditemukan.");
  }

  return invoice;
}

export async function createPaymentLink(
  repository: BillingRepository,
  gateway: PaymentGateway,
  staff: Staff,
  invoiceId: string,
) {
  assertBillingRole(staff);

  const reservation = await repository.reserveAttempt(invoiceId, "midtrans");
  if (!reservation.isNew) {
    if (reservation.attempt.redirectUrl) return reservation.attempt;
    throw new DomainError(
      "payment_creation_uncertain",
      409,
      "Hasil pembuatan link belum pasti. Periksa status Midtrans; jangan membuat pembayaran baru.",
    );
  }

  try {
    const redirectUrl = await gateway.createLink({
      amountIdr: reservation.amountIdr,
      customerEmail: reservation.customerEmail,
      customerName: reservation.customerName,
      gatewayOrderId: reservation.attempt.gatewayOrderId,
    });
    await repository.saveLink(reservation.attempt.id, redirectUrl);

    return { ...reservation.attempt, redirectUrl, status: "pending" as const };
  } catch (error) {
    await repository.failCreation(
      reservation.attempt.id,
      !(error instanceof DomainError && error.code === "payment_rejected"),
    );
    throw error;
  }
}

export async function receiveNotification(
  repository: BillingRepository,
  gateway: PaymentGateway,
  notification: MidtransNotification,
) {
  if (!(await gateway.verifyNotification(notification))) {
    throw new DomainError(
      "invalid_signature",
      403,
      "Signature pembayaran tidak valid.",
    );
  }

  const payment = await gateway.getStatus(notification.order_id);
  if (payment.gatewayOrderId !== notification.order_id) {
    throw new DomainError(
      "payment_order_mismatch",
      409,
      "Referensi pembayaran tidak cocok.",
    );
  }

  await repository.recordVerifiedPayment(payment, "midtrans");
}

export async function reconcilePayment(
  repository: BillingRepository,
  gateway: PaymentGateway,
  staff: Staff,
  invoiceId: string,
) {
  const detail = await getInvoice(repository, staff, invoiceId);
  const attempt = detail.attempts.find(
    (payment) => payment.source === "midtrans",
  );
  if (!attempt) {
    throw new DomainError(
      "payment_not_created",
      409,
      "Belum ada transaksi Midtrans untuk invoice ini.",
    );
  }

  await repository.recordVerifiedPayment(
    await gateway.getStatus(attempt.gatewayOrderId),
    "midtrans",
  );
}

export async function simulatePayment(
  repository: BillingRepository,
  staff: Staff,
  invoiceId: string,
  isEnabled: boolean,
) {
  assertBillingRole(staff);
  if (!isEnabled) {
    throw new DomainError(
      "demo_disabled",
      403,
      "Pembayaran pengujian tidak tersedia di lingkungan ini.",
    );
  }

  const reservation = await repository.reserveAttempt(invoiceId, "demo");
  await repository.recordVerifiedPayment(
    {
      gatewayOrderId: reservation.attempt.gatewayOrderId,
      grossAmount: `${reservation.amountIdr}.00`,
      status: "paid",
      transactionId: `demo-${reservation.attempt.id}`,
    },
    "demo",
  );
}
