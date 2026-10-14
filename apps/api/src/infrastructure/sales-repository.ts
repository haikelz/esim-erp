import {
  EXCEPTION_CRITICAL_MINUTES,
  EXCEPTION_WARNING_MINUTES,
  type ExceptionKind,
  exceptionAssigneePageSchema,
  exceptionFollowUpPageSchema,
  exceptionPageSchema,
  packageSnapshotSchema,
} from "@esim-erp/contracts";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { DomainError } from "../modules/errors";
import type { SalesRepository } from "../modules/sales/usecase";
import { acknowledgeReminder } from "./automation-outbox";
import type { Database } from "./database";
import { reservedSupplierSpend } from "./fulfillment-repository";
import {
  orderSearch,
  selectOrderPage,
  selectOrderRecords,
  toOrder,
} from "./order-records";
import {
  auditEvents,
  automationEvents,
  customers,
  esimProfiles,
  exceptionFollowUps,
  invoices,
  orders,
  paymentAttempts,
  products,
  provisioningJobs,
  supplierAccount,
  users,
} from "./schema";

const EXCEPTION_SINCE = sql<Date>`coalesce(${invoices.paidAt}, ${invoices.createdAt})`;

function exceptionPredicates(asOf: Date) {
  return {
    reconciliation: eq(invoices.reconciliationRequired, true),
    fulfillment_failed: eq(provisioningJobs.status, "failed"),
    supplier_unknown: eq(provisioningJobs.status, "unknown"),
    paid_unissued: and(
      eq(invoices.paymentStatus, "paid"),
      or(isNull(provisioningJobs.status), ne(provisioningJobs.status, "ready")),
      lte(
        EXCEPTION_SINCE,
        new Date(asOf.getTime() - EXCEPTION_WARNING_MINUTES * 60000),
      ),
    ),
  };
}

