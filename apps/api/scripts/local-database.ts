export function localDatabaseUrl(
  value: string | undefined,
  databaseName: string,
): string {
  const invalid = () =>
    new Error(
      "API tests require APP_ENV=local and TEST_DATABASE_URL for esim_erp_test on loopback port 55440.",
    );

  if (
    process.env.APP_ENV !== "local" ||
    databaseName !== "esim_erp_test" ||
    !value ||
    !URL.canParse(value)
  ) {
    throw invalid();
  }

  const url = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.port !== "55440" ||
    url.pathname !== `/${databaseName}`
  ) {
    throw invalid();
  }

  return value;
}
