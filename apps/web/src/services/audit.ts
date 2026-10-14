import {
  type AuditPage,
  type AuditQuery,
  auditPageSchema,
  auditQuerySchema,
} from "@esim-erp/contracts";
import { request } from "@/lib/http";

export function listAuditEvents(
  query: AuditQuery,
  signal?: AbortSignal,
): Promise<AuditPage> {
  const filters = auditQuerySchema.parse(query);
  const params = new URLSearchParams({
    page: String(filters.page),
    limit: String(filters.limit),
    search: filters.search,
    action: filters.action,
  });

  if (filters.actorId) params.set("actorId", filters.actorId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);

  return request(`/api/backend/audit?${params}`, auditPageSchema, { signal });
}
