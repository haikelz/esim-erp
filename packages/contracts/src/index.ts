import { z } from "zod";

export const STAFF_ROLES = ["admin", "sales", "operations", "finance"] as const;
export const PAYMENT_STATUSES = [
  "unpaid",
  "pending",
  "paid",
  "expired",
  "failed",
  "cancelled",
] as const;
export const FULFILLMENT_STATUSES = [
  "waiting_payment",
  "queued",
  "processing",
  "ready",
  "failed",
  "unknown",
  "cancelled",
] as const;
export const EXCEPTION_KINDS = [
  "reconciliation",
  "fulfillment_failed",
  "supplier_unknown",
  "paid_unissued",
] as const;
export const FOLLOW_UP_OUTCOMES = [
  "investigating",
  "waiting_gateway",
  "waiting_supplier",
  "review_complete",
] as const;
export const EXCEPTION_WARNING_MINUTES = 15;
export const EXCEPTION_CRITICAL_MINUTES = 60;

export const staffSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.email(),
  role: z.enum(STAFF_ROLES),
});

export type Staff = z.infer<typeof staffSchema>;
export type StaffRole = Staff["role"];

export const loginInputSchema = z.strictObject({
  email: z.email("Masukkan email yang valid.").trim().toLowerCase(),
  password: z.string().min(1, "Masukkan kata sandi.").max(128),
});

export type LoginInput = z.infer<typeof loginInputSchema>;

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  search: z.string().trim().max(100).default(""),
});

export type ListQuery = z.infer<typeof listQuerySchema>;

const PERIOD_FIELDS = {
  from: z.iso.date("Gunakan tanggal yang valid.").optional(),
  to: z.iso.date("Gunakan tanggal yang valid.").optional(),
};

function validPeriod(period: { from?: string; to?: string }) {
  return (
    (!period.from && !period.to) ||
    Boolean(period.from && period.to && period.from <= period.to)
  );
}

const PERIOD_ERROR = {
  message:
    "Pilih tanggal awal dan akhir; tanggal akhir tidak boleh lebih awal.",
  path: ["to"],
};

export const financePeriodSchema = z
  .object(PERIOD_FIELDS)
  .refine(validPeriod, PERIOD_ERROR);

export type FinancePeriod = z.infer<typeof financePeriodSchema>;

export const invoiceQuerySchema = listQuerySchema
  .extend(PERIOD_FIELDS)
  .refine(validPeriod, PERIOD_ERROR);

export type InvoiceQuery = z.infer<typeof invoiceQuerySchema>;

export const staffMemberSchema = staffSchema.extend({
  isActive: z.boolean(),
  onboardedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export type StaffMember = z.infer<typeof staffMemberSchema>;

export const staffInviteSchema = z.strictObject({
  name: z.string().trim().min(2, "Nama minimal dua karakter.").max(100),
  email: z
    .email("Masukkan email staf yang valid.")
    .trim()
    .toLowerCase()
    .max(254),
  role: z.enum(STAFF_ROLES),
});

export type StaffInvite = z.infer<typeof staffInviteSchema>;

export const staffUpdateSchema = z.strictObject({
  role: z.enum(STAFF_ROLES),
  isActive: z.boolean(),
});

export type StaffUpdate = z.infer<typeof staffUpdateSchema>;

export const staffPageSchema = z.object({
  staff: z.array(staffMemberSchema),
  total: z.number().int(),
});

export type StaffPage = z.infer<typeof staffPageSchema>;

export const staffAccessLinkSchema = z.object({
  staff: staffMemberSchema,
  url: z.url(),
  expiresAt: z.iso.datetime(),
  purpose: z.enum(["invite", "reset"]),
});

export type StaffAccessLink = z.infer<typeof staffAccessLinkSchema>;

export const passwordSetupInputSchema = z.strictObject({
  token: z
    .string()
    .regex(/^[a-f0-9]{64}$/, "Tautan tidak valid. Minta tautan baru ke admin."),
  password: z.string().min(12, "Gunakan minimal 12 karakter.").max(128),
});

export type PasswordSetupInput = z.infer<typeof passwordSetupInputSchema>;

export const auditQuerySchema = listQuerySchema
  .extend({
    ...PERIOD_FIELDS,
    action: z.string().trim().max(100).default(""),
    actorId: z.uuid().optional(),
  })
  .refine(validPeriod, PERIOD_ERROR);

export type AuditQuery = z.infer<typeof auditQuerySchema>;

export const auditEventSchema = z.object({
  id: z.uuid(),
  actor: staffSchema.nullable(),
  action: z.string(),
  resourceId: z.uuid().nullable(),
  details: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.null()]),
  ),
  createdAt: z.iso.datetime(),
});

