import { packageSnapshotSchema } from "@esim-erp/contracts";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { DomainError } from "../modules/errors";
import type { SalesRepository } from "../modules/sales/usecase";
import type { Database } from "./database";
import { orderSearch, selectOrderRecords, toOrder } from "./order-records";
import {
  auditEvents,
  automationEvents,
  customers,
  esimProfiles,
  invoices,
  orders,
  products,
  provisioningJobs,
} from "./schema";

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
    const records = await selectOrderRecords(database)
      .where(orderSearch(query.search))
      .orderBy(desc(orders.createdAt), desc(orders.sequence))
      .limit(query.limit)
      .offset((query.page - 1) * query.limit);
    const [totals] = await database
      .select({ total: count() })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(orderSearch(query.search));

    return { orders: records.map(toOrder), total: totals?.total ?? 0 };
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
      if (invoice?.paymentStatus !== "paid") return false;

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
    const [metrics] = await database
      .select({
        totalOrders: count(),
        awaitingPayment:
          sql<number>`count(*) FILTER (WHERE ${invoices.paymentStatus} <> 'paid')`.mapWith(
            Number,
          ),
        fulfilled:
          sql<number>`count(*) FILTER (WHERE ${provisioningJobs.status} = 'ready')`.mapWith(
            Number,
          ),
        needsAttention:
          sql<number>`count(*) FILTER (WHERE ${provisioningJobs.status} IN ('failed', 'unknown') OR ${invoices.reconciliationRequired})`.mapWith(
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
    const recent = await selectOrderRecords(database)
      .orderBy(desc(orders.createdAt), desc(orders.sequence))
      .limit(5);

    return {
      totalOrders: metrics?.totalOrders ?? 0,
      awaitingPayment: metrics?.awaitingPayment ?? 0,
      fulfilled: metrics?.fulfilled ?? 0,
      needsAttention: metrics?.needsAttention ?? 0,
      pendingAutomationEvents: events?.pending ?? 0,
      recentOrders: recent.map(toOrder),
    };
  }

  return { create, dashboard, find, installation, list, retryProvisioning };
}
