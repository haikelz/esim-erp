import type { AutomationEvent } from "@esim-erp/contracts";
import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  lte,
  notExists,
  sql,
} from "drizzle-orm";
import type { Database, Transaction } from "./database";
import { automationEvents, invoices, orders } from "./schema";

export const REMINDER_DELAY_MS = 24 * 60 * 60 * 1000;

export async function appendAutomationEvent(
  transaction: Transaction,
  kind: AutomationEvent["kind"],
  orderId: string,
  eventKey: string,
) {
  const [record] = await transaction
    .select({ sequence: orders.sequence, amountIdr: invoices.amountIdr })
    .from(orders)
    .innerJoin(invoices, eq(invoices.orderId, orders.id))
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!record) throw new Error("Cannot create an event for an absent order");

  const sequence = String(record.sequence).padStart(6, "0");
  await transaction
    .insert(automationEvents)
    .values({
      eventKey,
      kind,
      payload: {
        orderId,
        orderNumber: `SO-${sequence}`,
        invoiceNumber: `INV-${sequence}`,
        amountIdr: record.amountIdr,
      },
    })
    .onConflictDoNothing({ target: automationEvents.eventKey });
}

export function acknowledgeReminder(
  transaction: Transaction,
  invoiceId: string,
) {
  return transaction
    .update(automationEvents)
    .set({ acknowledgedAt: new Date() })
    .where(
      and(
        eq(automationEvents.eventKey, `invoice.reminder_due:${invoiceId}`),
        isNull(automationEvents.acknowledgedAt),
      ),
    );
}

export function enqueueDueUnpaidReminders(database: Database) {
  return database.transaction(async (transaction) => {
    const due = await transaction
      .select({ id: invoices.id, orderId: invoices.orderId })
      .from(invoices)
      .where(
        and(
          inArray(invoices.paymentStatus, [
            "unpaid",
            "pending",
            "failed",
            "expired",
          ]),
          eq(invoices.reconciliationRequired, false),
          lte(invoices.createdAt, new Date(Date.now() - REMINDER_DELAY_MS)),
          notExists(
            transaction
              .select({ one: sql`1` })
              .from(automationEvents)
              .where(
                eq(
                  automationEvents.eventKey,
                  sql`'invoice.reminder_due:' || ${invoices.id}::text`,
                ),
              ),
          ),
        ),
      )
      .orderBy(asc(invoices.createdAt), asc(invoices.id))
      .for("update", { of: invoices, skipLocked: true })
      .limit(25);

    for (const invoice of due)
      await appendAutomationEvent(
        transaction,
        "invoice.reminder_due",
        invoice.orderId,
        `invoice.reminder_due:${invoice.id}`,
      );

    return due.length;
  });
}
