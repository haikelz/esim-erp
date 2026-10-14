import { okSchema, passwordSetupInputSchema } from "@esim-erp/contracts";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { HttpError } from "@/lib/http";
import { SESSION_COOKIE } from "@/server/auth";
import {
  assertSameOrigin,
  backendJson,
  backendRequest,
  readJsonBody,
  routeError,
} from "@/server/backend";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const parsed = passwordSetupInputSchema.safeParse(
      await readJsonBody(request),
    );
    if (!parsed.success)
      throw new HttpError(
        400,
        "invalid_input",
        parsed.error.issues[0]?.message ?? "Input tidak valid.",
      );

    const result = await backendJson(
      await backendRequest("/auth/set-password", {
        method: "POST",
        body: JSON.stringify(parsed.data),
      }),
      okSchema,
    );
    (await cookies()).delete(SESSION_COOKIE);

    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return routeError(error);
  }
}
