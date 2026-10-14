import { z } from "zod";

export function localDatabaseUrl(
  value: string | undefined,
  databaseName: "esim_erp" | "esim_erp_test",
) {
  const connection = z.url().parse(value);
  const parsed = new URL(connection);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.port !== "55440" ||
    parsed.pathname !== `/${databaseName}` ||
    process.env.APP_ENV !== "local"
  ) {
    throw new Error(
      `This command only supports the disposable local ${databaseName} database on port 55440. Shared databases require a separately approved migration workflow.`,
    );
  }

  return connection;
}
