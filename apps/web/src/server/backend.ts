import "server-only";
import { errorResponseSchema } from "@esim-erp/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError } from "@/lib/http";

const serverConfigSchema = z.object({
  API_ORIGIN: z.url(),
  ERP_PROXY_SECRET: z.string().min(32),
  WEB_ORIGIN: z.url(),
});

export function serverConfig() {
  const parsed = serverConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new HttpError(
      503,
      "configuration_missing",
      "Konfigurasi ERP belum lengkap. Hubungi administrator.",
    );
  }

  return parsed.data;
}

export function assertSameOrigin(request: Request) {
  if (
    request.headers.get("origin") !== new URL(serverConfig().WEB_ORIGIN).origin
  ) {
    throw new HttpError(
      403,
      "invalid_origin",
      "Permintaan harus berasal dari aplikasi ERP ini.",
    );
  }
}

export async function readJsonBody(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    throw new HttpError(
      415,
      "invalid_content_type",
      "Gunakan permintaan JSON.",
    );
  }

  const reader = request.body?.getReader();
  if (!reader)
    throw new HttpError(400, "body_required", "Isi permintaan diperlukan.");

  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;

    size += chunk.value.byteLength;
    if (size > 65536) {
      await reader.cancel();
      throw new HttpError(
        413,
        "body_too_large",
        "Ukuran permintaan melebihi batas 64 KB.",
      );
    }
    chunks.push(chunk.value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, "invalid_json", "Permintaan JSON tidak valid.");
  }
}

export async function backendRequest(
  path: string,
  options: RequestInit = {},
  token?: string,
) {
  const config = serverConfig();
  try {
    return await fetch(new URL(path, config.API_ORIGIN), {
      ...options,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-ERP-Proxy": config.ERP_PROXY_SECRET,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new HttpError(
      503,
      "backend_unavailable",
      "API ERP belum dapat dihubungi. Coba lagi atau hubungi administrator.",
    );
  }
}

export async function backendJson<Schema extends z.ZodType>(
  response: Response,
  schema: Schema,
): Promise<z.output<Schema>> {
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const parsed = errorResponseSchema.safeParse(payload);
    throw new HttpError(
      response.status,
      parsed.success ? parsed.data.error.code : "backend_error",
      parsed.success
        ? parsed.data.error.message
        : "API ERP tidak dapat memproses permintaan.",
    );
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success)
    throw new HttpError(
      502,
      "invalid_backend_response",
      "Respons API ERP tidak sesuai kontrak.",
    );

  return parsed.data;
}

export function routeError(error: unknown) {
  const requestId = crypto.randomUUID();
  if (!(error instanceof HttpError)) {
    console.error(
      JSON.stringify({
        event: "web.request_failed",
        requestId,
        errorType: error instanceof Error ? error.name : "unknown",
      }),
    );
  }

  return NextResponse.json(
    {
      error: {
        code: error instanceof HttpError ? error.code : "server_error",
        message:
          error instanceof HttpError
            ? error.message
            : "Permintaan belum dapat diproses. Coba lagi atau hubungi administrator.",
        requestId,
      },
    },
    {
      status: error instanceof HttpError ? error.status : 500,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
