import {
  type ListQuery,
  okSchema,
  type ProductPage,
  type ProductUpdate,
  productPageSchema,
} from "@esim-erp/contracts";
import { request } from "@/lib/http";

export function listProducts(
  query: ListQuery,
  signal?: AbortSignal,
): Promise<ProductPage> {
  const params = new URLSearchParams({
    page: String(query.page),
    limit: String(query.limit),
    search: query.search,
  });
  return request(`/api/backend/products?${params}`, productPageSchema, {
    signal,
  });
}

export function syncProducts() {
  return request("/api/backend/products/sync", okSchema, { method: "POST" });
}

export function updateProduct(input: { id: string; values: ProductUpdate }) {
  return request(
    `/api/backend/products/${encodeURIComponent(input.id)}`,
    okSchema,
    { method: "PATCH", body: JSON.stringify(input.values) },
  );
}
