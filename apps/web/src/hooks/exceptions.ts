"use client";

import {
  EXCEPTION_KINDS,
  type ExceptionFollowUpInput,
  type ExceptionKind,
  type ExceptionQuery,
} from "@esim-erp/contracts";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useListQuery } from "@/hooks/list-query";
import { HttpError } from "@/lib/http";
import { QUERY_KEYS } from "@/lib/query-keys";
import {
  listExceptionAssignees,
  listExceptionFollowUps,
  listExceptions,
  processFulfillment,
  recordExceptionFollowUp,
} from "@/services/exceptions";

export function useExceptionListQuery() {
  const list = useListQuery();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const kind = EXCEPTION_KINDS.find(
    (candidate) => candidate === searchParams.get("kind"),
  );
  const query: ExceptionQuery = { ...list.query, kind };

  function setKind(nextKind: ExceptionKind | undefined) {
    const params = new URLSearchParams(searchParams);
    params.set("page", "1");
    if (nextKind) params.set("kind", nextKind);
    else params.delete("kind");

    router.push(`${pathname}?${params}`, { scroll: false });
  }

  function resetFilters() {
    const params = new URLSearchParams(searchParams);
    params.delete("kind");
    params.delete("search");
    params.set("page", "1");

    router.push(`${pathname}?${params}`, { scroll: false });
  }

  return { ...list, query, resetFilters, setKind };
}

export function useExceptions(query: ExceptionQuery) {
  const exceptions = useQuery({
    queryKey: [...QUERY_KEYS.exceptions, "list", query],
    queryFn: ({ signal }) => listExceptions(query, signal),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: false,
    retryOnMount: false,
    refetchInterval: (current) =>
      current.state.status === "error" ? false : 30_000,
    refetchIntervalInBackground: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });

  return {
    ...exceptions,
    permissionDenied:
      exceptions.error instanceof HttpError && exceptions.error.status === 403,
  };
}

export function useExceptionAssignees() {
  return useQuery({
    queryKey: [...QUERY_KEYS.exceptions, "assignees"],
    queryFn: ({ signal }) => listExceptionAssignees(signal),
    staleTime: 30000,
  });
}

export function useExceptionFollowUps(orderId: string, page: number) {
  return useQuery({
    queryKey: [...QUERY_KEYS.exceptions, orderId, "follow-ups", page],
    queryFn: ({ signal }) => listExceptionFollowUps(orderId, page, signal),
    staleTime: 10000,
  });
}

export function useRecordExceptionFollowUp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      orderId,
      values,
    }: {
      orderId: string;
      values: ExceptionFollowUpInput;
    }) => recordExceptionFollowUp(orderId, values),
    retry: false,
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.exceptions }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.audit }),
      ]),
  });
}

export function useProcessFulfillment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: processFulfillment,
    retry: false,
    // A failed response can follow partial processing; refresh without replaying it.
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.exceptions }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.orders }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.invoices }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dashboard }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.finance }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.catalog }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.audit }),
      ]),
  });
}
