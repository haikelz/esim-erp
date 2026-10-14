"use client";

import { useQuery } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/lib/query-keys";
import { getDashboard } from "@/services/dashboard";

export function useDashboard() {
  return useQuery({
    queryKey: QUERY_KEYS.dashboard,
    queryFn: ({ signal }) => getDashboard(signal),
    refetchInterval: 15000,
  });
}
