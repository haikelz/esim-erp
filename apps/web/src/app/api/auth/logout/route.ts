import { okSchema } from "@esim-erp/contracts";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/server/auth";
import {
  assertSameOrigin,
  backendJson,
  backendRequest,
  routeError,
} from "@/server/backend";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value;
    try {
      if (token)
        await backendJson(
          await backendRequest("/auth/logout", { method: "POST" }, token),
          okSchema,
        );
    } finally {
      cookieStore.delete(SESSION_COOKIE);
    }

    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeError(error);
  }
}
