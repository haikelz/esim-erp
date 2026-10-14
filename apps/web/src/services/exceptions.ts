import {
  type ExceptionAssigneePage,
  type ExceptionFollowUpInput,
  type ExceptionFollowUpPage,
  type ExceptionPage,
  type ExceptionQuery,
  exceptionAssigneePageSchema,
  exceptionFollowUpInputSchema,
  exceptionFollowUpPageSchema,
  exceptionPageSchema,
  okSchema,
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

export function listExceptionAssignees(
  signal?: AbortSignal,
): Promise<ExceptionAssigneePage> {
  return request(
    "/api/backend/exceptions/assignees",
    exceptionAssigneePageSchema,
    { signal },
  );
}

export function listExceptionFollowUps(
  orderId: string,
  page: number,
  signal?: AbortSignal,
): Promise<ExceptionFollowUpPage> {
  return request(
    `/api/backend/exceptions/${encodeURIComponent(orderId)}/follow-ups?page=${page}&limit=10`,
    exceptionFollowUpPageSchema,
    { signal },
  );
}

export function recordExceptionFollowUp(
  orderId: string,
  input: ExceptionFollowUpInput,
) {
  return request(
    `/api/backend/exceptions/${encodeURIComponent(orderId)}/follow-ups`,
    okSchema,
    {
      method: "POST",
      body: JSON.stringify(exceptionFollowUpInputSchema.parse(input)),
    },
  );
}

export function processFulfillment(): Promise<FulfillmentProcessResult> {
  return request(
    "/api/backend/fulfillment/process",
    fulfillmentProcessResultSchema,
    { method: "POST" },
  );
}