export type AuditEvent = z.infer<typeof auditEventSchema>;

export const auditPageSchema = z.object({
  events: z.array(auditEventSchema),
  total: z.number().int(),
});

export type AuditPage = z.infer<typeof auditPageSchema>;

export const packageSnapshotSchema = z.object({
  name: z.string(),
  providerSku: z.string(),
  countries: z.array(z.string()),
  dataMb: z.number().int().positive(),
  validityDays: z.number().int().positive(),
  activationRule: z.literal("first_network_connection"),
  supplierCostIdr: z.number().int().nonnegative(),
  sellingPriceIdr: z.number().int().positive(),
});

export type PackageSnapshot = z.infer<typeof packageSnapshotSchema>;

export const productSchema = packageSnapshotSchema.extend({
  id: z.uuid(),
  isActive: z.boolean(),
  updatedAt: z.iso.datetime(),
});

export type Product = z.infer<typeof productSchema>;

export const productUpdateSchema = z.strictObject({
  sellingPriceIdr: z
    .number()
    .int("Harga harus berupa rupiah bulat.")
    .min(1000, "Harga minimal Rp1.000.")
    .max(100000000),
  isActive: z.boolean(),
});

export type ProductUpdate = z.infer<typeof productUpdateSchema>;

export const productPageSchema = z.object({
  products: z.array(productSchema),
  total: z.number().int(),
  supplier: z.object({
    name: z.string(),
    mode: z.literal("mock"),
    balanceIdr: z.number().int(),
    syncedAt: z.iso.datetime().nullable(),
  }),
});

export type ProductPage = z.infer<typeof productPageSchema>;

export const orderInputSchema = z.strictObject({
  productId: z.uuid("Pilih paket eSIM."),
  customerName: z.string().trim().min(2, "Nama minimal dua karakter.").max(100),
  customerEmail: z
    .email("Masukkan email pelanggan yang valid.")
    .trim()
    .toLowerCase()
    .max(254),
  customerPhone: z
    .string()
    .trim()
    .regex(/^\+?[0-9][0-9 -]{6,19}$/, "Masukkan nomor telepon yang valid."),
  note: z.string().trim().max(500).default(""),
  supplierScenario: z.enum(["success", "fail_once"]).default("success"),
});

export type OrderInput = z.infer<typeof orderInputSchema>;

export const orderSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  invoiceId: z.uuid(),
  invoiceNumber: z.string(),
  customerId: z.uuid(),
  customerName: z.string(),
  customerEmail: z.email(),
  customerPhone: z.string(),
  package: packageSnapshotSchema,
  paymentStatus: z.enum(PAYMENT_STATUSES),
  fulfillmentStatus: z.enum(FULFILLMENT_STATUSES),
  reconciliationRequired: z.boolean(),
  fulfillmentError: z.string().nullable(),
  note: z.string(),
  createdAt: z.iso.datetime(),
});

export type Order = z.infer<typeof orderSchema>;

export const orderPageSchema = z.object({
  orders: z.array(orderSchema),
  total: z.number().int(),
});

export type OrderPage = z.infer<typeof orderPageSchema>;

export const customerSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.email(),
  phone: z.string(),
  orderCount: z.number().int().nonnegative(),
  paidGrossIdr: z.number().int().nonnegative(),
  lastOrderAt: z.iso.datetime(),
});

export type Customer = z.infer<typeof customerSchema>;

export const customerPageSchema = z.object({
  customers: z.array(customerSchema),
  total: z.number().int().nonnegative(),
});

export type CustomerPage = z.infer<typeof customerPageSchema>;

