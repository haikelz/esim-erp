import "server-only";
import { staffSchema } from "@esim-erp/contracts";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { HttpError } from "@/lib/http";
import { backendJson, backendRequest } from "./backend";

export const SESSION_COOKIE = "erp_staff_session";

export const requireStaff = cache(async function requireStaff() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/auth/login");

  try {
    return await backendJson(
      await backendRequest("/auth/me", {}, token),
      staffSchema,
    );
  } catch (error) {
    if (error instanceof HttpError && error.status === 401)
      redirect("/auth/login");
    throw error;
  }
});
