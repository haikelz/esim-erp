import type { AutomationEvent } from "@esim-erp/contracts";
import { eq } from "drizzle-orm";
import type { Transaction } from "./database";
import { automationEvents, invoices, orders } from "./schema";

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
