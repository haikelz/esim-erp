"use client";

import { type AuditQuery, auditQuerySchema } from "@esim-erp/contracts";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { QUERY_KEYS } from "@/lib/query-keys";
import { listAuditEvents } from "@/services/audit";
import { useListQuery } from "./list-query";

const AUDIT_QUERY_FIELDS = [
  "page",
  "limit",
  "search",
  "action",
  "actorId",
  "from",
  "to",
] as const;

export function useAuditQuery() {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const list = useListQuery();
  const parsed = auditQuerySchema.safeParse(Object.fromEntries(params));
  const hasRepeatedFields = AUDIT_QUERY_FIELDS.some(
    (field) => params.getAll(field).length > 1,
  );
  const query = parsed.success && !hasRepeatedFields ? parsed.data : undefined;
  const validationError = hasRepeatedFields
    ? "Setiap filter hanya boleh diisi sekali. Reset filter lalu coba lagi."
    : parsed.success
      ? null
      : parsed.error.issues
          .map((issue) => {
            const field = issue.path[0];
            if (field === "from" || field === "to") return issue.message;
            if (field === "actorId")
              return "ID pelaku tidak valid. Gunakan ID staf dalam format UUID.";
            if (field === "action" || field === "search")
              return "Pencarian dan filter aksi masing-masing maksimal 100 karakter.";
            return "Halaman atau jumlah baris tidak valid. Reset filter lalu coba lagi.";
          })
          .join(" ");

  function setFilters(filters: AuditQuery) {
    const next = new URLSearchParams(params);
    next.set("page", "1");

    for (const field of [
      "search",
      "action",
      "actorId",
      "from",
      "to",
    ] as const) {
      const value = filters[field];
      if (value) next.set(field, value);
      else next.delete(field);
    }

    router.push(`${pathname}?${next}`, { scroll: false });
  }

  function resetFilters() {
    const next = new URLSearchParams(params);
    for (const field of AUDIT_QUERY_FIELDS) next.delete(field);

    router.push(`${pathname}?${next}`, { scroll: false });
  }

  return {
    list,
    params: params.toString(),
    query,
    resetFilters,
    setFilters,
    validationError,
  };
}

export function useAuditEvents(query: AuditQuery | undefined) {
  return useQuery({
    queryKey: [...QUERY_KEYS.audit, "list", query ?? null],
    queryFn: ({ signal }) => {
      if (!query) throw new Error("Filter audit belum valid.");

      return listAuditEvents(query, signal);
    },
    enabled: Boolean(query),
    placeholderData: keepPreviousData,
    staleTime: 10000,
  });
}
