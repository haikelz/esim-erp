import {
  type ExceptionPage,
  type ExceptionQuery,
  exceptionPageSchema,
} from "@esim-erp/contracts";
import { z } from "zod";
import { request } from "@/lib/http";

const fulfillmentProcessResultSchema = z.object({
  processed: z.number().int().nonnegative().max(10),
});

export type FulfillmentProcessResult = z.infer<
  typeof fulfillmentProcessResultSchema
>;

export function listExceptions(
  query: ExceptionQuery,
  signal?: AbortSignal,
): Promise<ExceptionPage> {
  const params = new URLSearchParams({
    page: String(query.page),
    limit: String(query.limit),
    search: query.search,
  });
  if (query.kind) params.set("kind", query.kind);

  return request(`/api/backend/exceptions?${params}`, exceptionPageSchema, {
    signal,
  });
}

export function processFulfillment(): Promise<FulfillmentProcessResult> {
  return request(
    "/api/backend/fulfillment/process",
    fulfillmentProcessResultSchema,
    { method: "POST" },
  );
}
