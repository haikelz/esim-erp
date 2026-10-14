import { type Dashboard, dashboardSchema } from "@esim-erp/contracts";
import { request } from "@/lib/http";

export function getDashboard(signal?: AbortSignal): Promise<Dashboard> {
  return request("/api/backend/dashboard", dashboardSchema, { signal });
}
