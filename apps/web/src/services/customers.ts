import {
  type CustomerDetail,
  type CustomerPage,
  customerDetailSchema,
  customerPageSchema,
  type ListQuery,
} from "@esim-erp/contracts";
import { request } from "@/lib/http";

export function listCustomers(
  query: ListQuery,
  signal?: AbortSignal,
): Promise<CustomerPage> {
  const params = new URLSearchParams({
    page: String(query.page),
    limit: String(query.limit),
    search: query.search,
  });

  return request(`/api/backend/customers?${params}`, customerPageSchema, {
    signal,
  });
}

export function getCustomer(
  id: string,
  query: Pick<ListQuery, "page" | "limit">,
  signal?: AbortSignal,
): Promise<CustomerDetail> {
  const params = new URLSearchParams({
    page: String(query.page),
    limit: String(query.limit),
  });

  return request(
    `/api/backend/customers/${encodeURIComponent(id)}?${params}`,
    customerDetailSchema,
    { signal },
  );
}