export const customerDetailSchema = z.object({
  customer: customerSchema,
  orders: z.array(orderSchema),
  total: z.number().int().nonnegative(),
});

export type CustomerDetail = z.infer<typeof customerDetailSchema>;

export const exceptionQuerySchema = listQuerySchema.extend({
  kind: z.enum(EXCEPTION_KINDS).optional(),
});

export type ExceptionQuery = z.infer<typeof exceptionQuerySchema>;

export const exceptionFollowUpInputSchema = z.strictObject({
  assigneeId: z.uuid().nullable(),
  outcome: z.enum(FOLLOW_UP_OUTCOMES),
  note: z
    .string()
    .trim()
    .min(3, "Tuliskan tindak lanjut minimal tiga karakter.")
    .max(1000),
});

export type ExceptionFollowUpInput = z.infer<
  typeof exceptionFollowUpInputSchema
>;

export const exceptionAssigneeSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  role: z.enum(STAFF_ROLES),
});

export const exceptionAssigneePageSchema = z.object({
  assignees: z.array(exceptionAssigneeSchema),
});

export type ExceptionAssigneePage = z.infer<typeof exceptionAssigneePageSchema>;

export const exceptionFollowUpSchema = exceptionFollowUpInputSchema
  .omit({
    assigneeId: true,
  })
  .extend({
    id: z.uuid(),
    actorName: z.string(),
    assignee: exceptionAssigneeSchema.pick({ id: true, name: true }).nullable(),
    createdAt: z.iso.datetime(),
  });

export const exceptionFollowUpPageSchema = z.object({
  followUps: z.array(exceptionFollowUpSchema),
  total: z.number().int().nonnegative(),
});

export type ExceptionFollowUpPage = z.infer<typeof exceptionFollowUpPageSchema>;

export const exceptionPageSchema = z.object({
  exceptions: z.array(
    z.object({
      order: orderSchema,
      kinds: z.array(z.enum(EXCEPTION_KINDS)).min(1),
      followUp: exceptionFollowUpSchema
        .pick({
          assignee: true,
          outcome: true,
          createdAt: true,
        })
        .nullable(),
      since: z.iso.datetime(),
      ageMinutes: z.number().int().nonnegative(),
      severity: z.enum(["warning", "critical"]),
    }),
  ),
  total: z.number().int(),
  overdueCount: z.number().int(),
  supplierBalanceIdr: z.number().int().nullable(),
  supplierReservedIdr: z.number().int().nonnegative(),
  supplierAvailableIdr: z.number().int().nonnegative().nullable(),
  blockedByBalanceCount: z.number().int(),
  asOf: z.iso.datetime(),
});

export type ExceptionPage = z.infer<typeof exceptionPageSchema>;
export type ExceptionKind = (typeof EXCEPTION_KINDS)[number];

export const installationSchema = z.object({
  orderNumber: z.string(),
  iccid: z.string(),
  activationCode: z.string(),
  mode: z.literal("mock"),
  activationRule: z.literal("first_network_connection"),
});

export type Installation = z.infer<typeof installationSchema>;

export const paymentAttemptSchema = z.object({
  id: z.uuid(),
  gatewayOrderId: z.string(),
  source: z.enum(["midtrans", "demo"]),
  status: z.enum([
    "creating",
    "pending",
    "paid",
    "failed",
    "expired",
    "unknown",
  ]),
  redirectUrl: z.url().nullable(),
  createdAt: z.iso.datetime(),
});

export type PaymentAttempt = z.infer<typeof paymentAttemptSchema>;

export const invoiceSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  orderId: z.uuid(),
  orderNumber: z.string(),
  customerName: z.string(),
  customerEmail: z.email(),
  customerPhone: z.string(),
  packageName: z.string(),
  amountIdr: z.number().int(),
  supplierCostIdr: z.number().int(),
  marginIdr: z.number().int().nullable(),
  gatewayFeeIdr: z.number().int().nonnegative(),
  refundIdr: z.number().int().nonnegative(),
  netMarginIdr: z.number().int().nullable(),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  fulfillmentStatus: z.enum(FULFILLMENT_STATUSES),
  reconciliationRequired: z.boolean(),
  paidAt: z.iso.datetime().nullable(),
  cancelledAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export type Invoice = z.infer<typeof invoiceSchema>;

