import { errorResponseSchema } from "@esim-erp/contracts";
import type { z } from "zod";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export async function request<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  options: RequestInit = {},
): Promise<z.output<Schema>> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...options.headers },
      signal: options.signal ?? AbortSignal.timeout(20000),
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new HttpError(
      503,
      "connection_failed",
      "Koneksi ke ERP gagal. Periksa koneksi lalu coba lagi.",
    );
  }

  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const parsed = errorResponseSchema.safeParse(payload);
    throw new HttpError(
      response.status,
      parsed.success ? parsed.data.error.code : "request_failed",
      parsed.success
        ? parsed.data.error.message
        : "Permintaan gagal. Coba lagi atau hubungi administrator.",
    );
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new HttpError(
      502,
      "invalid_response",
      "Respons server tidak sesuai. Muat ulang atau hubungi administrator.",
    );
  }

  return parsed.data;
}
