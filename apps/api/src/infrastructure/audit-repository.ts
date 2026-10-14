import { type AuditQuery, auditEventSchema } from "@esim-erp/contracts";
import { and, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { Database } from "./database";
import { reportPeriodFilter } from "./report-period";
import { auditEvents, users } from "./schema";

export async function listAuditEvents(database: Database, query: AuditQuery) {
  const pattern = `%${query.search.replace(/[\\%_]/g, "\\$&")}%`;
  const actionPattern = `%${query.action.replace(/[\\%_]/g, "\\$&")}%`;
  const filter = and(
    query.search
      ? or(
          ilike(auditEvents.action, pattern),
          ilike(sql`${auditEvents.resourceId}::text`, pattern),
          ilike(users.name, pattern),
          ilike(users.email, pattern),
        )
      : undefined,
    query.action ? ilike(auditEvents.action, actionPattern) : undefined,
    query.actorId ? eq(auditEvents.actorId, query.actorId) : undefined,
    reportPeriodFilter(auditEvents.createdAt, query),
  );
  const rows = await database
    .select({
      id: auditEvents.id,
      actor: {
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
      },
      action: auditEvents.action,
      resourceId: auditEvents.resourceId,
      details: auditEvents.details,
      createdAt: auditEvents.createdAt,
    })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorId))
    .where(filter)
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
    .limit(query.limit)
    .offset((query.page - 1) * query.limit);
  const [totals] = await database
    .select({ total: count() })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorId))
    .where(filter);

  return {
    events: rows.map((row) =>
      auditEventSchema.parse({
        ...row,
        createdAt: row.createdAt.toISOString(),
      }),
    ),
    total: totals?.total ?? 0,
  };
}