export const invoiceAdjustmentInputSchema = z.strictObject({
  kind: z.enum(["gateway_fee", "refund"]),
  amountIdr: z
    .number()
    .int("Gunakan rupiah bulat.")
    .min(1, "Nominal minimal Rp1.")
    .max(100000000),
  reference: z
    .string()
    .trim()
    .min(2, "Masukkan referensi bukti transaksi.")
    .max(100),
  reason: z.string().trim().min(5, "Jelaskan alasan pencatatan.").max(500),
});

export type InvoiceAdjustmentInput = z.infer<
  typeof invoiceAdjustmentInputSchema
>;

export const invoiceAdjustmentSchema = invoiceAdjustmentInputSchema.extend({
  id: z.uuid(),
  actorName: z.string(),
  createdAt: z.iso.datetime(),
});

export type InvoiceAdjustment = z.infer<typeof invoiceAdjustmentSchema>;

export const invoiceDetailSchema = z.object({
  invoice: invoiceSchema,
  attempts: z.array(paymentAttemptSchema),
  adjustments: z.array(invoiceAdjustmentSchema),
});

export type InvoiceDetail = z.infer<typeof invoiceDetailSchema>;

export const invoicePageSchema = z.object({
  invoices: z.array(invoiceSchema),
  total: z.number().int(),
});

export type InvoicePage = z.infer<typeof invoicePageSchema>;

export const dashboardSchema = z.object({
  totalOrders: z.number().int(),
  awaitingPayment: z.number().int(),
  pendingPayments: z.number().int().default(0),
  pendingFulfillment: z.number().int().default(0),
  fulfilled: z.number().int(),
  needsAttention: z.number().int(),
  recentOrders: z.array(orderSchema),
  pendingAutomationEvents: z.number().int(),
  supplierMode: z.literal("mock"),
  midtransConfigured: z.boolean(),
  demoPaymentsEnabled: z.boolean(),
});

export type Dashboard = z.infer<typeof dashboardSchema>;

export const financeSummarySchema = z.object({
  paidGrossIdr: z.number().int(),
  outstandingIdr: z.number().int(),
  supplierSpendIdr: z.number().int(),
  realizedMarginIdr: z.number().int(),
  gatewayFeesIdr: z.number().int().nonnegative(),
  refundsIdr: z.number().int().nonnegative(),
  netRecordedMarginIdr: z.number().int(),
  feesUnrecordedInvoices: z.number().int().nonnegative(),
  needsReconciliation: z.number().int(),
  period: financePeriodSchema,
});

export type FinanceSummary = z.infer<typeof financeSummarySchema>;

export const salesBreakdownSchema = z.object({
  period: financePeriodSchema,
  totalOrders: z.number().int().nonnegative(),
  paidGrossIdr: z.number().int().nonnegative(),
  byCountry: z.array(
    z.object({
      country: z.string(),
      orderCount: z.number().int().nonnegative(),
      grossIdr: z.number().int().nonnegative(),
    }),
  ),
  byPackage: z.array(
    z.object({
      providerSku: z.string(),
      packageName: z.string(),
      orderCount: z.number().int().nonnegative(),
      grossIdr: z.number().int().nonnegative(),
    }),
  ),
  byDay: z.array(
    z.object({
      date: z.iso.date(),
      orderCount: z.number().int().nonnegative(),
      grossIdr: z.number().int().nonnegative(),
    }),
  ),
});

export type SalesBreakdown = z.infer<typeof salesBreakdownSchema>;

export const automationEventSchema = z.object({
  id: z.uuid(),
  kind: z.enum([
    "invoice.paid",
    "invoice.reminder_due",
    "fulfillment.ready",
    "fulfillment.failed",
  ]),
  orderId: z.uuid(),
  orderNumber: z.string(),
  invoiceNumber: z.string(),
  amountIdr: z.number().int(),
  createdAt: z.iso.datetime(),
});

export type AutomationEvent = z.infer<typeof automationEventSchema>;

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
  }),
});

export const okSchema = z.object({ ok: z.literal(true) });
export const idParamsSchema = z.object({ id: z.uuid() });
