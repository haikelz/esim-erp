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
  GET: /^(dashboard|products|orders(?:\/[0-9a-f-]{36})?|invoices(?:\/(?:[0-9a-f-]{36}|export))?|finance|staff|audit|exceptions)$/,
  POST: /^(products\/sync|orders|orders\/[0-9a-f-]{36}\/(installation|retry)|fulfillment\/process|invoices\/[0-9a-f-]{36}\/(payment-link|reconcile|simulate-payment|adjustments)|staff(?:\/[0-9a-f-]{36}\/access-link)?)$/,
  PATCH: /^(products|staff)\/[0-9a-f-]{36}$/,
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
      method === "PATCH" ||
      (method === "POST" &&
        (path === "orders" ||
          path === "staff" ||
          path.endsWith("/adjustments")));
    const body = hasBody
      ? JSON.stringify(await readJsonBody(request))
      : undefined;
    const response = await backendRequest(
      `/api/${path}${new URL(request.url).search}`,
      { body, method },
      token,
    );

    const disposition = response.headers.get("Content-Disposition");
    // fetch already decompresses the upstream body; do not forward Content-Encoding.
    return new Response(response.body, {
      status: response.status,
      headers: {
        "Cache-Control": "no-store",
        ...(disposition ? { "Content-Disposition": disposition } : {}),
        "Content-Type":
          response.headers.get("Content-Type") ?? "application/json",
        "X-Content-Type-Options": "nosniff",
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
