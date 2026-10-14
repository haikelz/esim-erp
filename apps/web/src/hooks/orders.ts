"use client";

import type { ListQuery } from "@esim-erp/contracts";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { recordPollingInterval } from "@/lib/polling";
import { QUERY_KEYS } from "@/lib/query-keys";
import {
  createOrder,
  getOrder,
  listOrders,
  retryProvisioning,
  revealInstallation,
} from "@/services/orders";

export function useOrders(query: ListQuery) {
  return useQuery({
    queryKey: [...QUERY_KEYS.orders, "list", query],
    queryFn: ({ signal }) => listOrders(query, signal),
    placeholderData: keepPreviousData,
    staleTime: 10000,
    refetchInterval: (current) =>
      current.state.status !== "error" &&
      current.state.data?.orders.some((order) => recordPollingInterval(order))
        ? 10000
        : false,
    refetchIntervalInBackground: false,
  });
}

export function useOrder(id: string) {
  return useQuery({
    queryKey: [...QUERY_KEYS.orders, id],
    queryFn: ({ signal }) => getOrder(id, signal),
    staleTime: 10000,
    refetchInterval: (current) =>
      current.state.status === "error"
        ? false
        : recordPollingInterval(current.state.data),
    refetchIntervalInBackground: false,
  });
}

export function useCreateOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createOrder,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.orders }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.invoices }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.finance }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dashboard }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.exceptions }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.audit }),
      ]),
  });
}

export function useRevealInstallation() {
  return useMutation({ mutationFn: revealInstallation, gcTime: 0 });
}

export function useRetryProvisioning() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: retryProvisioning,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.orders }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.invoices }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.finance }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dashboard }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.catalog }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.exceptions }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.audit }),
      ]),
  });
}
