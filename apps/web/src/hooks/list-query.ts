"use client";

import { listQuerySchema } from "@esim-erp/contracts";
import type { OnChangeFn, PaginationState } from "@tanstack/react-table";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function useListQuery() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const parsed = listQuerySchema.safeParse(Object.fromEntries(searchParams));
  const query = parsed.success ? parsed.data : listQuerySchema.parse({});
  const pagination: PaginationState = {
    pageIndex: query.page - 1,
    pageSize: query.limit,
  };

  function setSearch(search: string) {
    const params = new URLSearchParams(searchParams);
    params.set("page", "1");
    if (search) params.set("search", search);
    else params.delete("search");
    router.push(`${pathname}?${params}`, { scroll: false });
  }

  const onPaginationChange: OnChangeFn<PaginationState> = (updater) => {
    const next = typeof updater === "function" ? updater(pagination) : updater;
    const params = new URLSearchParams(searchParams);
    params.set("page", String(next.pageIndex + 1));
    params.set("limit", String(next.pageSize));
    router.push(`${pathname}?${params}`, { scroll: false });
  };

  return { onPaginationChange, pagination, query, setSearch };
}
