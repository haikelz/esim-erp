import { invoiceSchema, orderSchema } from "@esim-erp/contracts";
import { eq, ilike, or, sql } from "drizzle-orm";
import type { Database, Transaction } from "./database";
import {
  customers,
  invoices,
  orders,
  provisioningJobs,
  supplierDebits,
} from "./schema";

type OrderRecord = {
  order: typeof orders.$inferSelect;
  customer: typeof customers.$inferSelect;
  invoice: typeof invoices.$inferSelect;
  job: typeof provisioningJobs.$inferSelect | null;
  debit: typeof supplierDebits.$inferSelect | null;
};

export function selectOrderRecords(database: Database | Transaction) {
  return database
    .select({
      order: orders,
      customer: customers,
      invoice: invoices,
      job: provisioningJobs,
      debit: supplierDebits,
    })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .innerJoin(invoices, eq(invoices.orderId, orders.id))
    .leftJoin(provisioningJobs, eq(provisioningJobs.orderId, orders.id))
    .leftJoin(supplierDebits, eq(supplierDebits.orderId, orders.id))
    .$dynamic();
}

export function orderSearch(search: string) {
  if (!search) return undefined;

  const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
  return or(
    ilike(customers.name, pattern),
    ilike(customers.email, pattern),
    ilike(sql`${orders.packageSnapshot}->>'name'`, pattern),
    ilike(sql`'SO-' || lpad(${orders.sequence}::text, 6, '0')`, pattern),
    ilike(sql`'INV-' || lpad(${orders.sequence}::text, 6, '0')`, pattern),
  );
}

export function toOrder(record: OrderRecord) {
  const sequence = String(record.order.sequence).padStart(6, "0");

  return orderSchema.parse({
    id: record.order.id,
    number: `SO-${sequence}`,
    invoiceId: record.invoice.id,
    invoiceNumber: `INV-${sequence}`,
    customerName: record.customer.name,
    customerEmail: record.customer.email,
    customerPhone: record.customer.phone,
    package: record.order.packageSnapshot,
    paymentStatus: record.invoice.paymentStatus,
    fulfillmentStatus: record.job?.status ?? "waiting_payment",
    reconciliationRequired: record.invoice.reconciliationRequired,
    fulfillmentError: record.job?.error ?? null,
    note: record.order.note,
    createdAt: record.order.createdAt.toISOString(),
  });
}

export function toInvoice(record: OrderRecord) {
  const sequence = String(record.order.sequence).padStart(6, "0");
  const isFulfilled =
    record.invoice.paymentStatus === "paid" &&
    record.job?.status === "ready" &&
    record.debit !== null;

  return invoiceSchema.parse({
    id: record.invoice.id,
    number: `INV-${sequence}`,
    orderId: record.order.id,
    orderNumber: `SO-${sequence}`,
    customerName: record.customer.name,
    packageName: record.order.packageSnapshot.name,
    amountIdr: record.invoice.amountIdr,
    supplierCostIdr:
      record.debit?.amountIdr ?? record.order.packageSnapshot.supplierCostIdr,
    marginIdr: isFulfilled
      ? record.invoice.amountIdr - (record.debit?.amountIdr ?? 0)
      : null,
    paymentStatus: record.invoice.paymentStatus,
    fulfillmentStatus: record.job?.status ?? "waiting_payment",
    reconciliationRequired: record.invoice.reconciliationRequired,
    paidAt: record.invoice.paidAt?.toISOString() ?? null,
    createdAt: record.invoice.createdAt.toISOString(),
  });
}
