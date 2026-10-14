import {
  financeSummarySchema,
  paymentAttemptSchema,
} from "@esim-erp/contracts";
import { and, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type {
  BillingRepository,
  VerifiedPayment,
} from "../modules/billing/usecase";
import { DomainError } from "../modules/errors";
import { appendAutomationEvent } from "./automation-outbox";
import type { Database } from "./database";
import { orderSearch, selectOrderRecords, toInvoice } from "./order-records";
import {
  customers,
  invoices,
  orders,
  paymentAttempts,
  provisioningJobs,
  supplierDebits,
} from "./schema";

function toAttempt(attempt: typeof paymentAttempts.$inferSelect) {
  return paymentAttemptSchema.parse({
    ...attempt,
    createdAt: attempt.createdAt.toISOString(),
  });
}

export function createBillingRepository(database: Database): BillingRepository {
  async function list(query: Parameters<BillingRepository["list"]>[0]) {
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

    return { invoices: records.map(toInvoice), total: totals?.total ?? 0 };
  }

  async function find(id: string) {
    const [record] = await selectOrderRecords(database)
      .where(eq(invoices.id, id))
      .limit(1);
    if (!record) return undefined;

    const attempts = await database
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.invoiceId, id))
      .orderBy(desc(paymentAttempts.createdAt));

    return { invoice: toInvoice(record), attempts: attempts.map(toAttempt) };
  }

  async function summary() {
    const [totals] = await database
      .select({
        paidGrossIdr:
          sql<number>`coalesce(sum(${invoices.amountIdr}) FILTER (WHERE ${invoices.paymentStatus} = 'paid'), 0)`.mapWith(
            Number,
          ),
        outstandingIdr:
          sql<number>`coalesce(sum(${invoices.amountIdr}) FILTER (WHERE ${invoices.paymentStatus} <> 'paid'), 0)`.mapWith(
            Number,
          ),
        supplierSpendIdr:
          sql<number>`coalesce(sum(${supplierDebits.amountIdr}), 0)`.mapWith(
            Number,
          ),
        realizedMarginIdr:
          sql<number>`coalesce(sum(${invoices.amountIdr} - ${supplierDebits.amountIdr}) FILTER (WHERE ${invoices.paymentStatus} = 'paid' AND ${provisioningJobs.status} = 'ready'), 0)`.mapWith(
            Number,
          ),
        needsReconciliation:
          sql<number>`count(*) FILTER (WHERE ${invoices.reconciliationRequired})`.mapWith(
            Number,
          ),
      })
      .from(invoices)
      .leftJoin(supplierDebits, eq(supplierDebits.orderId, invoices.orderId))
      .leftJoin(
        provisioningJobs,
        eq(provisioningJobs.orderId, invoices.orderId),
      );

    return financeSummarySchema.parse(totals);
  }

  async function reserveAttempt(
    invoiceId: string,
    source: "midtrans" | "demo",
  ) {
    return database.transaction(async (transaction) => {
      const [record] = await transaction
        .select({ invoice: invoices, customer: customers })
        .from(invoices)
        .innerJoin(orders, eq(orders.id, invoices.orderId))
        .innerJoin(customers, eq(customers.id, orders.customerId))
        .where(eq(invoices.id, invoiceId))
        .for("update", { of: invoices })
        .limit(1);
      if (!record)
        throw new DomainError(
          "invoice_not_found",
          404,
          "Invoice tidak ditemukan.",
        );
      if (record.invoice.paymentStatus === "paid")
        throw new DomainError(
          "invoice_already_paid",
          409,
          "Invoice sudah lunas. Jangan membuat pembayaran baru.",
        );
      if (record.invoice.reconciliationRequired)
        throw new DomainError(
          "reconciliation_required",
          409,
          "Periksa transaksi yang belum pasti sebelum membuat pembayaran baru.",
        );

      const [active] = await transaction
        .select()
        .from(paymentAttempts)
        .where(
          and(
            eq(paymentAttempts.invoiceId, invoiceId),
            inArray(paymentAttempts.status, ["creating", "pending", "unknown"]),
          ),
        )
        .limit(1);
      if (active && active.source !== source) {
        throw new DomainError(
          "payment_source_conflict",
          409,
          "Invoice memiliki transaksi aktif dengan sumber pembayaran lain.",
        );
      }

      let attempt = active;
      if (!attempt) {
        const id = crypto.randomUUID();
        const [created] = await transaction
          .insert(paymentAttempts)
          .values({ id, invoiceId, gatewayOrderId: `erp-${id}`, source })
          .returning();
        attempt = created;
      }
      if (!attempt) throw new Error("Payment reservation returned no attempt");

      return {
        attempt: toAttempt(attempt),
        amountIdr: record.invoice.amountIdr,
        customerName: record.customer.name,
        customerEmail: record.customer.email,
        isNew: !active,
      };
    });
  }

  async function saveLink(attemptId: string, redirectUrl: string) {
    await database.transaction(async (transaction) => {
      const [attempt] = await transaction
        .select()
        .from(paymentAttempts)
        .where(eq(paymentAttempts.id, attemptId))
        .limit(1);
      if (!attempt) throw new Error("Reserved payment attempt is absent");

      // Invoice locks serialize every writer; a fast notification cannot be downgraded.
      await transaction
        .select({ id: invoices.id })
        .from(invoices)
        .where(eq(invoices.id, attempt.invoiceId))
        .for("update");
      await transaction
        .update(paymentAttempts)
        .set({ redirectUrl, status: "pending" })
        .where(
          and(
            eq(paymentAttempts.id, attemptId),
            eq(paymentAttempts.status, "creating"),
          ),
        );
      await transaction
        .update(invoices)
        .set({ paymentStatus: "pending" })
        .where(
          and(
            eq(invoices.id, attempt.invoiceId),
            ne(invoices.paymentStatus, "paid"),
            eq(invoices.reconciliationRequired, false),
          ),
        );
    });
  }

  async function failCreation(attemptId: string, isAmbiguous: boolean) {
    await database.transaction(async (transaction) => {
      const [attempt] = await transaction
        .select()
        .from(paymentAttempts)
        .where(eq(paymentAttempts.id, attemptId))
        .limit(1);
      if (!attempt) throw new Error("Reserved payment attempt is absent");

      await transaction
        .select({ id: invoices.id })
        .from(invoices)
        .where(eq(invoices.id, attempt.invoiceId))
        .for("update");
      const changed = await transaction
        .update(paymentAttempts)
        .set({ status: isAmbiguous ? "unknown" : "failed" })
        .where(
          and(
            eq(paymentAttempts.id, attemptId),
            eq(paymentAttempts.status, "creating"),
          ),
        )
        .returning({ id: paymentAttempts.id });
      if (changed.length === 0) return;

      await transaction
        .update(invoices)
        .set({
          paymentStatus: isAmbiguous ? "pending" : "failed",
          reconciliationRequired: isAmbiguous,
        })
        .where(
          and(
            eq(invoices.id, attempt.invoiceId),
            ne(invoices.paymentStatus, "paid"),
          ),
        );
    });
  }

  async function recordVerifiedPayment(
    payment: VerifiedPayment,
    source: "midtrans" | "demo",
  ) {
    await database.transaction(async (transaction) => {
      const [reference] = await transaction
        .select()
        .from(paymentAttempts)
        .where(eq(paymentAttempts.gatewayOrderId, payment.gatewayOrderId))
        .limit(1);
      if (!reference || reference.source !== source) {
        throw new DomainError(
          "payment_not_found",
          404,
          "Referensi pembayaran tidak terdaftar untuk sumber ini.",
        );
      }

      const [invoice] = await transaction
        .select()
        .from(invoices)
        .where(eq(invoices.id, reference.invoiceId))
        .for("update")
        .limit(1);
      if (!invoice) throw new Error("Payment invoice is absent");
      if (
        !/^[0-9]+(?:\.00)?$/.test(payment.grossAmount) ||
        Number(payment.grossAmount) !== invoice.amountIdr
      ) {
        throw new DomainError(
          "payment_amount_mismatch",
          409,
          "Nominal pembayaran tidak cocok dengan invoice.",
        );
      }

      const [attempt] = await transaction
        .select()
        .from(paymentAttempts)
        .where(eq(paymentAttempts.id, reference.id))
        .for("update")
        .limit(1);
      if (!attempt) throw new Error("Payment attempt is absent");
      if (
        attempt.transactionId &&
        attempt.transactionId !== payment.transactionId
      ) {
        throw new DomainError(
          "payment_transaction_mismatch",
          409,
          "Identitas transaksi pembayaran berubah. Periksa Midtrans.",
        );
      }
      if (payment.status === "review") {
        await transaction
          .update(invoices)
          .set({ reconciliationRequired: true })
          .where(eq(invoices.id, invoice.id));
        return;
      }
      if (
        attempt.status === "paid" ||
        (payment.status !== "paid" &&
          ["failed", "expired"].includes(attempt.status))
      )
        return;

      await transaction
        .update(paymentAttempts)
        .set({ status: payment.status, transactionId: payment.transactionId })
        .where(eq(paymentAttempts.id, attempt.id));
      if (invoice.paymentStatus === "paid") {
        if (payment.status === "paid" && invoice.paidAttemptId !== attempt.id) {
          await transaction
            .update(invoices)
            .set({ reconciliationRequired: true })
            .where(eq(invoices.id, invoice.id));
        }
        return;
      }

      const [otherActive] = await transaction
        .select({ id: paymentAttempts.id })
        .from(paymentAttempts)
        .where(
          and(
            eq(paymentAttempts.invoiceId, invoice.id),
            ne(paymentAttempts.id, attempt.id),
            inArray(paymentAttempts.status, ["creating", "pending", "unknown"]),
          ),
        )
        .limit(1);
      if (payment.status !== "paid" && otherActive) return;

      await transaction
        .update(invoices)
        .set({
          paymentStatus: payment.status,
          paidAttemptId: payment.status === "paid" ? attempt.id : null,
          paidAt: payment.status === "paid" ? new Date() : null,
          reconciliationRequired:
            payment.status === "paid" && Boolean(otherActive),
        })
        .where(eq(invoices.id, invoice.id));
      if (payment.status !== "paid") return;

      // Payment truth, fulfillment intent, and the outbox must commit as one unit.
      await transaction
        .insert(provisioningJobs)
        .values({ orderId: invoice.orderId })
        .onConflictDoNothing({ target: provisioningJobs.orderId });
      await appendAutomationEvent(
        transaction,
        "invoice.paid",
        invoice.orderId,
        `invoice.paid:${invoice.id}`,
      );
    });
  }

  return {
    failCreation,
    find,
    list,
    recordVerifiedPayment,
    reserveAttempt,
    saveLink,
    summary,
  };
}
