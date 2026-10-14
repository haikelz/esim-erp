import {
  type FinanceSummary,
  financeSummarySchema,
  type InvoiceDetail,
  type InvoicePage,
  invoiceDetailSchema,
  invoicePageSchema,
  type ListQuery,
  okSchema,
  type PaymentAttempt,
  paymentAttemptSchema,
} from "@esim-erp/contracts";
import { request } from "@/lib/http";

export function listInvoices(
  query: ListQuery,
  signal?: AbortSignal,
): Promise<InvoicePage> {
  const params = new URLSearchParams({
    page: String(query.page),
    limit: String(query.limit),
    search: query.search,
  });
  return request(`/api/backend/invoices?${params}`, invoicePageSchema, {
    signal,
  });
}

export function getInvoice(
  id: string,
  signal?: AbortSignal,
): Promise<InvoiceDetail> {
  return request(
    `/api/backend/invoices/${encodeURIComponent(id)}`,
    invoiceDetailSchema,
    { signal },
  );
}

export function getFinanceSummary(
  signal?: AbortSignal,
): Promise<FinanceSummary> {
  return request("/api/backend/finance", financeSummarySchema, { signal });
}

export function createPaymentLink(id: string): Promise<PaymentAttempt> {
  return request(
    `/api/backend/invoices/${encodeURIComponent(id)}/payment-link`,
    paymentAttemptSchema,
    { method: "POST" },
  );
}

export function reconcilePayment(id: string) {
  return request(
    `/api/backend/invoices/${encodeURIComponent(id)}/reconcile`,
    okSchema,
    { method: "POST" },
  );
}
