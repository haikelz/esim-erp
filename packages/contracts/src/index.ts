import { z } from "zod";

export const STAFF_ROLES = ["admin", "sales", "operations", "finance"] as const;
export const PAYMENT_STATUSES = [
  "unpaid",
  "pending",
  "paid",
  "expired",
  "failed",
] as const;
export const FULFILLMENT_STATUSES = [
  "waiting_payment",
  "queued",
  "processing",
  "ready",
  "failed",
  "unknown",
] as const;

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
  packageName: z.string(),
  amountIdr: z.number().int(),
  supplierCostIdr: z.number().int(),
  marginIdr: z.number().int().nullable(),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  fulfillmentStatus: z.enum(FULFILLMENT_STATUSES),
  reconciliationRequired: z.boolean(),
  paidAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export type Invoice = z.infer<typeof invoiceSchema>;

export const invoiceDetailSchema = z.object({
  invoice: invoiceSchema,
  attempts: z.array(paymentAttemptSchema),
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
  needsReconciliation: z.number().int(),
});

export type FinanceSummary = z.infer<typeof financeSummarySchema>;

export const automationEventSchema = z.object({
  id: z.uuid(),
  kind: z.enum(["invoice.paid", "fulfillment.ready", "fulfillment.failed"]),
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
