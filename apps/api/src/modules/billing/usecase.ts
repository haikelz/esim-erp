import type {
  FinancePeriod,
  FinanceSummary,
  Invoice,
  InvoiceAdjustmentInput,
  InvoiceDetail,
  InvoicePage,
  InvoiceQuery,
  PaymentAttempt,
  SalesBreakdown,
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
  list: (query: InvoiceQuery) => Promise<InvoicePage>;
  exportInvoices: (
    query: Pick<InvoiceQuery, "from" | "to" | "search">,
  ) => Promise<Invoice[]>;
  recordAdjustment: (
    invoiceId: string,
    actorId: string,
    input: InvoiceAdjustmentInput,
  ) => Promise<void>;
  find: (id: string) => Promise<InvoiceDetail | undefined>;
  summary: (period?: FinancePeriod) => Promise<FinanceSummary>;
  salesBreakdown: (period: FinancePeriod) => Promise<SalesBreakdown>;
  reserveAttempt: (
    invoiceId: string,
    source: "midtrans" | "demo",
    actorId?: string,
  ) => Promise<{
    attempt: PaymentAttempt;
    amountIdr: number;
    customerName: string;
    customerEmail: string;
    isNew: boolean;
  }>;
  saveLink: (
    attemptId: string,
    redirectUrl: string,
    actorId?: string,
  ) => Promise<void>;
  failCreation: (
    attemptId: string,
    isAmbiguous: boolean,
    actorId?: string,
  ) => Promise<void>;
  recordVerifiedPayment: (
    payment: VerifiedPayment,
    source: "midtrans" | "demo",
    actorId?: string,
  ) => Promise<void>;
};

export const INVOICE_EXPORT_LIMIT = 10000;

export function assertBillingRole(staff: Staff) {
  requireRole(staff, ["admin", "finance"]);
}

export function getSalesBreakdown(
  repository: BillingRepository,
  staff: Staff,
  period: FinancePeriod,
) {
  assertBillingRole(staff);
  return repository.salesBreakdown(period);
}

export function recordInvoiceAdjustment(
  repository: BillingRepository,
  staff: Staff,
  invoiceId: string,
  input: InvoiceAdjustmentInput,
) {
  assertBillingRole(staff);
  return repository.recordAdjustment(invoiceId, staff.id, input);
}

export async function exportInvoiceCsv(
  repository: BillingRepository,
  staff: Staff,
  query: Pick<InvoiceQuery, "from" | "to" | "search">,
) {
  assertBillingRole(staff);
  const invoices = await repository.exportInvoices(query);
  const rows: (string | number | null)[][] = [
    [
      "Invoice",
      "Order",
      "Pelanggan",
      "Paket",
      "Tanggal invoice (UTC)",
      "Status pembayaran",
      "Status fulfillment",
      "Rekonsiliasi diperlukan",
      "Bruto IDR",
      "Biaya supplier IDR",
      "Margin bruto IDR",
      "Biaya gateway tercatat IDR",
      "Refund tercatat IDR",
      "Margin bersih tercatat IDR",
    ],
  ];
  for (const invoice of invoices)
    rows.push([
      invoice.number,
      invoice.orderNumber,
      invoice.customerName,
      invoice.packageName,
      invoice.createdAt,
      invoice.paymentStatus,
      invoice.fulfillmentStatus,
      invoice.reconciliationRequired ? "Ya" : "Tidak",
      invoice.amountIdr,
      invoice.supplierCostIdr,
      invoice.marginIdr,
      invoice.gatewayFeeIdr,
      invoice.refundIdr,
      invoice.netMarginIdr,
    ]);

  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function csvCell(value: string | number | null) {
  if (typeof value === "number") return String(value);

  const text = value ?? "";
  // Quoting alone does not prevent spreadsheet formula execution.
  const safe =
    /^\s*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
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

  const reservation = await repository.reserveAttempt(
    invoiceId,
    "midtrans",
    staff.id,
  );
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
    await repository.saveLink(reservation.attempt.id, redirectUrl, staff.id);

    return { ...reservation.attempt, redirectUrl, status: "pending" as const };
  } catch (error) {
    await repository.failCreation(
      reservation.attempt.id,
      !(error instanceof DomainError && error.code === "payment_rejected"),
      staff.id,
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
    staff.id,
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
      "Simulasi pembayaran tidak aktif. Hubungi administrator.",
    );
  }

  const reservation = await repository.reserveAttempt(
    invoiceId,
    "demo",
    staff.id,
  );
  await repository.recordVerifiedPayment(
    {
      gatewayOrderId: reservation.attempt.gatewayOrderId,
      grossAmount: `${reservation.amountIdr}.00`,
      status: "paid",
      transactionId: `demo-${reservation.attempt.id}`,
    },
    "demo",
    staff.id,
  );
}
