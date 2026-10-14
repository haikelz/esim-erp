"use client";

import type { ListQuery } from "@esim-erp/contracts";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { QUERY_KEYS } from "@/lib/query-keys";
import { listProducts, syncProducts, updateProduct } from "@/services/catalog";

export function useProducts(query: ListQuery) {
  return useQuery({
    queryKey: [...QUERY_KEYS.catalog, query],
    queryFn: ({ signal }) => listProducts(query, signal),
    placeholderData: keepPreviousData,
  });
}

export function useSyncProducts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: syncProducts,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.catalog }),
  });
}

export function useUpdateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateProduct,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.catalog }),
  });
}
