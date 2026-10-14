import { loginInputSchema, staffSchema } from "@esim-erp/contracts";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError } from "@/lib/http";
import { SESSION_COOKIE } from "@/server/auth";
import {
  assertSameOrigin,
  backendJson,
  backendRequest,
  readJsonBody,
  routeError,
  serverConfig,
} from "@/server/backend";

const sessionSchema = z.object({
  staff: staffSchema,
  token: z.string().min(32).max(128),
  expiresAt: z.iso.datetime(),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const parsed = loginInputSchema.safeParse(await readJsonBody(request));
    if (!parsed.success)
      throw new HttpError(
        400,
        "invalid_input",
        parsed.error.issues[0]?.message ?? "Input tidak valid.",
      );

    const session = await backendJson(
      await backendRequest("/auth/login", {
        method: "POST",
        body: JSON.stringify(parsed.data),
      }),
      sessionSchema,
    );
    (await cookies()).set(SESSION_COOKIE, session.token, {
      expires: new Date(session.expiresAt),
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: new URL(serverConfig().WEB_ORIGIN).protocol === "https:",
    });

    return NextResponse.json(session.staff, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return routeError(error);
  }
}
