"use client";

import type { ListQuery } from "@esim-erp/contracts";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/lib/query-keys";
import { getCustomer, listCustomers } from "@/services/customers";

export function useCustomers(query: ListQuery) {
  return useQuery({
    queryKey: [...QUERY_KEYS.customers, "list", query],
    queryFn: ({ signal }) => listCustomers(query, signal),
    placeholderData: keepPreviousData,
    staleTime: 10000,
  });
}

export function useCustomer(
  id: string,
  query: Pick<ListQuery, "page" | "limit">,
) {
  return useQuery({
    queryKey: [...QUERY_KEYS.customers, id, query],
    queryFn: ({ signal }) => getCustomer(id, query, signal),
    placeholderData: keepPreviousData,
    staleTime: 10000,
  });
}