export function createSalesRepository(database: Database): SalesRepository {
  async function find(id: string) {
    const [record] = await selectOrderRecords(database)
      .where(eq(orders.id, id))
      .limit(1);

    return record ? toOrder(record) : undefined;
  }

  async function create(
    input: Parameters<SalesRepository["create"]>[0],
    actorId: string,
  ) {
    const orderId = crypto.randomUUID();
    const customerId = crypto.randomUUID();

    await database.transaction(async (transaction) => {
      const [product] = await transaction
        .select()
        .from(products)
        .where(eq(products.id, input.productId))
        .for("share")
        .limit(1);
      if (!product?.isActive) {
        throw new DomainError(
          "product_unavailable",
          409,
          "Paket sudah tidak aktif atau tidak tersedia. Pilih paket lain.",
        );
      }

      const packageSnapshot = packageSnapshotSchema.parse(product);
      await transaction.insert(customers).values({
        id: customerId,
        name: input.customerName,
        email: input.customerEmail,
        phone: input.customerPhone,
      });
      await transaction.insert(orders).values({
        id: orderId,
        customerId,
        createdBy: actorId,
        productId: product.id,
        packageSnapshot,
        note: input.note,
        supplierScenario: input.supplierScenario,
      });
      await transaction
        .insert(invoices)
        .values({ orderId, amountIdr: packageSnapshot.sellingPriceIdr });
      await transaction
        .insert(auditEvents)
        .values({ actorId, action: "order.created", resourceId: orderId });
    });

    const order = await find(orderId);
    if (!order) throw new Error("Created order is absent");

    return order;
  }

  async function cancel(id: string, actorId: string) {
    await database.transaction(async (transaction) => {
      const [invoice] = await transaction
        .select()
        .from(invoices)
        .where(eq(invoices.orderId, id))
        .for("update")
        .limit(1);
      if (!invoice)
        throw new DomainError(
          "order_not_found",
          404,
          "Pesanan tidak ditemukan.",
        );
      if (invoice.paymentStatus !== "unpaid" || invoice.reconciliationRequired)
        throw new DomainError(
          "cancellation_not_allowed",
          409,
          "Order hanya dapat dibatalkan sebelum upaya pembayaran dibuat. Periksa invoice.",
        );

      // A failed or expired attempt can still settle late, so every attempt blocks cancellation.
      const [attempt] = await transaction
        .select({ id: paymentAttempts.id })
        .from(paymentAttempts)
        .where(eq(paymentAttempts.invoiceId, invoice.id))
        .limit(1);
      if (attempt)
        throw new DomainError(
          "cancellation_not_allowed",
          409,
          "Order hanya dapat dibatalkan sebelum upaya pembayaran dibuat. Periksa invoice.",
        );

      await transaction
        .update(invoices)
        .set({ paymentStatus: "cancelled", cancelledAt: new Date() })
        .where(eq(invoices.id, invoice.id));
      await acknowledgeReminder(transaction, invoice.id);
      await transaction.insert(auditEvents).values({
        actorId,
        action: "order.cancelled",
        resourceId: id,
      });
    });

    const order = await find(id);
    if (!order) throw new Error("Cancelled order is absent");

    return order;
  }

  async function list(query: Parameters<SalesRepository["list"]>[0]) {
    const filter = orderSearch(query.search);
    const records = await selectOrderPage(database, query, filter);
    const [totals] = await database
      .select({ total: count() })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .innerJoin(invoices, eq(invoices.orderId, orders.id))
      .where(filter);

    return { orders: records.map(toOrder), total: totals?.total ?? 0 };
  }

  async function exceptions(
    query: Parameters<SalesRepository["exceptions"]>[0],
  ) {
    const asOf = new Date();
    const predicates = exceptionPredicates(asOf);
    const filter = and(
      orderSearch(query.search),
      query.kind ? predicates[query.kind] : or(...Object.values(predicates)),
    );
    const records = await selectOrderRecords(database)
      .where(filter)
      .orderBy(asc(EXCEPTION_SINCE), asc(orders.sequence))
      .limit(query.limit)
      .offset((query.page - 1) * query.limit);
    const latestFollowUps = new Map<
      string,
      {
        outcome: typeof exceptionFollowUps.$inferSelect.outcome;
        assignee: { id: string; name: string } | null;
        createdAt: string;
      }
    >();
    if (records.length > 0) {
      const ranked = database
        .select({
          orderId: exceptionFollowUps.orderId,
          assigneeId: exceptionFollowUps.assigneeId,
          outcome: exceptionFollowUps.outcome,
          createdAt: exceptionFollowUps.createdAt,
          position:
            sql<number>`row_number() over (partition by ${exceptionFollowUps.orderId} order by ${exceptionFollowUps.createdAt} desc, ${exceptionFollowUps.id} desc)`.as(
              "position",
            ),
        })
        .from(exceptionFollowUps)
        .where(
          inArray(
            exceptionFollowUps.orderId,
            records.map((record) => record.order.id),
          ),
        )
        .as("ranked_follow_ups");
      const followUps = await database
        .select({
          orderId: ranked.orderId,
          outcome: ranked.outcome,
          createdAt: ranked.createdAt,
          assigneeId: users.id,
          assigneeName: users.name,
        })
        .from(ranked)
        .leftJoin(users, eq(users.id, ranked.assigneeId))
        .where(eq(ranked.position, 1));

      for (const followUp of followUps)
        latestFollowUps.set(followUp.orderId, {
          outcome: followUp.outcome,
          assignee: followUp.assigneeId
            ? { id: followUp.assigneeId, name: followUp.assigneeName ?? "" }
            : null,
          createdAt: followUp.createdAt.toISOString(),
        });
    }
    const [totals] = await database
      .select({
        total: count(),
        overdueCount:
          sql<number>`count(*) FILTER (WHERE ${EXCEPTION_SINCE} <= ${new Date(asOf.getTime() - EXCEPTION_CRITICAL_MINUTES * 60000)})`.mapWith(
            Number,
          ),
      })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .innerJoin(invoices, eq(invoices.orderId, orders.id))
      .leftJoin(provisioningJobs, eq(provisioningJobs.orderId, orders.id))
      .where(filter);
    const [wallet] = await database
      .select()
      .from(supplierAccount)
      .where(eq(supplierAccount.id, 1))
      .limit(1);
    const reservedIdr = await reservedSupplierSpend(database);
    const availableIdr = wallet
      ? Math.max(0, wallet.balanceIdr - reservedIdr)
      : null;
    const [blocked] = await database
      .select({ total: count() })
      .from(provisioningJobs)
      .innerJoin(orders, eq(orders.id, provisioningJobs.orderId))
      .innerJoin(invoices, eq(invoices.orderId, orders.id))
      .where(
        and(
          eq(provisioningJobs.status, "queued"),
          eq(invoices.paymentStatus, "paid"),
          eq(invoices.reconciliationRequired, false),
          availableIdr === null
            ? undefined
            : sql`(${orders.packageSnapshot}->>'supplierCostIdr')::integer > ${availableIdr}`,
        ),
      );

    return exceptionPageSchema.parse({
      exceptions: records.map((record) => {
        const since = record.invoice.paidAt ?? record.invoice.createdAt;
        const ageMinutes = Math.max(
          0,
          Math.floor((asOf.getTime() - since.getTime()) / 60000),
        );
        const kinds: ExceptionKind[] = [];
        if (record.invoice.reconciliationRequired) kinds.push("reconciliation");
        if (record.job?.status === "failed") kinds.push("fulfillment_failed");
        if (record.job?.status === "unknown") kinds.push("supplier_unknown");
        if (
          record.invoice.paymentStatus === "paid" &&
          record.job?.status !== "ready" &&
          ageMinutes >= EXCEPTION_WARNING_MINUTES
        )
          kinds.push("paid_unissued");

        return {
          order: toOrder(record),
          kinds,
          followUp: latestFollowUps.get(record.order.id) ?? null,
          since: since.toISOString(),
          ageMinutes,
          severity:
            kinds.includes("supplier_unknown") ||
            kinds.includes("reconciliation") ||
            ageMinutes >= EXCEPTION_CRITICAL_MINUTES
              ? "critical"
              : "warning",
        };
      }),
      total: totals?.total ?? 0,
      overdueCount: totals?.overdueCount ?? 0,
      supplierBalanceIdr: wallet?.balanceIdr ?? null,
      supplierReservedIdr: reservedIdr,
      supplierAvailableIdr: availableIdr,
      blockedByBalanceCount: blocked?.total ?? 0,
      asOf: asOf.toISOString(),
    });
  }

  async function exceptionAssignees() {
    const assignees = await database
      .select({ id: users.id, name: users.name, role: users.role })
      .from(users)
      .where(and(eq(users.isActive, true), isNotNull(users.onboardedAt)))
      .orderBy(users.name);

    return exceptionAssigneePageSchema.parse({ assignees });
  }

  async function exceptionFollowUpHistory(
    id: string,
    query: Parameters<SalesRepository["exceptionFollowUps"]>[1],
  ) {
    const [existing] = await database
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.id, id))
      .limit(1);
    if (!existing)
      throw new DomainError("order_not_found", 404, "Pesanan tidak ditemukan.");

    const actor = alias(users, "follow_up_actor");
    const assignee = alias(users, "follow_up_assignee");
    const rows = await database
      .select({
        id: exceptionFollowUps.id,
        actorName: actor.name,
        assignee: { id: assignee.id, name: assignee.name },
        outcome: exceptionFollowUps.outcome,
        note: exceptionFollowUps.note,
        createdAt: exceptionFollowUps.createdAt,
      })
      .from(exceptionFollowUps)
      .innerJoin(actor, eq(actor.id, exceptionFollowUps.actorId))
      .leftJoin(assignee, eq(assignee.id, exceptionFollowUps.assigneeId))
      .where(eq(exceptionFollowUps.orderId, id))
      .orderBy(desc(exceptionFollowUps.createdAt), desc(exceptionFollowUps.id))
      .limit(query.limit)
      .offset((query.page - 1) * query.limit);
    const [totals] = await database
      .select({ total: count() })
      .from(exceptionFollowUps)
      .where(eq(exceptionFollowUps.orderId, id));

    return exceptionFollowUpPageSchema.parse({
      followUps: rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
      total: totals?.total ?? 0,
    });
  }

  async function recordExceptionFollowUp(
    id: string,
    actorId: string,
    input: Parameters<SalesRepository["recordExceptionFollowUp"]>[2],
  ) {
    await database.transaction(async (transaction) => {
      const [invoice] = await transaction
        .select({ id: invoices.id })
        .from(invoices)
        .where(eq(invoices.orderId, id))
        .for("update")
        .limit(1);
      if (!invoice)
        throw new DomainError(
          "order_not_found",
          404,
          "Pesanan tidak ditemukan.",
        );

      // A provisioning update must finish before the open-exception check.
      await transaction
        .select({ id: provisioningJobs.id })
        .from(provisioningJobs)
        .where(eq(provisioningJobs.orderId, id))
        .for("share")
        .limit(1);
      const [open] = await transaction
        .select({ id: invoices.id })
        .from(invoices)
        .leftJoin(
          provisioningJobs,
          eq(provisioningJobs.orderId, invoices.orderId),
        )
        .where(
          and(
            eq(invoices.id, invoice.id),
            or(...Object.values(exceptionPredicates(new Date()))),
          ),
        )
        .limit(1);
      if (!open)
        throw new DomainError(
          "exception_closed",
          409,
          "Pengecualian sudah tidak aktif. Muat ulang status order sebelum mencatat tindak lanjut.",
        );

      if (input.assigneeId) {
        const [assignee] = await transaction
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.id, input.assigneeId),
              eq(users.isActive, true),
              isNotNull(users.onboardedAt),
            ),
          )
          .for("share")
          .limit(1);
        if (!assignee)
          throw new DomainError(
            "assignee_unavailable",
            409,
            "Penanggung jawab tidak aktif. Pilih staf lain.",
          );
      }

      await transaction.insert(exceptionFollowUps).values({
        orderId: id,
        actorId,
        ...input,
      });
      await transaction.insert(auditEvents).values({
        actorId,
        action: "exception.follow_up_recorded",
        resourceId: id,
        details: { outcome: input.outcome, assigneeId: input.assigneeId },
      });
    });
  }

  async function installation(id: string, actorId: string) {
    return database.transaction(async (transaction) => {
      const [profile] = await transaction
        .select({
          sequence: orders.sequence,
          iccid: esimProfiles.iccid,
          ciphertext: esimProfiles.activationCodeEncrypted,
        })
        .from(esimProfiles)
        .innerJoin(orders, eq(orders.id, esimProfiles.orderId))
        .innerJoin(provisioningJobs, eq(provisioningJobs.orderId, orders.id))
        .where(and(eq(orders.id, id), eq(provisioningJobs.status, "ready")))
        .limit(1);
      if (!profile) return undefined;

      await transaction
        .insert(auditEvents)
        .values({ actorId, action: "installation.revealed", resourceId: id });

      return {
        orderNumber: `SO-${String(profile.sequence).padStart(6, "0")}`,
        iccid: profile.iccid,
        ciphertext: profile.ciphertext,
      };
    });
  }

  async function retryProvisioning(id: string, actorId: string) {
    return database.transaction(async (transaction) => {
      const [invoice] = await transaction
        .select()
        .from(invoices)
        .where(eq(invoices.orderId, id))
        .for("update")
        .limit(1);
      if (invoice?.paymentStatus !== "paid" || invoice.reconciliationRequired)
        return false;

      const updated = await transaction
        .update(provisioningJobs)
        .set({
          status: "queued",
          error: null,
          lockedAt: null,
          leaseToken: null,
        })
        .where(
          and(
            eq(provisioningJobs.orderId, id),
            eq(provisioningJobs.status, "failed"),
          ),
        )
        .returning({ id: provisioningJobs.id });
      if (updated.length === 0) return false;

      await transaction
        .insert(auditEvents)
        .values({ actorId, action: "fulfillment.retried", resourceId: id });

      return true;
    });
  }

  async function dashboard() {
    const needsAttention = or(
      ...Object.values(exceptionPredicates(new Date())),
    );
    const [metrics] = await database
      .select({
        totalOrders: count(),
        awaitingPayment:
          sql<number>`count(*) FILTER (WHERE ${invoices.paymentStatus} NOT IN ('paid', 'cancelled'))`.mapWith(
            Number,
          ),
        pendingPayments:
          sql<number>`count(*) FILTER (WHERE ${invoices.paymentStatus} = 'pending')`.mapWith(
            Number,
          ),
        pendingFulfillment:
          sql<number>`count(*) FILTER (WHERE ${invoices.paymentStatus} = 'paid' AND NOT ${invoices.reconciliationRequired} AND ${provisioningJobs.status} IN ('queued', 'processing'))`.mapWith(
            Number,
          ),
        fulfilled:
          sql<number>`count(*) FILTER (WHERE ${provisioningJobs.status} = 'ready')`.mapWith(
            Number,
          ),
        needsAttention:
          sql<number>`count(*) FILTER (WHERE ${needsAttention})`.mapWith(
            Number,
          ),
      })
      .from(orders)
      .innerJoin(invoices, eq(invoices.orderId, orders.id))
      .leftJoin(provisioningJobs, eq(provisioningJobs.orderId, orders.id));
    const [events] = await database
      .select({ pending: count() })
      .from(automationEvents)
      .where(isNull(automationEvents.acknowledgedAt));
    const recent = await selectOrderPage(
      database,
      { page: 1, limit: 5 },
      undefined,
    );

    return {
      totalOrders: metrics?.totalOrders ?? 0,
      awaitingPayment: metrics?.awaitingPayment ?? 0,
      pendingPayments: metrics?.pendingPayments ?? 0,
      pendingFulfillment: metrics?.pendingFulfillment ?? 0,
      fulfilled: metrics?.fulfilled ?? 0,
      needsAttention: metrics?.needsAttention ?? 0,
      pendingAutomationEvents: events?.pending ?? 0,
      recentOrders: recent.map(toOrder),
    };
  }

  return {
    cancel,
    create,
    dashboard,
    exceptions,
    exceptionAssignees,
    exceptionFollowUps: exceptionFollowUpHistory,
    find,
    installation,
    list,
    recordExceptionFollowUp,
    retryProvisioning,
  };
}
