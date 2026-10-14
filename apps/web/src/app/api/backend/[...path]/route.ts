import { cookies } from "next/headers";
import { HttpError } from "@/lib/http";
import { SESSION_COOKIE } from "@/server/auth";
import {
  assertSameOrigin,
  backendRequest,
  readJsonBody,
  routeError,
} from "@/server/backend";

const ALLOWED_PATHS = {
  GET: /^(dashboard|products|orders(?:\/[0-9a-f-]{36})?|invoices(?:\/[0-9a-f-]{36})?|finance)$/,
  POST: /^(products\/sync|orders|orders\/[0-9a-f-]{36}\/(installation|retry)|fulfillment\/process|invoices\/[0-9a-f-]{36}\/(payment-link|reconcile|simulate-payment))$/,
  PATCH: /^products\/[0-9a-f-]{36}$/,
};

async function forward(
  request: Request,
  context: RouteContext<"/api/backend/[...path]">,
) {
  try {
    const method = request.method;
    const path = (await context.params).path.join("/");
    if (
      (method !== "GET" && method !== "POST" && method !== "PATCH") ||
      !ALLOWED_PATHS[method].test(path)
    ) {
      throw new HttpError(404, "not_found", "Endpoint tidak ditemukan.");
    }
    if (method !== "GET") assertSameOrigin(request);

    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!token)
      throw new HttpError(
        401,
        "unauthenticated",
        "Silakan masuk ke akun staf.",
      );

    const hasBody =
      method === "PATCH" || (method === "POST" && path === "orders");
    const body = hasBody
      ? JSON.stringify(await readJsonBody(request))
      : undefined;
    const response = await backendRequest(
      `/api/${path}${new URL(request.url).search}`,
      { body, method },
      token,
    );

    // fetch already decompresses the upstream body; do not forward Content-Encoding.
    return new Response(response.body, {
      status: response.status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type":
          response.headers.get("Content-Type") ?? "application/json",
        "X-Request-Id":
          response.headers.get("X-Request-Id") ?? crypto.randomUUID(),
      },
    });
  } catch (error) {
    return routeError(error);
  }
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
