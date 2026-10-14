import {
  automationEventSchema,
  packageSnapshotSchema,
} from "@esim-erp/contracts";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { DomainError } from "../modules/errors";
import type {
  FulfillmentRepository,
  ProvisioningJob,
} from "../modules/fulfillment/usecase";
import { appendAutomationEvent } from "./automation-outbox";
import type { Database, Transaction } from "./database";
import {
  auditEvents,
  automationEvents,
  esimProfiles,
  invoices,
  orders,
  provisioningJobs,
  supplierAccount,
  supplierDebits,
} from "./schema";

export async function reservedSupplierSpend(database: Database | Transaction) {
  const [reserved] = await database
    .select({
      amountIdr:
        sql<number>`coalesce(sum((${orders.packageSnapshot}->>'supplierCostIdr')::integer), 0)`.mapWith(
          Number,
        ),
    })
    .from(provisioningJobs)
    .innerJoin(orders, eq(orders.id, provisioningJobs.orderId))
    .where(inArray(provisioningJobs.status, ["processing", "unknown"]));

  return reserved?.amountIdr ?? 0;
}

export function createFulfillmentRepository(
  database: Database,
): FulfillmentRepository {
  async function claim() {
    return database.transaction(async (transaction) => {
      const expired = await transaction
        .select()
        .from(provisioningJobs)
        .where(
          and(
            eq(provisioningJobs.status, "processing"),
            lt(provisioningJobs.lockedAt, new Date(Date.now() - 120000)),
          ),
        )
        .orderBy(provisioningJobs.lockedAt)
        .for("update", { skipLocked: true })
        .limit(10);

      // A timeout cannot establish whether the supplier already charged the order.
      for (const job of expired) {
        await transaction
          .update(provisioningJobs)
          .set({
            status: "unknown",
            error:
              "Batas waktu pemrosesan terlewati. Rekonsiliasi supplier sebelum mencoba ulang.",
            leaseToken: null,
            lockedAt: null,
          })
          .where(eq(provisioningJobs.id, job.id));
        await appendAutomationEvent(
          transaction,
          "fulfillment.failed",
          job.orderId,
          `fulfillment.failed:${job.id}:${job.attemptCount}`,
        );
        await transaction
          .insert(auditEvents)
          .values({ action: "fulfillment.uncertain", resourceId: job.orderId });
      }

      // Serialize budget checks with other claims and completed supplier debits.
      // Uncertain purchases retain their reservation until supplier reconciliation.
      const [wallet] = await transaction
        .select({ balanceIdr: supplierAccount.balanceIdr })
        .from(supplierAccount)
        .where(eq(supplierAccount.id, 1))
        .for("update")
        .limit(1);
      if (!wallet) return undefined;

      const availableIdr = Math.max(
        0,
        wallet.balanceIdr - (await reservedSupplierSpend(transaction)),
      );
      const [record] = await transaction
        .select({ job: provisioningJobs, order: orders })
        .from(provisioningJobs)
        .innerJoin(orders, eq(orders.id, provisioningJobs.orderId))
        .innerJoin(invoices, eq(invoices.orderId, orders.id))
        .where(
          and(
            eq(invoices.paymentStatus, "paid"),
            eq(invoices.reconciliationRequired, false),
            eq(provisioningJobs.status, "queued"),
            sql`(${orders.packageSnapshot}->>'supplierCostIdr')::integer <= ${availableIdr}`,
          ),
        )
        .orderBy(provisioningJobs.createdAt)
        .for("update", { of: provisioningJobs, skipLocked: true })
        .limit(1);
      if (!record) return undefined;

      const leaseToken = crypto.randomUUID();
      await transaction
        .update(provisioningJobs)
        .set({
          status: "processing",
          attemptCount: record.job.attemptCount + 1,
          leaseToken,
          lockedAt: new Date(),
          error: null,
        })
        .where(eq(provisioningJobs.id, record.job.id));
      const snapshot = packageSnapshotSchema.parse(
        record.order.packageSnapshot,
      );

      return {
        id: record.job.id,
        leaseToken,
        orderId: record.order.id,
        providerSku: snapshot.providerSku,
        supplierCostIdr: snapshot.supplierCostIdr,
        scenario: record.order.supplierScenario,
        attempt: record.job.attemptCount + 1,
      };
    });
  }

  async function complete(
    job: ProvisioningJob,
    profile: Parameters<FulfillmentRepository["complete"]>[1],
  ) {
    await database.transaction(async (transaction) => {
      const [claimed] = await transaction
        .select()
        .from(provisioningJobs)
        .where(
          and(
            eq(provisioningJobs.id, job.id),
            eq(provisioningJobs.leaseToken, job.leaseToken),
            eq(provisioningJobs.status, "processing"),
          ),
        )
        .for("update")
        .limit(1);
      if (!claimed) return;

      const [wallet] = await transaction
        .select()
        .from(supplierAccount)
        .where(eq(supplierAccount.id, 1))
        .for("update")
        .limit(1);
      if (!wallet || wallet.balanceIdr < job.supplierCostIdr) {
        throw new DomainError(
          "insufficient_supplier_balance",
          409,
          "Saldo supplier tidak cukup. Tambahkan saldo sebelum mencoba ulang.",
        );
      }

      await transaction.insert(esimProfiles).values({
        orderId: job.orderId,
        providerOrderId: profile.providerOrderId,
        iccid: profile.iccid,
        activationCodeEncrypted: profile.ciphertext,
      });
      await transaction
        .insert(supplierDebits)
        .values({ orderId: job.orderId, amountIdr: job.supplierCostIdr });
      await transaction
        .update(supplierAccount)
        .set({
          balanceIdr: sql`${supplierAccount.balanceIdr} - ${job.supplierCostIdr}`,
        })
        .where(eq(supplierAccount.id, 1));
      await transaction
        .update(provisioningJobs)
        .set({ status: "ready", error: null, lockedAt: null, leaseToken: null })
        .where(eq(provisioningJobs.id, job.id));
      await appendAutomationEvent(
        transaction,
        "fulfillment.ready",
        job.orderId,
        `fulfillment.ready:${job.orderId}`,
      );
      await transaction
        .insert(auditEvents)
        .values({ action: "fulfillment.ready", resourceId: job.orderId });
    });
  }

  async function fail(
    job: ProvisioningJob,
    reason: string,
    isAmbiguous: boolean,
  ) {
    await database.transaction(async (transaction) => {
      const changed = await transaction
        .update(provisioningJobs)
        .set({
          status: isAmbiguous ? "unknown" : "failed",
          error: reason,
          lockedAt: null,
          leaseToken: null,
        })
        .where(
          and(
            eq(provisioningJobs.id, job.id),
            eq(provisioningJobs.leaseToken, job.leaseToken),
            eq(provisioningJobs.status, "processing"),
          ),
        )
        .returning({ id: provisioningJobs.id });
      if (changed.length === 0) return;

      await appendAutomationEvent(
        transaction,
        "fulfillment.failed",
        job.orderId,
        `fulfillment.failed:${job.id}:${job.attempt}`,
      );
      await transaction.insert(auditEvents).values({
        action: isAmbiguous ? "fulfillment.uncertain" : "fulfillment.failed",
        resourceId: job.orderId,
      });
    });
  }

  async function events() {
    const pending = await database
      .select()
      .from(automationEvents)
      .where(isNull(automationEvents.acknowledgedAt))
      .orderBy(automationEvents.createdAt)
      .limit(25);

    return pending.map((event) =>
      automationEventSchema.parse({
        ...event.payload,
        id: event.id,
        kind: event.kind,
        createdAt: event.createdAt.toISOString(),
      }),
    );
  }

  async function acknowledge(eventId: string) {
    const acknowledged = await database
      .update(automationEvents)
      .set({ acknowledgedAt: new Date() })
      .where(eq(automationEvents.id, eventId))
      .returning({ id: automationEvents.id });

    return acknowledged.length === 1;
  }

  return { acknowledge, claim, complete, events, fail };
}
