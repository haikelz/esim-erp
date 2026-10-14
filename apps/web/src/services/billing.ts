import {
  type FinancePeriod,
  type FinanceSummary,
  financePeriodSchema,
  financeSummarySchema,
  type InvoiceAdjustmentInput,
  type InvoiceDetail,
  type InvoicePage,
  type InvoiceQuery,
  invoiceAdjustmentInputSchema,
  invoiceDetailSchema,
  invoicePageSchema,
  invoiceQuerySchema,
  okSchema,
  type PaymentAttempt,
  paymentAttemptSchema,
} from "@esim-erp/contracts";
import { request, requestCsv } from "@/lib/http";

export function listInvoices(
  query: InvoiceQuery,
  signal?: AbortSignal,
): Promise<InvoicePage> {
  const filters = invoiceQuerySchema.parse(query);
  const params = new URLSearchParams({
    page: String(filters.page),
    limit: String(filters.limit),
    search: filters.search,
  });
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);

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
  period: FinancePeriod,
  signal?: AbortSignal,
): Promise<FinanceSummary> {
  const filters = financePeriodSchema.parse(period);
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);

  return request(`/api/backend/finance?${params}`, financeSummarySchema, {
    signal,
  });
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

export function recordInvoiceAdjustment(
  id: string,
  input: InvoiceAdjustmentInput,
) {
  return request(
    `/api/backend/invoices/${encodeURIComponent(id)}/adjustments`,
    okSchema,
    {
      method: "POST",
      body: JSON.stringify(invoiceAdjustmentInputSchema.parse(input)),
    },
  );
}

export function exportInvoices(query: InvoiceQuery) {
  const filters = invoiceQuerySchema.parse(query);
  const params = new URLSearchParams({ search: filters.search });
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);

  return requestCsv(`/api/backend/invoices/export?${params}`);
}
