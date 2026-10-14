import type {
  AuditEvent,
  AutomationEvent,
  PackageSnapshot,
} from "@esim-erp/contracts";
import { PAYMENT_STATUSES, STAFF_ROLES } from "@esim-erp/contracts";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Drizzle Kit discovers enums through the schema module's exports.
export const staffRole = pgEnum("staff_role", STAFF_ROLES);
export const paymentStatus = pgEnum("payment_status", PAYMENT_STATUSES);
export const attemptStatus = pgEnum("payment_attempt_status", [
  "creating",
  "pending",
  "paid",
  "failed",
  "expired",
  "unknown",
]);
export const jobStatus = pgEnum("provisioning_status", [
  "queued",
  "processing",
  "ready",
  "failed",
  "unknown",
]);
export const paymentSource = pgEnum("payment_source", ["midtrans", "demo"]);
export const adjustmentKind = pgEnum("invoice_adjustment_kind", [
  "gateway_fee",
  "refund",
]);
export const supplierScenario = pgEnum("supplier_scenario", [
  "success",
  "fail_once",
]);
export const eventKind = pgEnum("automation_event_kind", [
  "invoice.paid",
  "fulfillment.ready",
  "fulfillment.failed",
]);

export const users = pgTable("staff_users", {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull().unique(),
  name: text().notNull(),
  role: staffRole().notNull(),
  passwordHash: text("password_hash").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }).defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sessions = pgTable(
  "staff_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("session_expiry_idx").on(table.expiresAt)],
);

export const loginBuckets = pgTable("login_buckets", {
  key: text().primaryKey(),
  attempts: integer().notNull(),
  windowStartedAt: timestamp("window_started_at", {
    withTimezone: true,
  }).notNull(),
});

export const staffAccessTokens = pgTable(
  "staff_access_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    purpose: text().$type<"invite" | "reset">().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "staff_access_purpose_valid",
      sql`${table.purpose} IN ('invite', 'reset')`,
    ),
    index("staff_access_user_idx").on(table.userId),
    uniqueIndex("one_unused_access_link_per_staff")
      .on(table.userId)
      .where(sql`${table.usedAt} IS NULL`),
  ],
);

export const products = pgTable(
  "products",
  {
    id: uuid().primaryKey().defaultRandom(),
    providerSku: text("provider_sku").notNull().unique(),
    name: text().notNull(),
    countries: text().array().notNull(),
    dataMb: integer("data_mb").notNull(),
    validityDays: integer("validity_days").notNull(),
    activationRule: text("activation_rule")
      .notNull()
      .default("first_network_connection"),
    supplierCostIdr: integer("supplier_cost_idr").notNull(),
    sellingPriceIdr: integer("selling_price_idr").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("product_cost_positive", sql`${table.supplierCostIdr} >= 0`),
    check("product_price_positive", sql`${table.sellingPriceIdr} > 0`),
    check("product_quota_positive", sql`${table.dataMb} > 0`),
    check("product_validity_positive", sql`${table.validityDays} > 0`),
  ],
);

export const supplierAccount = pgTable(
  "supplier_account",
  {
    id: integer().primaryKey(),
    name: text().notNull(),
    balanceIdr: integer("balance_idr").notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
  },
  (table) => [
    check("single_supplier", sql`${table.id} = 1`),
    check("supplier_balance_nonnegative", sql`${table.balanceIdr} >= 0`),
  ],
);

export const customers = pgTable("order_contacts", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  email: text().notNull(),
  phone: text().notNull(),
});

export const orders = pgTable(
  "sales_orders",
  {
    id: uuid().primaryKey().defaultRandom(),
    sequence: serial().notNull().unique(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    packageSnapshot: jsonb("package_snapshot")
      .$type<PackageSnapshot>()
      .notNull(),
    supplierScenario: supplierScenario("supplier_scenario")
      .notNull()
      .default("success"),
    note: text().notNull().default(""),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("orders_created_at_idx").on(table.createdAt)],
);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid().primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .unique()
      .references(() => orders.id),
    amountIdr: integer("amount_idr").notNull(),
    paymentStatus: paymentStatus("payment_status").notNull().default("unpaid"),
    paidAttemptId: uuid("paid_attempt_id"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    reconciliationRequired: boolean("reconciliation_required")
      .notNull()
      .default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("invoice_amount_positive", sql`${table.amountIdr} > 0`),
    index("invoice_payment_status_idx").on(table.paymentStatus),
  ],
);

export const paymentAttempts = pgTable(
  "payment_attempts",
  {
    id: uuid().primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    gatewayOrderId: text("gateway_order_id").notNull().unique(),
    source: paymentSource().notNull(),
    status: attemptStatus().notNull().default("creating"),
    redirectUrl: text("redirect_url"),
    transactionId: text("transaction_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("one_active_payment_per_invoice")
      .on(table.invoiceId)
      .where(sql`${table.status} IN ('creating', 'pending', 'unknown')`),
    index("payment_invoice_idx").on(table.invoiceId),
  ],
);

export const invoiceAdjustments = pgTable(
  "invoice_adjustments",
  {
    id: uuid().primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    kind: adjustmentKind().notNull(),
    amountIdr: integer("amount_idr").notNull(),
    reference: text().notNull(),
    reason: text().notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("invoice_adjustment_positive", sql`${table.amountIdr} > 0`),
    uniqueIndex("invoice_adjustment_reference_unique").on(
      table.invoiceId,
      table.kind,
      table.reference,
    ),
  ],
);

export const provisioningJobs = pgTable(
  "provisioning_jobs",
  {
    id: uuid().primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .unique()
      .references(() => orders.id),
    status: jobStatus().notNull().default("queued"),
    attemptCount: integer("attempt_count").notNull().default(0),
    leaseToken: uuid("lease_token"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    error: text(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("provisioning_queue_idx").on(table.status, table.createdAt),
  ],
);

export const esimProfiles = pgTable("esim_profiles", {
  id: uuid().primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .unique()
    .references(() => orders.id),
  providerOrderId: text("provider_order_id").notNull().unique(),
  iccid: text().notNull().unique(),
  activationCodeEncrypted: text("activation_code_encrypted").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const supplierDebits = pgTable(
  "supplier_debits",
  {
    id: uuid().primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .unique()
      .references(() => orders.id),
    amountIdr: integer("amount_idr").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("supplier_debit_nonnegative", sql`${table.amountIdr} >= 0`),
  ],
);

export const automationEvents = pgTable(
  "automation_events",
  {
    id: uuid().primaryKey().defaultRandom(),
    eventKey: text("event_key").notNull().unique(),
    kind: eventKind().notNull(),
    payload: jsonb()
      .$type<Omit<AutomationEvent, "id" | "kind" | "createdAt">>()
      .notNull(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("automation_pending_idx")
      .on(table.createdAt)
      .where(sql`${table.acknowledgedAt} IS NULL`),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid().primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => users.id),
    action: text().notNull(),
    resourceId: uuid("resource_id"),
    details: jsonb().$type<AuditEvent["details"]>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("audit_created_id_idx").on(table.createdAt, table.id)],
);
