import {
  automationEventSchema,
  packageSnapshotSchema,
} from "@esim-erp/contracts";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { DomainError } from "../modules/errors";
import type {
  FulfillmentRepository,
  ProvisioningJob,
} from "../modules/fulfillment/usecase";
import { appendAutomationEvent } from "./automation-outbox";
import type { Database } from "./database";
import {
  automationEvents,
  esimProfiles,
  invoices,
  orders,
  provisioningJobs,
  supplierAccount,
  supplierDebits,
} from "./schema";

export function createFulfillmentRepository(
  database: Database,
): FulfillmentRepository {
  async function claim() {
    return database.transaction(async (transaction) => {
      const [record] = await transaction
        .select({ job: provisioningJobs, order: orders })
        .from(provisioningJobs)
        .innerJoin(orders, eq(orders.id, provisioningJobs.orderId))
        .innerJoin(invoices, eq(invoices.orderId, orders.id))
        .where(
          and(
            eq(invoices.paymentStatus, "paid"),
            eq(invoices.reconciliationRequired, false),
            or(
              eq(provisioningJobs.status, "queued"),
              and(
                eq(provisioningJobs.status, "processing"),
                lt(provisioningJobs.lockedAt, new Date(Date.now() - 120000)),
              ),
            ),
          ),
        )
        .orderBy(provisioningJobs.createdAt)
        .for("update", { of: provisioningJobs, skipLocked: true })
        .limit(1);
      if (!record) return undefined;

      // Lease recovery is safe only because the selected adapter is a pure mock.
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
