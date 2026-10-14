import {
  EXCEPTION_CRITICAL_MINUTES,
  EXCEPTION_WARNING_MINUTES,
  type ExceptionKind,
  exceptionPageSchema,
  packageSnapshotSchema,
} from "@esim-erp/contracts";
import { and, asc, count, eq, isNull, lte, ne, or, sql } from "drizzle-orm";
import { DomainError } from "../modules/errors";
import type { SalesRepository } from "../modules/sales/usecase";
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
  invoices,
  orders,
  products,
  provisioningJobs,
  supplierAccount,
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
          sql<number>`count(*) FILTER (WHERE ${invoices.paymentStatus} <> 'paid')`.mapWith(
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
    create,
    dashboard,
    exceptions,
    find,
    installation,
    list,
    retryProvisioning,
  };
}
