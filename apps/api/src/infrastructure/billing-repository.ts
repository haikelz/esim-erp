import {
  type FinancePeriod,
  financeSummarySchema,
  invoiceAdjustmentSchema,
  paymentAttemptSchema,
} from "@esim-erp/contracts";
import { and, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import {
  type BillingRepository,
  INVOICE_EXPORT_LIMIT,
  type VerifiedPayment,
} from "../modules/billing/usecase";
import { DomainError } from "../modules/errors";
import { appendAutomationEvent } from "./automation-outbox";
import type { Database } from "./database";
import {
  type OrderRecord,
  orderSearch,
  selectOrderPage,
  selectOrderRecords,
  toInvoice,
} from "./order-records";
import { reportPeriodFilter } from "./report-period";
import {
  auditEvents,
  customers,
  invoiceAdjustments,
  invoices,
  orders,
  paymentAttempts,
  provisioningJobs,
  supplierDebits,
  users,
} from "./schema";

function toAttempt(attempt: typeof paymentAttempts.$inferSelect) {
  return paymentAttemptSchema.parse({
    ...attempt,
    createdAt: attempt.createdAt.toISOString(),
  });
}

export function createBillingRepository(database: Database): BillingRepository {
  async function invoicesWithAdjustments(records: OrderRecord[]) {
    if (records.length === 0) return [];

    const amounts = await database
      .select({
        invoiceId: invoiceAdjustments.invoiceId,
        gatewayFeeIdr:
          sql<number>`coalesce(sum(${invoiceAdjustments.amountIdr}) FILTER (WHERE ${invoiceAdjustments.kind} = 'gateway_fee'), 0)`.mapWith(
            Number,
          ),
        refundIdr:
          sql<number>`coalesce(sum(${invoiceAdjustments.amountIdr}) FILTER (WHERE ${invoiceAdjustments.kind} = 'refund'), 0)`.mapWith(
            Number,
          ),
      })
      .from(invoiceAdjustments)
      .where(
        inArray(
          invoiceAdjustments.invoiceId,
          records.map((record) => record.invoice.id),
        ),
      )
      .groupBy(invoiceAdjustments.invoiceId);
    const byInvoice = new Map(
      amounts.map((amount) => [amount.invoiceId, amount]),
    );

    return records.map((record) =>
      toInvoice(
        record,
        byInvoice.get(record.invoice.id) ?? { gatewayFeeIdr: 0, refundIdr: 0 },
      ),
    );
  }

  async function list(query: Parameters<BillingRepository["list"]>[0]) {
    const filter = and(
      orderSearch(query.search),
      reportPeriodFilter(invoices.createdAt, query),
    );
    const records = await selectOrderPage(database, query, filter);
    const [totals] = await database
      .select({ total: count() })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .innerJoin(invoices, eq(invoices.orderId, orders.id))
      .where(filter);

    return {
      invoices: await invoicesWithAdjustments(records),
      total: totals?.total ?? 0,
    };
  }

  async function exportInvoices(
    query: Parameters<BillingRepository["exportInvoices"]>[0],
  ) {
    const records = await selectOrderPage(
      database,
      { page: 1, limit: INVOICE_EXPORT_LIMIT + 1 },
      and(
        orderSearch(query.search),
        reportPeriodFilter(invoices.createdAt, query),
      ),
    );
    if (records.length > INVOICE_EXPORT_LIMIT)
      throw new DomainError(
        "export_too_large",
        400,
        "Hasil melebihi 10.000 invoice. Persempit periode atau pencarian sebelum mengekspor.",
      );

    return invoicesWithAdjustments(records);
  }

  async function recordAdjustment(
    invoiceId: string,
    actorId: string,
    input: Parameters<BillingRepository["recordAdjustment"]>[2],
  ) {
    await database.transaction(async (transaction) => {
      const [invoice] = await transaction
        .select()
        .from(invoices)
        .where(eq(invoices.id, invoiceId))
        .for("update")
        .limit(1);
      if (!invoice)
        throw new DomainError(
          "invoice_not_found",
          404,
          "Invoice tidak ditemukan.",
        );
      if (invoice.paymentStatus !== "paid")
        throw new DomainError(
          "adjustment_requires_payment",
          409,
          "Biaya atau refund hanya dapat dicatat pada invoice yang sudah lunas.",
        );

      const [duplicate] = await transaction
        .select({ id: invoiceAdjustments.id })
        .from(invoiceAdjustments)
        .where(
          and(
            eq(invoiceAdjustments.invoiceId, invoiceId),
            eq(invoiceAdjustments.kind, input.kind),
            eq(invoiceAdjustments.reference, input.reference),
          ),
        )
        .limit(1);
      if (duplicate)
        throw new DomainError(
          "adjustment_reference_exists",
          409,
          "Referensi ini sudah dicatat untuk invoice dan jenis penyesuaian yang sama.",
        );
      if (input.kind === "refund") {
        const [refunds] = await transaction
          .select({
            total:
              sql<number>`coalesce(sum(${invoiceAdjustments.amountIdr}), 0)`.mapWith(
                Number,
              ),
          })
          .from(invoiceAdjustments)
          .where(
            and(
              eq(invoiceAdjustments.invoiceId, invoiceId),
              eq(invoiceAdjustments.kind, "refund"),
            ),
          );
        if ((refunds?.total ?? 0) + input.amountIdr > invoice.amountIdr)
          throw new DomainError(
            "refund_exceeds_payment",
            409,
            "Total refund tidak boleh melebihi nominal invoice yang dibayar.",
          );
      }

      await transaction
        .insert(invoiceAdjustments)
        .values({ ...input, invoiceId, createdBy: actorId });
      await transaction.insert(auditEvents).values({
        actorId,
        action: "invoice.adjustment_recorded",
        resourceId: invoiceId,
        details: {
          kind: input.kind,
          amountIdr: input.amountIdr,
          reference: input.reference,
        },
      });
    });
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
    const rows = await database
      .select({
        id: invoiceAdjustments.id,
        kind: invoiceAdjustments.kind,
        amountIdr: invoiceAdjustments.amountIdr,
        reference: invoiceAdjustments.reference,
        reason: invoiceAdjustments.reason,
        actorName: users.name,
        createdAt: invoiceAdjustments.createdAt,
      })
      .from(invoiceAdjustments)
      .innerJoin(users, eq(users.id, invoiceAdjustments.createdBy))
      .where(eq(invoiceAdjustments.invoiceId, id))
      .orderBy(desc(invoiceAdjustments.createdAt), desc(invoiceAdjustments.id));
    const adjustments = rows.map((row) =>
      invoiceAdjustmentSchema.parse({
        ...row,
        createdAt: row.createdAt.toISOString(),
      }),
    );
    const amounts = adjustments.reduce(
      (total, adjustment) => ({
        gatewayFeeIdr:
          total.gatewayFeeIdr +
          (adjustment.kind === "gateway_fee" ? adjustment.amountIdr : 0),
        refundIdr:
          total.refundIdr +
          (adjustment.kind === "refund" ? adjustment.amountIdr : 0),
      }),
      { gatewayFeeIdr: 0, refundIdr: 0 },
    );

    return {
      invoice: toInvoice(record, amounts),
      attempts: attempts.map(toAttempt),
      adjustments,
    };
  }

  async function summary(period: FinancePeriod = {}) {
    const adjustments = database
      .select({
        invoiceId: invoiceAdjustments.invoiceId,
        gatewayFeeIdr:
          sql<number>`coalesce(sum(${invoiceAdjustments.amountIdr}) FILTER (WHERE ${invoiceAdjustments.kind} = 'gateway_fee'), 0)`
            .mapWith(Number)
            .as("gateway_fee_idr"),
        refundIdr:
          sql<number>`coalesce(sum(${invoiceAdjustments.amountIdr}) FILTER (WHERE ${invoiceAdjustments.kind} = 'refund'), 0)`
            .mapWith(Number)
            .as("refund_idr"),
        feeEntries:
          sql<number>`count(*) FILTER (WHERE ${invoiceAdjustments.kind} = 'gateway_fee')`
            .mapWith(Number)
            .as("fee_entries"),
      })
      .from(invoiceAdjustments)
      .groupBy(invoiceAdjustments.invoiceId)
      .as("adjustment_totals");
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
        gatewayFeesIdr:
          sql<number>`coalesce(sum(${adjustments.gatewayFeeIdr}), 0)`.mapWith(
            Number,
          ),
        refundsIdr:
          sql<number>`coalesce(sum(${adjustments.refundIdr}), 0)`.mapWith(
            Number,
          ),
        netRecordedMarginIdr:
          sql<number>`coalesce(sum(${invoices.amountIdr} - ${supplierDebits.amountIdr} - coalesce(${adjustments.gatewayFeeIdr}, 0) - coalesce(${adjustments.refundIdr}, 0)) FILTER (WHERE ${invoices.paymentStatus} = 'paid' AND ${provisioningJobs.status} = 'ready'), 0)`.mapWith(
            Number,
          ),
        feesUnrecordedInvoices:
          sql<number>`count(*) FILTER (WHERE ${invoices.paymentStatus} = 'paid' AND coalesce(${adjustments.feeEntries}, 0) = 0)`.mapWith(
            Number,
          ),
        needsReconciliation:
          sql<number>`count(*) FILTER (WHERE ${invoices.reconciliationRequired})`.mapWith(
            Number,
          ),
      })
      .from(invoices)
      .leftJoin(adjustments, eq(adjustments.invoiceId, invoices.id))
      .leftJoin(supplierDebits, eq(supplierDebits.orderId, invoices.orderId))
      .leftJoin(
        provisioningJobs,
        eq(provisioningJobs.orderId, invoices.orderId),
      )
      .where(reportPeriodFilter(invoices.createdAt, period));

    return financeSummarySchema.parse({ ...totals, period });
  }

  async function reserveAttempt(
    invoiceId: string,
    source: "midtrans" | "demo",
    actorId?: string,
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
      if (!active)
        await transaction.insert(auditEvents).values({
          actorId,
          action: "payment.requested",
          resourceId: invoiceId,
          details: { source },
        });

      return {
        attempt: toAttempt(attempt),
        amountIdr: record.invoice.amountIdr,
        customerName: record.customer.name,
        customerEmail: record.customer.email,
        isNew: !active,
      };
    });
  }

  async function saveLink(
    attemptId: string,
    redirectUrl: string,
    actorId?: string,
  ) {
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
      await transaction.insert(auditEvents).values({
        actorId,
        action: "payment.link_created",
        resourceId: attempt.invoiceId,
        details: { source: attempt.source },
      });
    });
  }

  async function failCreation(
    attemptId: string,
    isAmbiguous: boolean,
    actorId?: string,
  ) {
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
      await transaction.insert(auditEvents).values({
        actorId,
        action: isAmbiguous
          ? "payment.creation_uncertain"
          : "payment.creation_failed",
        resourceId: attempt.invoiceId,
        details: { source: attempt.source },
      });
    });
  }

  async function recordVerifiedPayment(
    payment: VerifiedPayment,
    source: "midtrans" | "demo",
    actorId?: string,
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
      if (actorId)
        await transaction.insert(auditEvents).values({
          actorId,
          action:
            source === "demo" ? "payment.simulated" : "payment.reconciled",
          resourceId: invoice.id,
          details: { source, status: payment.status },
        });
      if (payment.status === "review") {
        if (invoice.reconciliationRequired) return;

        await transaction
          .update(invoices)
          .set({ reconciliationRequired: true })
          .where(eq(invoices.id, invoice.id));
        await transaction.insert(auditEvents).values({
          actorId,
          action: "payment.review_required",
          resourceId: invoice.id,
          details: { source },
        });
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
      if (attempt.status !== payment.status)
        await transaction.insert(auditEvents).values({
          actorId,
          action: "payment.status_changed",
          resourceId: invoice.id,
          details: {
            source,
            previousStatus: attempt.status,
            status: payment.status,
          },
        });
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
    exportInvoices,
    failCreation,
    find,
    list,
    recordAdjustment,
    recordVerifiedPayment,
    reserveAttempt,
    saveLink,
    summary,
  };
}
