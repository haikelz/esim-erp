import { z } from "zod";
import { DomainError } from "./modules/errors";

export type Bindings = {
  APP_ENV: string;
  WEB_ORIGIN: string;
  ERP_PROXY_SECRET: string;
  ESIM_ENCRYPTION_KEY: string;
  AUTOMATION_TOKEN: string;
  ALLOW_DEMO_PAYMENTS: string;
  MIDTRANS_SERVER_KEY?: string;
  DATABASE_URL?: string;
  HYPERDRIVE?: { connectionString: string };
  RUNTIME?: "bun";
  API_RATE_LIMITER?: {
    limit: (input: { key: string }) => Promise<{ success: boolean }>;
  };
};

const configSchema = z.object({
  APP_ENV: z.enum(["local", "staging", "production"]),
  WEB_ORIGIN: z.url(),
  ERP_PROXY_SECRET: z.string().min(32),
  ESIM_ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/),
  AUTOMATION_TOKEN: z.string().min(32),
  ALLOW_DEMO_PAYMENTS: z.enum(["true", "false"]),
  MIDTRANS_SERVER_KEY: z.string().min(16).optional(),
  RUNTIME: z.literal("bun").optional(),
});

export type Config = z.infer<typeof configSchema> & {
  connectionString: string;
  demoPaymentsEnabled: boolean;
};

export function readConfig(bindings: Bindings): Config {
  const parsed = configSchema.safeParse(bindings);
  if (!parsed.success) {
    throw new DomainError(
      "configuration_missing",
      503,
      "Konfigurasi server belum lengkap. Jalankan setup lokal atau hubungi administrator.",
    );
  }

  const connectionString =
    bindings.HYPERDRIVE?.connectionString ??
    (parsed.data.APP_ENV === "local" || parsed.data.RUNTIME === "bun"
      ? bindings.DATABASE_URL
      : undefined);
  if (!connectionString) {
    throw new DomainError(
      "database_not_configured",
      503,
      "Koneksi database belum dikonfigurasi.",
    );
  }
  if (
    parsed.data.APP_ENV !== "local" &&
    parsed.data.ALLOW_DEMO_PAYMENTS === "true"
  ) {
    throw new DomainError(
      "unsafe_demo_configuration",
      503,
      "Simulasi pembayaran harus dinonaktifkan di luar lingkungan lokal.",
    );
  }

  return {
    ...parsed.data,
    connectionString,
    demoPaymentsEnabled:
      parsed.data.APP_ENV === "local" &&
      parsed.data.ALLOW_DEMO_PAYMENTS === "true",
  };
}
