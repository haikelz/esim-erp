"use client";

import type { ListQuery } from "@esim-erp/contracts";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { QUERY_KEYS } from "@/lib/query-keys";
import {
  createPaymentLink,
  getFinanceSummary,
  getInvoice,
  listInvoices,
  reconcilePayment,
} from "@/services/billing";

export function useInvoices(query: ListQuery) {
  return useQuery({
    queryKey: [...QUERY_KEYS.invoices, "list", query],
    queryFn: ({ signal }) => listInvoices(query, signal),
    placeholderData: keepPreviousData,
  });
}

export function useInvoice(id: string) {
  return useQuery({
    queryKey: [...QUERY_KEYS.invoices, id],
    queryFn: ({ signal }) => getInvoice(id, signal),
    refetchInterval: 10000,
  });
}

export function useFinanceSummary() {
  return useQuery({
    queryKey: QUERY_KEYS.finance,
    queryFn: ({ signal }) => getFinanceSummary(signal),
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
      ]),
  });
}
