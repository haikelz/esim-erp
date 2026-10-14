"use client";

import { useQuery } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/lib/query-keys";
import { getDashboard } from "@/services/dashboard";

export function useDashboard() {
  return useQuery({
    queryKey: QUERY_KEYS.dashboard,
    queryFn: ({ signal }) => getDashboard(signal),
    staleTime: 10000,
    refetchInterval: (current) => {
      if (current.state.status === "error") return false;
      if (current.state.data?.pendingFulfillment) return 5000;
      if (current.state.data?.pendingPayments) return 10000;

      return 60000;
    },
    refetchIntervalInBackground: false,
  });
}
