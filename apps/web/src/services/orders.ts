import {
  type Installation,
  installationSchema,
  type ListQuery,
  type Order,
  type OrderInput,
  type OrderPage,
  okSchema,
  orderPageSchema,
  orderSchema,
} from "@esim-erp/contracts";
import { request } from "@/lib/http";

export function listOrders(
  query: ListQuery,
  signal?: AbortSignal,
): Promise<OrderPage> {
  const params = new URLSearchParams({
    page: String(query.page),
    limit: String(query.limit),
    search: query.search,
  });
  return request(`/api/backend/orders?${params}`, orderPageSchema, { signal });
}

export function getOrder(id: string, signal?: AbortSignal): Promise<Order> {
  return request(`/api/backend/orders/${encodeURIComponent(id)}`, orderSchema, {
    signal,
  });
}

export function createOrder(input: OrderInput): Promise<Order> {
  return request("/api/backend/orders", orderSchema, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function cancelOrder(id: string): Promise<Order> {
  return request(
    `/api/backend/orders/${encodeURIComponent(id)}/cancel`,
    orderSchema,
    { method: "POST" },
  );
}

export function revealInstallation(id: string): Promise<Installation> {
  return request(
    `/api/backend/orders/${encodeURIComponent(id)}/installation`,
    installationSchema,
    { method: "POST" },
  );
}

export function retryProvisioning(id: string) {
  return request(
    `/api/backend/orders/${encodeURIComponent(id)}/retry`,
    okSchema,
    { method: "POST" },
  );
}
