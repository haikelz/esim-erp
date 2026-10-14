import type { FinancePeriod } from "@esim-erp/contracts";
import { and, gte, lt } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

export function reportPeriodFilter(column: AnyPgColumn, period: FinancePeriod) {
  if (!period.from || !period.to) return undefined;

  // Report dates are inclusive WIB days; keep the column bare for index scans.
  const start = new Date(`${period.from}T00:00:00+07:00`);
  const endExclusive = new Date(
    new Date(`${period.to}T00:00:00+07:00`).getTime() + 86400000,
  );

  return and(gte(column, start), lt(column, endExclusive));
}
