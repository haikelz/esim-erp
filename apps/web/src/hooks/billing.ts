"use client";

import {
  type FinancePeriod,
  type InvoiceAdjustmentInput,
  type InvoiceQuery,
  invoiceQuerySchema,
} from "@esim-erp/contracts";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useListQuery } from "@/hooks/list-query";
import { recordPollingInterval } from "@/lib/polling";
import { QUERY_KEYS } from "@/lib/query-keys";
import {
  createPaymentLink,
  exportInvoices,
  getFinanceSummary,
  getInvoice,
  getSalesBreakdown,
  listInvoices,
  reconcilePayment,
  recordInvoiceAdjustment,
} from "@/services/billing";

export function useInvoiceListQuery() {
  const list = useListQuery();
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const parsed = invoiceQuerySchema.safeParse(Object.fromEntries(params));
  const repeated = ["page", "limit", "search", "from", "to"].some(
    (field) => params.getAll(field).length > 1,
  );
  const query = parsed.success && !repeated ? parsed.data : undefined;

  function setPeriod(period: FinancePeriod) {
    const next = new URLSearchParams(params);
    next.set("page", "1");
    for (const field of ["from", "to"] as const) {
      if (period[field]) next.set(field, period[field]);
      else next.delete(field);
    }

    router.push(`${pathname}?${next}`, { scroll: false });
  }

  function resetFilters() {
    const next = new URLSearchParams(params);
    for (const field of ["page", "limit", "search", "from", "to"])
      next.delete(field);

    router.push(`${pathname}?${next}`, { scroll: false });
  }

  return {
    list,
    params: params.toString(),
    query,
    resetFilters,
    setPeriod,
    validationError: repeated
      ? "Setiap filter hanya boleh diisi sekali. Reset filter lalu coba lagi."
      : parsed.success
        ? null
        : (parsed.error.issues[0]?.message ?? "Filter belum valid."),
  };
}

export function useInvoices(query: InvoiceQuery | undefined) {
  return useQuery({
    queryKey: [...QUERY_KEYS.invoices, "list", query ?? null],
    queryFn: ({ signal }) => {
      if (!query) throw new Error("Invoice filters are invalid");
      return listInvoices(query, signal);
    },
    enabled: Boolean(query),
    placeholderData: keepPreviousData,
    staleTime: 10000,
    refetchInterval: (current) =>
      current.state.status !== "error" &&
      current.state.data?.invoices.some((invoice) =>
        recordPollingInterval(invoice),
      )
        ? 10000
        : false,
    refetchIntervalInBackground: false,
  });
}

export function useInvoice(id: string) {
  return useQuery({
    queryKey: [...QUERY_KEYS.invoices, id],
    queryFn: ({ signal }) => getInvoice(id, signal),
    staleTime: 10000,
    refetchInterval: (current) =>
      current.state.status === "error"
        ? false
        : recordPollingInterval(current.state.data?.invoice),
    refetchIntervalInBackground: false,
  });
}

export function useFinanceSummary(period: FinancePeriod | undefined) {
  return useQuery({
    queryKey: [...QUERY_KEYS.finance, period ?? null],
    queryFn: ({ signal }) => {
      if (!period) throw new Error("Finance period is invalid");
      return getFinanceSummary(period, signal);
    },
    enabled: Boolean(period),
    staleTime: 10000,
    refetchInterval: (current) =>
      current.state.status === "error" ? false : 60000,
    refetchIntervalInBackground: false,
  });
}

export function useSalesBreakdown(period: FinancePeriod | undefined) {
  return useQuery({
    queryKey: [...QUERY_KEYS.finance, "sales-breakdown", period ?? null],
    queryFn: ({ signal }) => {
      if (!period) throw new Error("Sales breakdown period is invalid");
      return getSalesBreakdown(period, signal);
    },
    enabled: Boolean(period),
    staleTime: 10000,
  });
}

export function useCreatePaymentLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createPaymentLink,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.invoices }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.orders }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dashboard }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.exceptions }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.audit }),
      ]),
  });
}

export function useReconcilePayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reconcilePayment,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.invoices }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.orders }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.finance }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dashboard }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.catalog }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.exceptions }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.audit }),
      ]),
  });
}

export function useRecordInvoiceAdjustment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      values,
    }: {
      id: string;
      values: InvoiceAdjustmentInput;
    }) => recordInvoiceAdjustment(id, values),
    retry: false,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.invoices }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.finance }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.audit }),
      ]),
  });
}

export function useExportInvoices() {
  return useMutation({ mutationFn: exportInvoices, gcTime: 0, retry: false });
}
