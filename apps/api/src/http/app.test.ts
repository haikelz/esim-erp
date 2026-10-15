import {
  auditPageSchema,
  automationEventSchema,
  customerDetailSchema,
  customerPageSchema,
  errorResponseSchema,
  exceptionAssigneePageSchema,
  exceptionFollowUpPageSchema,
  exceptionPageSchema,
  financeSummarySchema,
  installationSchema,
  invoiceDetailSchema,
  invoicePageSchema,
  orderPageSchema,
  orderSchema,
  productPageSchema,
  salesBreakdownSchema,
  STAFF_ROLES,
  staffAccessLinkSchema,
  staffMemberSchema,
  staffPageSchema,
  type StaffRole,
  staffSchema,
} from "@esim-erp/contracts";
import { beforeAll, beforeEach, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import pg from "pg";
import { z } from "zod";
import { type Bindings, readConfig } from "../config";
import { createBillingRepository } from "../infrastructure/billing-repository";
import { createCatalogRepository } from "../infrastructure/catalog-repository";
import { hashPassword, hashToken } from "../infrastructure/crypto";
import { withDatabase } from "../infrastructure/database";
import { createFulfillmentRepository } from "../infrastructure/fulfillment-repository";
import { createMidtransGateway } from "../infrastructure/midtrans";
import {
  esimProfiles,
  invoices,
  paymentAttempts,
  provisioningJobs,
  sessions,
  staffAccessTokens,
  supplierAccount,
  supplierDebits,
  users,
} from "../infrastructure/schema";
import { createMockSupplier } from "../infrastructure/supplier";
import {
  createPaymentLink,
  receiveNotification,
} from "../modules/billing/usecase";
import { DomainError } from "../modules/errors";
import { createApp } from "./app";

const app = createApp();
const TEST_PASSWORD = "test-only-local-staff-password";
const TEST_SERVER_KEY = "test-only-midtrans-server-key-not-a-credential";
const fixtureId = crypto.randomUUID();
const tokens = new Map<StaffRole, string>();
let connection: string;
let adminId: string;
let bindings: Bindings;

beforeAll(async () => {
  connection = process.env.TEST_DATABASE_URL!;
  const bootstrapUrl = new URL(connection);
  bootstrapUrl.pathname = "/postgres";
  const bootstrap = new pg.Client({
    connectionString: bootstrapUrl.toString(),
  });
  await bootstrap.connect();
  try {
    const present = await bootstrap.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      ["esim_erp_test"],
    );
    if (present.rowCount === 0)
      await bootstrap.query('CREATE DATABASE "esim_erp_test"');
  } finally {
    await bootstrap.end();
  }

  bindings = {
    ALLOW_DEMO_PAYMENTS: "true",
    APP_ENV: "local",
    AUTOMATION_TOKEN: "test-only-automation-token-not-a-credential",
    DATABASE_URL: connection,
    ERP_PROXY_SECRET: "test-only-proxy-token-not-a-credential",
    ESIM_ENCRYPTION_KEY: "f".repeat(64),
    WEB_ORIGIN: "http://localhost:3010",
  };
  const passwordHash = await hashPassword(TEST_PASSWORD);
  await withDatabase(connection, async (database) => {
    await migrate(database, {
      migrationsFolder: resolve(import.meta.dir, "../../migrations"),
    });
    for (const role of STAFF_ROLES) {
      const token = crypto.randomUUID();
      const id = crypto.randomUUID();
      if (role === "admin") adminId = id;
      tokens.set(role, token);
      await database.insert(users).values({
        email: `${role}-${fixtureId}@demo.invalid`,
        id,
        name: `Synthetic ${role}`,
        passwordHash,
        role,
      });
      await database.insert(sessions).values({
        expiresAt: new Date(Date.now() + 3600000),
        tokenHash: await hashToken(token),
        userId: id,
      });
    }
    await database
      .insert(supplierAccount)
      .values({
        balanceIdr: 100000000,
        id: 1,
        name: "Isolated test mock supplier",
      })
      .onConflictDoNothing();
    await createCatalogRepository(database).sync(
      await createMockSupplier().catalog(),
    );
  });
}, 30000);

type RequestOptions = {
  body?: Record<string, unknown>;
  env?: Bindings;
  method?: string;
  role?: StaffRole;
  token?: string;
};

function request(
  path: string,
  {
    body,
    env = bindings,
    method = "GET",
    role = "admin",
    token = tokens.get(role),
  }: RequestOptions = {},
) {
  return app.request(
    path,
    {
      body: body ? JSON.stringify(body) : undefined,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-ERP-Proxy": env.ERP_PROXY_SECRET,
      },
      method,
    },
    env,
  );
}

async function json<Schema extends z.ZodType>(
  response: Response,
  schema: Schema,
  status = 200,
): Promise<z.output<Schema>> {
  expect(response.status).toBe(status);
  return schema.parse(await response.json());
}

async function error(response: Response, status: number, code: string) {
  const result = await json(response, errorResponseSchema, status);
  expect(result.error.code).toBe(code);
}

async function orderFixture({
  customerEmail = "traveller@demo.invalid",
  customerName = `Test traveller ${crypto.randomUUID()}`,
  customerPhone = "+628110000000",
  scenario = "success",
  sku = "mock-jp-5gb-7d",
}: {
  customerEmail?: string;
  customerName?: string;
  customerPhone?: string;
  scenario?: "success" | "fail_once";
  sku?: string;
} = {}) {
  const catalog = await json(
    await request("/api/products?limit=50"),
    productPageSchema,
  );
  const product = catalog.products.find(
    (candidate) => candidate.providerSku === sku,
  );
  if (!product) throw new Error("Test package is absent");
  const body = {
    customerEmail,
    customerName,
    customerPhone,
    productId: product.id,
    supplierScenario: scenario,
  };
  const order = await json(
    await request("/api/orders", { body, method: "POST", role: "sales" }),
    orderSchema,
    201,
  );

  return { body, order, product };
}

async function invoice(id: string) {
  return json(
    await request(`/api/invoices/${id}`, { role: "finance" }),
    invoiceDetailSchema,
  );
}

async function processJobs() {
  return json(
    await request("/api/fulfillment/process", {
      method: "POST",
      role: "operations",
    }),
    z.object({ processed: z.number().int() }),
  );
}

async function eventsFor(orderId: string) {
  const response = await app.request(
    "/automation/events",
    {
      headers: { Authorization: `Bearer ${bindings.AUTOMATION_TOKEN}` },
    },
    bindings,
  );
  const result = await json(
    response,
    z.object({ events: z.array(automationEventSchema) }),
  );
  return result.events.filter((event) => event.orderId === orderId);
}

beforeEach(async () => {
  // Consume notifications in the guarded test database so pagination is independent
  // of earlier runs; no demo data, tables or volumes are deleted.
  await withDatabase(connection, async (database) => {
    const outbox = createFulfillmentRepository(database);
    while (true) {
      const pending = await outbox.events();
      if (pending.length === 0) return;
      for (const event of pending) await outbox.acknowledge(event.id);
    }
  });
});

test("staff login returns safe identity, rejects wrong passwords and revokes sessions on logout", async () => {
  const body = {
    email: `admin-${fixtureId}@demo.invalid`,
    password: TEST_PASSWORD,
  };
  await error(
    await request("/auth/login", {
      body: { ...body, password: "wrong-test-password" },
      method: "POST",
    }),
    401,
    "invalid_credentials",
  );
  const loginResponse = await json(
    await request("/auth/login", { body, method: "POST" }),
    z.object({
      expiresAt: z.iso.datetime(),
      staff: staffSchema,
      token: z.string().length(64),
    }),
  );
  expect(loginResponse.staff.role).toBe("admin");
  expect(loginResponse.staff).not.toHaveProperty("passwordHash");
  const headers = {
    Authorization: `Bearer ${loginResponse.token}`,
    "X-ERP-Proxy": bindings.ERP_PROXY_SECRET,
  };
  expect((await app.request("/auth/me", { headers }, bindings)).status).toBe(
    200,
  );
  expect(
    (await app.request("/auth/logout", { headers, method: "POST" }, bindings))
      .status,
  ).toBe(200);
  await error(
    await app.request("/auth/me", { headers }, bindings),
    401,
    "session_expired",
  );
});

test("proxy authentication, staff permissions and automation credentials are separate", async () => {
  await error(
    await app.request("/api/orders", {}, bindings),
    403,
    "untrusted_client",
  );
  await error(
    await app.request(
      "/api/orders",
      {
        headers: { "X-ERP-Proxy": bindings.ERP_PROXY_SECRET },
      },
      bindings,
    ),
    401,
    "unauthenticated",
  );
  const { body, order, product } = await orderFixture();

  await error(
    await request("/api/orders", { body, method: "POST", role: "finance" }),
    403,
    "forbidden",
  );
  await error(
    await request(`/api/products/${product.id}`, {
      body: { isActive: true, sellingPriceIdr: 171500 },
      method: "PATCH",
      role: "sales",
    }),
    403,
    "forbidden",
  );
  await error(
    await request("/api/finance", { role: "operations" }),
    403,
    "forbidden",
  );
  await error(
    await request(`/api/orders/${order.id}/installation`, {
      method: "POST",
      role: "finance",
    }),
    403,
    "forbidden",
  );
  await error(
    await request("/automation/events"),
    403,
    "invalid_automation_token",
  );
  expect(
    (
      await request("/api/products/sync", {
        method: "POST",
        role: "operations",
      })
    ).status,
  ).toBe(200);
  await error(await request("/api/products?limit=51"), 400, "invalid_input");
});

test("orders keep package and price snapshots after catalog changes and reject inactive packages", async () => {
  const { body, order, product } = await orderFixture();
  try {
    expect(
      (
        await request(`/api/products/${product.id}`, {
          body: { isActive: true, sellingPriceIdr: 171500 },
          method: "PATCH",
        })
      ).status,
    ).toBe(200);
    const original = await json(
      await request(`/api/orders/${order.id}`),
      orderSchema,
    );
    const originalInvoice = await invoice(order.invoiceId);
    expect(original.package.sellingPriceIdr).toBe(149000);
    expect(originalInvoice.invoice.amountIdr).toBe(149000);
    expect(originalInvoice.invoice.marginIdr).toBeNull();
    const next = await json(
      await request("/api/orders", { body, method: "POST", role: "sales" }),
      orderSchema,
      201,
    );
    expect(next.package.sellingPriceIdr).toBe(171500);
    expect((await invoice(next.invoiceId)).invoice.amountIdr).toBe(171500);

    expect(
      (
        await request(`/api/products/${product.id}`, {
          body: { isActive: false, sellingPriceIdr: 171500 },
          method: "PATCH",
        })
      ).status,
    ).toBe(200);
    await error(
      await request("/api/orders", { body, method: "POST", role: "sales" }),
      409,
      "product_unavailable",
    );
  } finally {
    expect(
      (
        await request(`/api/products/${product.id}`, {
          body: {
            isActive: product.isActive,
            sellingPriceIdr: product.sellingPriceIdr,
          },
          method: "PATCH",
        })
      ).status,
    ).toBe(200);
  }
});

test("client-supplied invoice prices are rejected without creating another order", async () => {
  const { body } = await orderFixture();
  await error(
    await request("/api/orders", {
      body: { ...body, sellingPriceIdr: 1 },
      method: "POST",
      role: "sales",
    }),
    400,
    "invalid_input",
  );
  const matches = await json(
    await request(
      `/api/orders?search=${encodeURIComponent(body.customerName)}`,
    ),
    orderPageSchema,
  );
  expect(matches.total).toBe(1);
});

test("duplicate payments only enqueue; concurrent workers issue one profile and charge the wallet once", async () => {
  const { order } = await orderFixture();
  const before = await json(
    await request("/api/finance"),
    financeSummarySchema,
  );
  const catalogBefore = await json(
    await request("/api/products"),
    productPageSchema,
  );
  const responses = await Promise.all(
    Array.from({ length: 3 }, () =>
      request(`/api/invoices/${order.invoiceId}/simulate-payment`, {
        method: "POST",
        role: "finance",
      }),
    ),
  );

  expect(responses.some((response) => response.status === 200)).toBe(true);
  for (const response of responses)
    expect([200, 409]).toContain(response.status);
  const queued = await invoice(order.invoiceId);
  expect(queued.attempts).toHaveLength(1);
  expect(queued.attempts[0]).toMatchObject({
    source: "demo",
    status: "paid",
  });
  expect(queued.invoice).toMatchObject({
    paymentStatus: "paid",
    fulfillmentStatus: "queued",
    marginIdr: null,
    netMarginIdr: null,
  });
  expect((await eventsFor(order.id)).map((event) => event.kind)).toEqual([
    "invoice.paid",
  ]);
  const queuedFinance = await json(
    await request("/api/finance"),
    financeSummarySchema,
  );
  expect(queuedFinance.supplierSpendIdr).toBe(before.supplierSpendIdr);
  const processed = await Promise.all([
    processJobs(),
    processJobs(),
    processJobs(),
  ]);
  expect(
    processed.reduce((sum, result) => sum + result.processed, 0),
  ).toBeGreaterThanOrEqual(1);
  expect((await invoice(order.invoiceId)).invoice).toMatchObject({
    paymentStatus: "paid",
    fulfillmentStatus: "ready",
    marginIdr: 53000,
    netMarginIdr: 53000,
  });
  const purchase = await withDatabase(connection, async (database) => ({
    debits: await database
      .select({ amountIdr: supplierDebits.amountIdr })
      .from(supplierDebits)
      .where(eq(supplierDebits.orderId, order.id)),
    profiles: await database
      .select({ id: esimProfiles.id })
      .from(esimProfiles)
      .where(eq(esimProfiles.orderId, order.id)),
  }));
  expect(purchase.debits).toEqual([{ amountIdr: 96000 }]);
  expect(purchase.profiles).toHaveLength(1);
  const after = await json(await request("/api/finance"), financeSummarySchema);
  expect(after.paidGrossIdr - before.paidGrossIdr).toBe(149000);
  const catalogAfter = await json(
    await request("/api/products"),
    productPageSchema,
  );
  expect(
    catalogBefore.supplier.balanceIdr - catalogAfter.supplier.balanceIdr,
  ).toBe(after.supplierSpendIdr - before.supplierSpendIdr);
  const installation = await json(
    await request(`/api/orders/${order.id}/installation`, {
      method: "POST",
      role: "sales",
    }),
    installationSchema,
  );
  expect(installation.activationCode).toBe(
    `LPA:1$demo.invalid$MOCK-${order.id}`,
  );
  expect(installation.mode).toBe("mock");
  const events = await eventsFor(order.id);
  expect(events.map((event) => event.kind).sort()).toEqual([
    "fulfillment.ready",
    "invoice.paid",
  ]);
  for (const event of events) {
    expect(event).not.toHaveProperty("activationCode");
    expect(event).not.toHaveProperty("customerEmail");
  }
}, 30000);

test("a paid order with failed provisioning has no supplier charge or margin until an authorized retry", async () => {
  const { order } = await orderFixture({
    scenario: "fail_once",
    sku: "mock-sg-3gb-5d",
  });
  const before = await json(
    await request("/api/finance"),
    financeSummarySchema,
  );
  expect(
    (
      await request(`/api/invoices/${order.invoiceId}/simulate-payment`, {
        method: "POST",
        role: "finance",
      })
    ).status,
  ).toBe(200);
  expect((await invoice(order.invoiceId)).invoice.fulfillmentStatus).toBe(
    "queued",
  );
  expect((await processJobs()).processed).toBe(1);
  const failed = await invoice(order.invoiceId);
  expect(failed.invoice).toMatchObject({
    paymentStatus: "paid",
    fulfillmentStatus: "failed",
    marginIdr: null,
  });
  const afterFailure = await json(
    await request("/api/finance"),
    financeSummarySchema,
  );
  expect(afterFailure.paidGrossIdr - before.paidGrossIdr).toBe(89000);
  expect(afterFailure.supplierSpendIdr).toBe(before.supplierSpendIdr);
  expect(afterFailure.realizedMarginIdr).toBe(before.realizedMarginIdr);
  await error(
    await request(`/api/orders/${order.id}/retry`, {
      method: "POST",
      role: "sales",
    }),
    403,
    "forbidden",
  );
  await error(
    await request(`/api/orders/${order.id}/installation`, {
      method: "POST",
      role: "operations",
    }),
    409,
    "profile_not_ready",
  );

  expect(
    (
      await request(`/api/orders/${order.id}/retry`, {
        method: "POST",
        role: "operations",
      })
    ).status,
  ).toBe(200);
  expect((await invoice(order.invoiceId)).invoice).toMatchObject({
    paymentStatus: "paid",
    fulfillmentStatus: "queued",
    marginIdr: null,
  });
  expect((await processJobs()).processed).toBe(1);
  expect((await invoice(order.invoiceId)).invoice).toMatchObject({
    paymentStatus: "paid",
    fulfillmentStatus: "ready",
    marginIdr: 37000,
  });
  await error(
    await request(`/api/orders/${order.id}/retry`, {
      method: "POST",
      role: "operations",
    }),
    409,
    "retry_not_allowed",
  );
  expect((await eventsFor(order.id)).map((event) => event.kind).sort()).toEqual(
    ["fulfillment.failed", "fulfillment.ready", "invoice.paid"],
  );
});

test("Midtrans notifications need signature and server status; duplicates and stale status cannot downgrade paid invoices", async () => {
  const { order } = await orderFixture();
  const reservation = await withDatabase(connection, (database) =>
    createBillingRepository(database).reserveAttempt(
      order.invoiceId,
      "midtrans",
    ),
  );
  const gatewayOrderId = reservation.attempt.gatewayOrderId;
  const notification = {
    gross_amount: "149000.00",
    order_id: gatewayOrderId,
    signature_key: createHash("sha512")
      .update(`${gatewayOrderId}200149000.00${TEST_SERVER_KEY}`)
      .digest("hex"),
    status_code: "200",
  };
  let status = {
    currency: "IDR",
    gross_amount: "149001.00",
    order_id: gatewayOrderId,
    transaction_id: "test-midtrans-charge",
    transaction_status: "settlement",
  };
  const transport = Object.assign(async () => Response.json(status), {
    preconnect: fetch.preconnect,
  });
  const gateway = createMidtransGateway(TEST_SERVER_KEY, transport);
  function notify(input = notification) {
    return withDatabase(connection, (database) =>
      receiveNotification(createBillingRepository(database), gateway, input),
    );
  }

  await expect(
    notify({ ...notification, signature_key: "0".repeat(128) }),
  ).rejects.toMatchObject({ code: "invalid_signature" });
  await expect(notify()).rejects.toMatchObject({
    code: "payment_amount_mismatch",
  });
  status = { ...status, gross_amount: "149000.50" };
  await expect(notify()).rejects.toMatchObject({
    code: "payment_amount_mismatch",
  });
  expect((await invoice(order.invoiceId)).invoice.paymentStatus).toBe("unpaid");
  await error(
    await request(`/api/invoices/${order.invoiceId}/simulate-payment`, {
      method: "POST",
    }),
    409,
    "payment_source_conflict",
  );
  status = { ...status, gross_amount: "149000.00" };
  await Promise.all([notify(), notify(), notify()]);
  expect(
    (
      await request("/api/fulfillment/process", {
        method: "POST",
        role: "operations",
      })
    ).status,
  ).toBe(200);
  expect((await invoice(order.invoiceId)).invoice).toMatchObject({
    paymentStatus: "paid",
    fulfillmentStatus: "ready",
    marginIdr: 53000,
  });
  expect(await eventsFor(order.id)).toHaveLength(2);

  status = { ...status, transaction_status: "pending" };
  await notify();
  expect((await invoice(order.invoiceId)).invoice.paymentStatus).toBe("paid");
  status = { ...status, transaction_status: "refund" };
  await notify();
  expect((await invoice(order.invoiceId)).invoice).toMatchObject({
    paymentStatus: "paid",
    reconciliationRequired: true,
  });
  status = { ...status, transaction_id: "different-transaction" };
  await expect(notify()).rejects.toMatchObject({
    code: "payment_transaction_mismatch",
  });

  for (const event of await eventsFor(order.id)) {
    const acknowledge = () =>
      app.request(
        `/automation/events/${event.id}/ack`,
        {
          headers: { Authorization: `Bearer ${bindings.AUTOMATION_TOKEN}` },
          method: "POST",
        },
        bindings,
      );
    expect((await acknowledge()).status).toBe(200);
    expect((await acknowledge()).status).toBe(200);
  }
  expect(await eventsFor(order.id)).toHaveLength(0);
}, 30000);

test("uncertain payment-link creation blocks a replacement charge until reconciliation", async () => {
  const { order } = await orderFixture();
  const gateway = {
    createLink: async () => {
      throw new DomainError(
        "payment_creation_uncertain",
        502,
        "Synthetic gateway timeout",
      );
    },
    getStatus: async () => {
      throw new Error("No status available in this test");
    },
    verifyNotification: async () => false,
  };
  const staff = {
    email: `admin-${fixtureId}@demo.invalid`,
    id: adminId,
    name: "Synthetic admin",
    role: "admin" as const,
  };
  await expect(
    withDatabase(connection, (database) =>
      createPaymentLink(
        createBillingRepository(database),
        gateway,
        staff,
        order.invoiceId,
      ),
    ),
  ).rejects.toMatchObject({ code: "payment_creation_uncertain" });

  const detail = await invoice(order.invoiceId);
  expect(detail.invoice).toMatchObject({
    paymentStatus: "pending",
    reconciliationRequired: true,
  });
  expect(detail.attempts[0]?.status).toBe("unknown");
  await error(
    await request(`/api/invoices/${order.invoiceId}/simulate-payment`, {
      method: "POST",
    }),
    409,
    "reconciliation_required",
  );
});

test("late double settlements flag reconciliation and do not buy a profile while payment is ambiguous", async () => {
  const { order } = await orderFixture();
  const first = await withDatabase(connection, (database) =>
    createBillingRepository(database).reserveAttempt(
      order.invoiceId,
      "midtrans",
    ),
  );
  const payment = {
    gatewayOrderId: first.attempt.gatewayOrderId,
    grossAmount: "149000.00",
    status: "expired" as const,
    transactionId: "test-first-charge",
  };
  await withDatabase(connection, (database) =>
    createBillingRepository(database).recordVerifiedPayment(
      payment,
      "midtrans",
    ),
  );
  const second = await withDatabase(connection, (database) =>
    createBillingRepository(database).reserveAttempt(
      order.invoiceId,
      "midtrans",
    ),
  );
  await withDatabase(connection, (database) =>
    createBillingRepository(database).recordVerifiedPayment(
      { ...payment, status: "paid" },
      "midtrans",
    ),
  );
  await withDatabase(connection, (database) =>
    createBillingRepository(database).recordVerifiedPayment(
      {
        ...payment,
        gatewayOrderId: second.attempt.gatewayOrderId,
        status: "paid",
        transactionId: "test-second-charge",
      },
      "midtrans",
    ),
  );

  const processed = await json(
    await request("/api/fulfillment/process", {
      method: "POST",
      role: "operations",
    }),
    z.object({ processed: z.number() }),
  );
  expect(processed.processed).toBe(0);
  const detail = await invoice(order.invoiceId);
  expect(detail.invoice).toMatchObject({
    fulfillmentStatus: "queued",
    marginIdr: null,
    paymentStatus: "paid",
    reconciliationRequired: true,
  });
  expect(
    detail.attempts.filter((attempt) => attempt.status === "paid"),
  ).toHaveLength(2);
  expect((await eventsFor(order.id)).map((event) => event.kind)).toEqual([
    "invoice.paid",
  ]);
});

test("simulated payments require permission and an enabled flag", async () => {
  const { order } = await orderFixture();
  await error(
    await request(`/api/invoices/${order.invoiceId}/simulate-payment`, {
      method: "POST",
      role: "sales",
    }),
    403,
    "forbidden",
  );
  await error(
    await request(`/api/invoices/${order.invoiceId}/simulate-payment`, {
      env: { ...bindings, ALLOW_DEMO_PAYMENTS: "false" },
      method: "POST",
    }),
    403,
    "demo_disabled",
  );
  expect((await invoice(order.invoiceId)).invoice.paymentStatus).toBe("unpaid");
});

test("simulation cannot settle an invoice with a previous Midtrans transaction", async () => {
  const { order } = await orderFixture();
  const reservation = await withDatabase(connection, (database) =>
    createBillingRepository(database).reserveAttempt(
      order.invoiceId,
      "midtrans",
    ),
  );
  await withDatabase(connection, (database) =>
    createBillingRepository(database).recordVerifiedPayment(
      {
        gatewayOrderId: reservation.attempt.gatewayOrderId,
        grossAmount: "149000.00",
        status: "expired",
        transactionId: "test-expired-gateway-charge",
      },
      "midtrans",
    ),
  );

  await error(
    await request(`/api/invoices/${order.invoiceId}/simulate-payment`, {
      method: "POST",
      role: "finance",
    }),
    409,
    "payment_source_conflict",
  );
  const detail = await invoice(order.invoiceId);
  expect(detail.invoice.paymentStatus).toBe("expired");
  expect(detail.attempts).toHaveLength(1);
  expect(detail.attempts[0]?.source).toBe("midtrans");
});

test("Workers use DATABASE_URL directly and fail when it is absent", async () => {
  const deployedBindings: Bindings = {
    ...bindings,
    ALLOW_DEMO_PAYMENTS: "false",
    APP_ENV: "staging",
    DATABASE_URL: connection,
  };

  const catalog = await json(
    await request("/api/products?limit=1", { env: deployedBindings }),
    productPageSchema,
  );
  expect(catalog.products).toHaveLength(1);

  await error(
    await request("/api/products?limit=1", {
      env: { ...deployedBindings, DATABASE_URL: undefined },
    }),
    503,
    "database_not_configured",
  );
});

test("production honors the configured database URL and explicit simulation flag", () => {
  const productionBindings: Bindings = {
    ...bindings,
    ALLOW_DEMO_PAYMENTS: "false",
    APP_ENV: "production",
    DATABASE_URL: connection,
  };

  expect(readConfig(productionBindings)).toMatchObject({
    connectionString: connection,
    demoPaymentsEnabled: false,
  });
  expect(
    readConfig({
      ...productionBindings,
      ALLOW_DEMO_PAYMENTS: "true",
    }).demoPaymentsEnabled,
  ).toBe(true);
});

test("staff invitations are single-use, access changes revoke sessions, and audit history is searchable without credentials", async () => {
  const email = `invited-${fixtureId}@staff.invalid`;
  const grant = await json(
    await request("/api/staff", {
      body: {
        name: "Nadia Operations",
        email: email.toUpperCase(),
        role: "sales",
      },
      method: "POST",
    }),
    staffAccessLinkSchema,
    201,
  );
  expect(grant.staff).toMatchObject({
    email,
    isActive: false,
    onboardedAt: null,
  });
  expect(new URL(grant.url).search).toBe("");
  const token = new URLSearchParams(new URL(grant.url).hash.slice(1)).get(
    "token",
  );
  await error(
    await request("/auth/login", {
      body: { email, password: TEST_PASSWORD },
      method: "POST",
    }),
    401,
    "invalid_credentials",
  );
  await error(
    await request("/api/staff", {
      body: { name: "Other staff", email, role: "finance" },
      method: "POST",
    }),
    409,
    "staff_email_exists",
  );
  await error(
    await request("/auth/set-password", {
      body: { token, password: "too-short" },
      method: "POST",
    }),
    400,
    "invalid_input",
  );
  const redemptions = await Promise.all([
    request("/auth/set-password", {
      body: { token, password: TEST_PASSWORD },
      method: "POST",
    }),
    request("/auth/set-password", {
      body: { token, password: TEST_PASSWORD },
      method: "POST",
    }),
  ]);
  expect(redemptions.map((response) => response.status).sort()).toEqual([
    200, 400,
  ]);
  const loginSchema = z.object({ staff: staffSchema, token: z.string() });
  const signedIn = await json(
    await request("/auth/login", {
      body: { email, password: TEST_PASSWORD },
      method: "POST",
    }),
    loginSchema,
  );
  expect(signedIn.staff.role).toBe("sales");
  await error(
    await request("/api/staff", { token: signedIn.token }),
    403,
    "forbidden",
  );
  const updated = await json(
    await request(`/api/staff/${grant.staff.id}`, {
      body: { role: "finance", isActive: true },
      method: "PATCH",
    }),
    staffMemberSchema,
  );
  expect(updated.role).toBe("finance");
  await error(
    await request("/auth/me", { token: signedIn.token }),
    401,
    "session_expired",
  );
  const finance = await json(
    await request("/auth/login", {
      body: { email, password: TEST_PASSWORD },
      method: "POST",
    }),
    loginSchema,
  );
  expect((await request("/api/finance", { token: finance.token })).status).toBe(
    200,
  );
  const reset = await json(
    await request(`/api/staff/${grant.staff.id}/access-link`, {
      method: "POST",
    }),
    staffAccessLinkSchema,
  );
  expect(reset.purpose).toBe("reset");
  expect(Date.parse(reset.expiresAt) - Date.now()).toBeLessThanOrEqual(3600000);
  expect(Date.parse(reset.expiresAt) - Date.now()).toBeGreaterThan(3540000);
  await error(
    await request("/auth/me", { token: finance.token }),
    401,
    "session_expired",
  );
  const interim = await json(
    await request("/auth/login", {
      body: { email, password: TEST_PASSWORD },
      method: "POST",
    }),
    loginSchema,
  );
  const nextPassword = "test-only-replacement-password";
  expect(
    (
      await request("/auth/set-password", {
        body: {
          token: new URLSearchParams(new URL(reset.url).hash.slice(1)).get(
            "token",
          ),
          password: nextPassword,
        },
        method: "POST",
      })
    ).status,
  ).toBe(200);
  await error(
    await request("/auth/me", { token: interim.token }),
    401,
    "session_expired",
  );
  await error(
    await request("/auth/login", {
      body: { email, password: TEST_PASSWORD },
      method: "POST",
    }),
    401,
    "invalid_credentials",
  );
  const replacement = await json(
    await request("/auth/login", {
      body: { email, password: nextPassword },
      method: "POST",
    }),
    loginSchema,
  );
  expect(
    (
      await request(`/api/staff/${grant.staff.id}`, {
        body: { role: "finance", isActive: false },
        method: "PATCH",
      })
    ).status,
  ).toBe(200);
  await error(
    await request("/auth/me", { token: replacement.token }),
    401,
    "session_expired",
  );
  await error(
    await request("/auth/login", {
      body: { email, password: nextPassword },
      method: "POST",
    }),
    401,
    "invalid_credentials",
  );
  await error(
    await request(`/api/staff/${adminId}`, {
      body: { role: "sales", isActive: true },
      method: "PATCH",
    }),
    409,
    "self_access_removal",
  );
  await error(
    await request("/api/staff", { role: "operations" }),
    403,
    "forbidden",
  );
  await error(
    await request("/api/audit", { role: "finance" }),
    403,
    "forbidden",
  );

  const staff = await json(
    await request(`/api/staff?search=${encodeURIComponent(email)}&limit=1`),
    staffPageSchema.extend({ staff: z.array(staffMemberSchema.strict()) }),
  );
  expect(staff.total).toBe(1);
  expect(staff.staff[0]?.id).toBe(grant.staff.id);
  const audit = await json(
    await request(`/api/audit?search=${grant.staff.id}&limit=50`),
    auditPageSchema,
  );
  expect(audit.events.map((event) => event.action)).toEqual(
    expect.arrayContaining([
      "staff.invited",
      "staff.onboarded",
      "staff.updated",
      "staff.password_reset_requested",
      "staff.password_changed",
    ]),
  );
  expect(
    audit.events.every((event) =>
      Object.keys(event.details).every(
        (key) => !/token|password|activation|ciphertext/i.test(key),
      ),
    ),
  ).toBe(true);
  const filtered = await json(
    await request(
      `/api/audit?search=${grant.staff.id}&action=staff.updated&actorId=${adminId}&limit=1&page=2`,
    ),
    auditPageSchema,
  );
  expect(filtered.total).toBe(2);
  expect(filtered.events).toHaveLength(1);
  expect(filtered.events[0]).toMatchObject({
    action: "staff.updated",
    actor: { id: adminId },
  });
}, 30000);

test("reissued, cancelled and expired invitations cannot activate accounts", async () => {
  const grant = await json(
    await request("/api/staff", {
      body: {
        name: "Cancelled invitation",
        email: `cancelled-${fixtureId}@staff.invalid`,
        role: "operations",
      },
      method: "POST",
    }),
    staffAccessLinkSchema,
    201,
  );
  expect(Date.parse(grant.expiresAt) - Date.now()).toBeGreaterThan(86340000);
  const replaced = await json(
    await request(`/api/staff/${grant.staff.id}/access-link`, {
      method: "POST",
    }),
    staffAccessLinkSchema,
  );
  function redeem(url: string) {
    return request("/auth/set-password", {
      body: {
        token: new URLSearchParams(new URL(url).hash.slice(1)).get("token"),
        password: TEST_PASSWORD,
      },
      method: "POST",
    });
  }
  await error(await redeem(grant.url), 400, "access_link_invalid");
  await error(
    await request(`/api/staff/${grant.staff.id}`, {
      body: { role: "operations", isActive: true },
      method: "PATCH",
    }),
    409,
    "staff_setup_required",
  );
  expect(
    (
      await request(`/api/staff/${grant.staff.id}`, {
        body: { role: "operations", isActive: false },
        method: "PATCH",
      })
    ).status,
  ).toBe(200);
  await error(await redeem(replaced.url), 400, "access_link_invalid");
  const expiring = await json(
    await request(`/api/staff/${grant.staff.id}/access-link`, {
      method: "POST",
    }),
    staffAccessLinkSchema,
  );
  await withDatabase(connection, (database) =>
    database
      .update(staffAccessTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(staffAccessTokens.userId, grant.staff.id)),
  );
  await error(await redeem(expiring.url), 400, "access_link_invalid");
  const result = await json(
    await request(`/api/staff?search=${encodeURIComponent(grant.staff.email)}`),
    staffPageSchema,
  );
  expect(result.staff[0]).toMatchObject({ isActive: false, onboardedAt: null });
  const audit = await json(
    await request(
      `/api/audit?search=${grant.staff.id}&action=staff.invitation_cancelled`,
    ),
    auditPageSchema,
  );
  expect(audit.total).toBe(1);
});

test("period reports use inclusive WIB invoice dates and do not multiply fees, refunds or supplier debits", async () => {
  const period = "from=2020-02-29&to=2020-02-29";
  const before = await json(
    await request(`/api/finance?${period}`),
    financeSummarySchema,
  );
  const marker = `Finance-${crypto.randomUUID()}`;
  const first = await orderFixture({
    sku: "mock-sg-3gb-5d",
    customerName: `=SUM(1,2) "${marker}"`,
  });
  const second = await orderFixture({ customerName: `${marker} second` });
  const failed = await orderFixture({
    sku: "mock-sg-3gb-5d",
    scenario: "fail_once",
    customerName: `${marker} failed`,
  });
  const unpaid = await orderFixture({
    sku: "mock-sg-3gb-5d",
    customerName: `${marker} unpaid`,
  });
  const outsideStart = await orderFixture({ customerName: `${marker} before` });
  const outsideEnd = await orderFixture({ customerName: `${marker} after` });
  for (const fixture of [first, second, failed, outsideStart, outsideEnd])
    expect(
      (
        await request(
          `/api/invoices/${fixture.order.invoiceId}/simulate-payment`,
          { method: "POST" },
        )
      ).status,
    ).toBe(200);
  expect((await processJobs()).processed).toBe(5);

  const adjustments = [
    {
      fixture: first,
      kind: "gateway_fee",
      amountIdr: 1500,
      reference: "fee-one",
    },
    {
      fixture: first,
      kind: "gateway_fee",
      amountIdr: 500,
      reference: "fee-two",
    },
    {
      fixture: first,
      kind: "refund",
      amountIdr: 10000,
      reference: "refund-one",
    },
    {
      fixture: second,
      kind: "gateway_fee",
      amountIdr: 2500,
      reference: "fee-other",
    },
    {
      fixture: second,
      kind: "refund",
      amountIdr: 20000,
      reference: "refund-other",
    },
    {
      fixture: failed,
      kind: "gateway_fee",
      amountIdr: 700,
      reference: "fee-failed",
    },
    {
      fixture: failed,
      kind: "refund",
      amountIdr: 5000,
      reference: "refund-failed",
    },
  ];
  for (const { fixture, ...input } of adjustments)
    expect(
      (
        await request(`/api/invoices/${fixture.order.invoiceId}/adjustments`, {
          body: { ...input, reason: "Verified local settlement evidence" },
          method: "POST",
          role: "finance",
        })
      ).status,
    ).toBe(201);
  const dates = [
    [first, "2020-02-28T17:00:00.000Z"],
    [second, "2020-02-29T16:59:59.999Z"],
    [failed, "2020-02-29T03:00:00.000Z"],
    [unpaid, "2020-02-29T08:00:00.000Z"],
    [outsideStart, "2020-02-28T16:59:59.999Z"],
    [outsideEnd, "2020-02-29T17:00:00.000Z"],
  ] as const;
  try {
    await withDatabase(connection, async (database) => {
      for (const [fixture, date] of dates)
        await database
          .update(invoices)
          .set({ createdAt: new Date(date) })
          .where(eq(invoices.id, fixture.order.invoiceId));
    });
    const summary = await json(
      await request(`/api/finance?${period}`),
      financeSummarySchema,
    );
    expect(summary).toMatchObject({
      paidGrossIdr: before.paidGrossIdr + 327000,
      outstandingIdr: before.outstandingIdr + 89000,
      supplierSpendIdr: before.supplierSpendIdr + 148000,
      realizedMarginIdr: before.realizedMarginIdr + 90000,
      gatewayFeesIdr: before.gatewayFeesIdr + 5200,
      refundsIdr: before.refundsIdr + 35000,
      netRecordedMarginIdr: before.netRecordedMarginIdr + 55500,
      feesUnrecordedInvoices: before.feesUnrecordedInvoices,
      period: { from: "2020-02-29", to: "2020-02-29" },
    });
    expect((await invoice(first.order.invoiceId)).invoice).toMatchObject({
      gatewayFeeIdr: 2000,
      refundIdr: 10000,
      marginIdr: 37000,
      netMarginIdr: 25000,
    });
    expect(
      (await invoice(failed.order.invoiceId)).invoice.netMarginIdr,
    ).toBeNull();
    const filters = `${period}&search=${encodeURIComponent(marker)}`;
    const listing = await json(
      await request(`/api/invoices?${filters}`),
      invoicePageSchema,
    );
    expect(listing.total).toBe(4);
    expect(listing.invoices.map((row) => row.id).sort()).toEqual(
      [first, second, failed, unpaid]
        .map((fixture) => fixture.order.invoiceId)
        .sort(),
    );
    const page = await json(
      await request(`/api/invoices?${filters}&page=2&limit=1`),
      invoicePageSchema,
    );
    expect(page.total).toBe(4);
    expect(page.invoices.map((row) => row.id)).toEqual([
      failed.order.invoiceId,
    ]);
    const exported = await request(
      `/api/invoices/export?${filters}&page=2&limit=1`,
      { role: "finance" },
    );
    expect(exported.status).toBe(200);
    expect(exported.headers.get("Content-Disposition")).toContain(
      "attachment;",
    );
    const bytes = new Uint8Array(await exported.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([239, 187, 191]);
    const csv = new TextDecoder().decode(bytes);
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(5);
    expect(csv).toContain(`"'=SUM(1,2) ""${marker}"""`);
    expect(csv).toContain(",89000,52000,37000,2000,10000,25000\r\n");
    for (const fixture of [first, second, failed, unpaid])
      expect(csv).toContain(fixture.order.invoiceNumber);
    for (const fixture of [outsideStart, outsideEnd])
      expect(csv).not.toContain(fixture.order.invoiceNumber);
  } finally {
    await withDatabase(connection, (database) =>
      database
        .update(invoices)
        .set({ createdAt: new Date() })
        .where(
          inArray(
            invoices.id,
            dates.map(([fixture]) => fixture.order.invoiceId),
          ),
        ),
    );
  }
  for (const invalid of [
    "from=2020-02-29",
    "from=2020-02-30&to=2020-03-01",
    "from=2020-03-01&to=2020-02-29",
  ])
    await error(await request(`/api/finance?${invalid}`), 400, "invalid_input");
  await error(
    await request("/api/invoices/export", { role: "sales" }),
    403,
    "forbidden",
  );
}, 30000);

test("adjustments require paid invoices, unique evidence and serialized refunds below the paid total", async () => {
  const { order } = await orderFixture({ sku: "mock-sg-3gb-5d" });
  const input = {
    kind: "refund",
    amountIdr: 10000,
    reference: "first-refund",
    reason: "Documented partial refund",
  };
  function adjust(body = input, role: StaffRole = "finance") {
    return request(`/api/invoices/${order.invoiceId}/adjustments`, {
      body,
      method: "POST",
      role,
    });
  }
  await error(await adjust(), 409, "adjustment_requires_payment");
  await error(await adjust(input, "operations"), 403, "forbidden");
  expect(
    (
      await request(`/api/invoices/${order.invoiceId}/simulate-payment`, {
        method: "POST",
      })
    ).status,
  ).toBe(200);
  expect((await processJobs()).processed).toBe(1);
  await error(await adjust({ ...input, amountIdr: 0 }), 400, "invalid_input");
  await error(await adjust({ ...input, amountIdr: 1.5 }), 400, "invalid_input");
  expect((await adjust()).status).toBe(201);
  await error(
    await adjust({ ...input, amountIdr: 12345 }),
    409,
    "adjustment_reference_exists",
  );
  const refunds = await Promise.all([
    adjust({ ...input, amountIdr: 60000, reference: "race-a" }),
    adjust({ ...input, amountIdr: 60000, reference: "race-b" }),
  ]);
  expect(refunds.map((response) => response.status).sort()).toEqual([201, 409]);
  const detail = await invoice(order.invoiceId);
  expect(detail.adjustments).toHaveLength(2);
  expect(detail.invoice).toMatchObject({
    paymentStatus: "paid",
    amountIdr: 89000,
    refundIdr: 70000,
    marginIdr: 37000,
    netMarginIdr: -33000,
  });
  expect(
    (await adjust({ ...input, amountIdr: 19000, reference: "full-refund" }))
      .status,
  ).toBe(201);
  await error(
    await adjust({ ...input, amountIdr: 1, reference: "excess-refund" }),
    409,
    "refund_exceeds_payment",
  );
  expect((await invoice(order.invoiceId)).invoice.refundIdr).toBe(89000);
});

test("processing and unknown purchases reserve wallet funds; an expired lease cannot retry or complete late", async () => {
  const first = await orderFixture({ sku: "mock-sg-3gb-5d" });
  const second = await orderFixture();
  for (const fixture of [first, second])
    expect(
      (
        await request(
          `/api/invoices/${fixture.order.invoiceId}/simulate-payment`,
          { method: "POST" },
        )
      ).status,
    ).toBe(200);
  const before = await json(
    await request("/api/exceptions"),
    exceptionPageSchema,
  );
  if (before.supplierBalanceIdr === null)
    throw new Error("Test wallet is absent");
  const originalBalanceIdr = before.supplierBalanceIdr;
  try {
    await withDatabase(connection, (database) =>
      database
        .update(supplierAccount)
        .set({ balanceIdr: before.supplierReservedIdr + 147999 })
        .where(eq(supplierAccount.id, 1)),
    );
    const lease = await withDatabase(connection, (database) =>
      createFulfillmentRepository(database).claim(),
    );
    if (!lease) throw new Error("Affordable test job was not claimed");
    expect(lease.orderId).toBe(first.order.id);
    expect((await processJobs()).processed).toBe(0);
    const processing = await json(
      await request("/api/exceptions"),
      exceptionPageSchema,
    );
    expect(processing.supplierAvailableIdr).toBe(95999);
    expect(processing.supplierReservedIdr).toBe(
      before.supplierReservedIdr + 52000,
    );
    expect(processing.blockedByBalanceCount).toBeGreaterThanOrEqual(1);
    await withDatabase(connection, async (database) => {
      await database
        .update(provisioningJobs)
        .set({ lockedAt: new Date(Date.now() - 121000) })
        .where(eq(provisioningJobs.orderId, first.order.id));
      await database
        .update(invoices)
        .set({ paidAt: new Date(Date.now() - 61 * 60000) })
        .where(eq(invoices.id, first.order.invoiceId));
    });
    expect((await processJobs()).processed).toBe(0);
    await withDatabase(connection, async (database) => {
      const repository = createFulfillmentRepository(database);
      await repository.complete(lease, {
        ciphertext: "late-test-profile",
        iccid: `late-${first.order.id}`,
        providerOrderId: `late-${first.order.id}`,
      });
      await repository.fail(
        lease,
        "Late result must not override recovery",
        false,
      );
    });
    expect((await invoice(first.order.invoiceId)).invoice).toMatchObject({
      fulfillmentStatus: "unknown",
      marginIdr: null,
    });
    expect(
      (await invoice(second.order.invoiceId)).invoice.fulfillmentStatus,
    ).toBe("queued");
    await error(
      await request(`/api/orders/${first.order.id}/retry`, {
        method: "POST",
        role: "operations",
      }),
      409,
      "retry_not_allowed",
    );
    await error(
      await request("/api/fulfillment/process", {
        method: "POST",
        role: "finance",
      }),
      403,
      "forbidden",
    );
    const unknown = await json(
      await request(`/api/exceptions?search=${first.order.number}`),
      exceptionPageSchema,
    );
    expect(unknown.supplierAvailableIdr).toBe(95999);
    expect(unknown.supplierBalanceIdr).toBe(
      before.supplierReservedIdr + 147999,
    );
    expect(unknown.exceptions[0]).toMatchObject({
      kinds: ["supplier_unknown", "paid_unissued"],
      severity: "critical",
      ageMinutes: 61,
    });
    expect(
      (await eventsFor(first.order.id)).map((event) => event.kind).sort(),
    ).toEqual(["fulfillment.failed", "invoice.paid"]);
  } finally {
    // Release only leases created by this test in the guarded disposable database.
    await withDatabase(connection, async (database) => {
      await database
        .update(provisioningJobs)
        .set({ status: "failed", lockedAt: null, leaseToken: null })
        .where(
          inArray(provisioningJobs.orderId, [first.order.id, second.order.id]),
        );
      await database
        .update(supplierAccount)
        .set({ balanceIdr: originalBalanceIdr })
        .where(eq(supplierAccount.id, 1));
    });
  }
});

test("exception age thresholds exclude recent queued orders and prioritize critical overdue orders", async () => {
  const marker = `Age-${crypto.randomUUID()}`;
  const fixtures = [];
  for (const age of [14, 15, 60]) {
    const fixture = await orderFixture({
      sku: "mock-sg-3gb-5d",
      customerName: `${marker} ${age}`,
    });
    fixtures.push(fixture);
    expect(
      (
        await request(
          `/api/invoices/${fixture.order.invoiceId}/simulate-payment`,
          { method: "POST" },
        )
      ).status,
    ).toBe(200);
    await withDatabase(connection, (database) =>
      database
        .update(invoices)
        .set({ paidAt: new Date(Date.now() - (age + 0.5) * 60000) })
        .where(eq(invoices.id, fixture.order.invoiceId)),
    );
  }
  try {
    const result = await json(
      await request(
        `/api/exceptions?search=${encodeURIComponent(marker)}&kind=paid_unissued`,
        { role: "sales" },
      ),
      exceptionPageSchema,
    );
    expect(result.total).toBe(2);
    expect(result.overdueCount).toBe(1);
    const warning = fixtures[1];
    const critical = fixtures[2];
    if (!warning || !critical)
      throw new Error("Exception threshold fixtures are absent");
    expect(
      result.exceptions.map((entry) => ({
        age: entry.ageMinutes,
        severity: entry.severity,
        number: entry.order.number,
      })),
    ).toEqual([
      { age: 60, severity: "critical", number: critical.order.number },
      { age: 15, severity: "warning", number: warning.order.number },
    ]);
    await error(
      await request("/api/exceptions?kind=invalid"),
      400,
      "invalid_input",
    );
  } finally {
    await processJobs();
  }
});

test("orders can be cancelled before payment, but not after failed or expired attempts", async () => {
  const cancellable = await orderFixture();
  const before = await json(
    await request("/api/finance", { role: "finance" }),
    financeSummarySchema,
  );

  await error(
    await request(`/api/orders/${cancellable.order.id}/cancel`, {
      method: "POST",
      role: "finance",
    }),
    403,
    "forbidden",
  );
  const cancelled = await json(
    await request(`/api/orders/${cancellable.order.id}/cancel`, {
      method: "POST",
      role: "sales",
    }),
    orderSchema,
  );
  expect(cancelled).toMatchObject({
    paymentStatus: "cancelled",
    fulfillmentStatus: "cancelled",
  });
  const detail = await invoice(cancelled.invoiceId);
  expect(detail.invoice.cancelledAt).not.toBeNull();
  expect(detail.attempts).toHaveLength(0);
  expect(
    (
      await json(
        await request("/api/finance", { role: "finance" }),
        financeSummarySchema,
      )
    ).outstandingIdr,
  ).toBe(before.outstandingIdr - cancellable.product.sellingPriceIdr);
  await error(
    await request(`/api/orders/${cancelled.id}/cancel`, { method: "POST" }),
    409,
    "cancellation_not_allowed",
  );
  await error(
    await request(`/api/invoices/${cancelled.invoiceId}/payment-link`, {
      env: { ...bindings, MIDTRANS_SERVER_KEY: TEST_SERVER_KEY },
      method: "POST",
      role: "finance",
    }),
    409,
    "invoice_cancelled",
  );
  await error(
    await request(`/api/invoices/${cancelled.invoiceId}/simulate-payment`, {
      method: "POST",
      role: "finance",
    }),
    409,
    "invoice_cancelled",
  );
  await error(
    await request(`/api/orders/${crypto.randomUUID()}/cancel`, {
      method: "POST",
    }),
    404,
    "order_not_found",
  );

  for (const status of ["failed", "expired"] as const) {
    const { order } = await orderFixture();
    await withDatabase(connection, async (database) => {
      const billing = createBillingRepository(database);
      const reserved = await billing.reserveAttempt(order.invoiceId, "demo");
      if (status === "failed") {
        await billing.failCreation(reserved.attempt.id, false);
      } else {
        await database
          .update(paymentAttempts)
          .set({ status: "expired" })
          .where(eq(paymentAttempts.id, reserved.attempt.id));
        await database
          .update(invoices)
          .set({ paymentStatus: "expired" })
          .where(eq(invoices.id, order.invoiceId));
      }
    });

    await error(
      await request(`/api/orders/${order.id}/cancel`, { method: "POST" }),
      409,
      "cancellation_not_allowed",
    );
    expect((await invoice(order.invoiceId)).invoice.paymentStatus).toBe(status);
  }
});

test("concurrent payment and cancellation serialize on the invoice", async () => {
  const { order } = await orderFixture();
  const [cancellation, payment] = await Promise.all([
    request(`/api/orders/${order.id}/cancel`, { method: "POST" }),
    request(`/api/invoices/${order.invoiceId}/simulate-payment`, {
      method: "POST",
    }),
  ]);

  expect([cancellation.status, payment.status].sort()).toEqual([200, 409]);
  const result = await invoice(order.invoiceId);
  expect(result.invoice.paymentStatus).toBe(
    cancellation.status === 200 ? "cancelled" : "paid",
  );
  expect(result.attempts).toHaveLength(payment.status === 200 ? 1 : 0);
  if (cancellation.status === 409)
    expect(
      errorResponseSchema.parse(await cancellation.json()).error.code,
    ).toBe("cancellation_not_allowed");
  if (payment.status === 409)
    expect(errorResponseSchema.parse(await payment.json()).error.code).toBe(
      "invoice_cancelled",
    );
});

test("customer directory groups order snapshots by normalized email and preserves the history", async () => {
  const email = `visitor-${crypto.randomUUID()}@demo.invalid`;
  const first = await orderFixture({
    customerEmail: email,
    customerName: "Initial traveller",
    customerPhone: "+628110000001",
  });
  const second = await orderFixture({
    customerEmail: email.toUpperCase(),
    customerName: "Updated traveller",
    customerPhone: "+628110000002",
    sku: "mock-sg-3gb-5d",
  });
  expect(
    (
      await request(`/api/invoices/${first.order.invoiceId}/simulate-payment`, {
        method: "POST",
      })
    ).status,
  ).toBe(200);

  const directory = await json(
    await request(`/api/customers?search=${encodeURIComponent(email)}`, {
      role: "sales",
    }),
    customerPageSchema,
  );
  expect(directory.total).toBe(1);
  expect(directory.customers[0]).toMatchObject({
    id: first.order.customerId,
    email,
    name: "Updated traveller",
    phone: "+628110000002",
    orderCount: 2,
    paidGrossIdr: first.product.sellingPriceIdr,
  });
  const page = await json(
    await request(`/api/customers/${second.order.customerId}?limit=1`, {
      role: "sales",
    }),
    customerDetailSchema,
  );
  expect(page.customer.id).toBe(first.order.customerId);
  expect(page.total).toBe(2);
  expect(page.orders.map((order) => order.id)).toEqual([second.order.id]);
  expect(page.orders[0]?.customerPhone).toBe("+628110000002");
  const history = await json(
    await request(`/api/customers/${first.order.customerId}?limit=1&page=2`),
    customerDetailSchema,
  );
  expect(history.orders.map((order) => order.id)).toEqual([first.order.id]);
  expect(history.orders[0]?.customerPhone).toBe("+628110000001");
  await error(
    await request("/api/customers", { role: "finance" }),
    403,
    "forbidden",
  );
  await error(
    await request(`/api/customers/${crypto.randomUUID()}`, {
      role: "sales",
    }),
    404,
    "customer_not_found",
  );
});

test("paid sales breakdown counts regional coverage in each country and respects WIB day edges", async () => {
  const period = "from=2020-01-31&to=2020-01-31";
  const before = await json(
    await request(`/api/finance/sales-breakdown?${period}`, {
      role: "finance",
    }),
    salesBreakdownSchema,
  );
  const regional = await orderFixture({ sku: "mock-as-5gb-15d" });
  const japan = await orderFixture({ sku: "mock-jp-5gb-7d" });
  const unpaid = await orderFixture({ sku: "mock-sg-3gb-5d" });
  const outsideStart = await orderFixture({ sku: "mock-sg-3gb-5d" });
  const outsideEnd = await orderFixture({ sku: "mock-sg-3gb-5d" });
  for (const fixture of [regional, japan, outsideStart, outsideEnd])
    expect(
      (
        await request(
          `/api/invoices/${fixture.order.invoiceId}/simulate-payment`,
          { method: "POST" },
        )
      ).status,
    ).toBe(200);

  await withDatabase(connection, async (database) => {
    for (const [fixture, date] of [
      [regional, "2020-01-30T17:00:00.000Z"],
      [japan, "2020-01-31T16:59:59.999Z"],
      [unpaid, "2020-01-31T08:00:00.000Z"],
      [outsideStart, "2020-01-30T16:59:59.999Z"],
      [outsideEnd, "2020-01-31T17:00:00.000Z"],
    ] as const)
      await database
        .update(invoices)
        .set({ createdAt: new Date(date) })
        .where(eq(invoices.id, fixture.order.invoiceId));
  });

  const after = await json(
    await request(`/api/finance/sales-breakdown?${period}`, {
      role: "finance",
    }),
    salesBreakdownSchema,
  );
  expect(after.totalOrders - before.totalOrders).toBe(2);
  expect(after.paidGrossIdr - before.paidGrossIdr).toBe(418000);
  function countryDelta(country: string) {
    const current = after.byCountry.find((row) => row.country === country);
    const previous = before.byCountry.find((row) => row.country === country);
    return {
      count: (current?.orderCount ?? 0) - (previous?.orderCount ?? 0),
      gross: (current?.grossIdr ?? 0) - (previous?.grossIdr ?? 0),
    };
  }
  expect(countryDelta("Jepang")).toEqual({ count: 2, gross: 418000 });
  expect(countryDelta("Singapura")).toEqual({ count: 1, gross: 269000 });
  expect(countryDelta("Malaysia")).toEqual({ count: 1, gross: 269000 });
  for (const [sku, gross] of [
    ["mock-as-5gb-15d", 269000],
    ["mock-jp-5gb-7d", 149000],
  ] as const) {
    const current = after.byPackage.find((row) => row.providerSku === sku);
    const previous = before.byPackage.find((row) => row.providerSku === sku);
    expect((current?.orderCount ?? 0) - (previous?.orderCount ?? 0)).toBe(1);
    expect((current?.grossIdr ?? 0) - (previous?.grossIdr ?? 0)).toBe(gross);
  }
  const day = after.byDay.find((row) => row.date === "2020-01-31");
  const dayBefore = before.byDay.find((row) => row.date === "2020-01-31");
  expect((day?.orderCount ?? 0) - (dayBefore?.orderCount ?? 0)).toBe(2);
  expect((day?.grossIdr ?? 0) - (dayBefore?.grossIdr ?? 0)).toBe(418000);
  await error(
    await request("/api/finance/sales-breakdown", { role: "sales" }),
    403,
    "forbidden",
  );
  await error(
    await request("/api/finance/sales-breakdown?from=2020-01-31"),
    400,
    "invalid_input",
  );
});

test("exception follow-ups keep an auditable history and reject closed cases", async () => {
  const { order } = await orderFixture();
  expect(
    (
      await request(`/api/invoices/${order.invoiceId}/simulate-payment`, {
        method: "POST",
      })
    ).status,
  ).toBe(200);
  await withDatabase(connection, (database) =>
    database
      .update(invoices)
      .set({ paidAt: new Date(Date.now() - 20 * 60000) })
      .where(eq(invoices.id, order.invoiceId)),
  );

  const assignees = await json(
    await request("/api/exceptions/assignees", { role: "operations" }),
    exceptionAssigneePageSchema,
  );
  expect(assignees.assignees.some((staff) => staff.id === adminId)).toBe(true);
  const first = {
    assigneeId: adminId,
    outcome: "waiting_supplier",
    note: "Memeriksa antrean provisioning dengan supplier.",
  };
  await error(
    await request(`/api/exceptions/${order.id}/follow-ups`, {
      body: first,
      method: "POST",
      role: "sales",
    }),
    403,
    "forbidden",
  );
  await error(
    await request(`/api/exceptions/${order.id}/follow-ups`, {
      body: { ...first, note: "ab" },
      method: "POST",
      role: "operations",
    }),
    400,
    "invalid_input",
  );
  await error(
    await request(`/api/exceptions/${order.id}/follow-ups`, {
      body: { ...first, assigneeId: crypto.randomUUID() },
      method: "POST",
      role: "operations",
    }),
    409,
    "assignee_unavailable",
  );
  expect(
    (
      await request(`/api/exceptions/${order.id}/follow-ups`, {
        body: first,
        method: "POST",
        role: "operations",
      })
    ).status,
  ).toBe(201);
  const next = {
    assigneeId: null,
    outcome: "investigating",
    note: "Status diperiksa kembali dan akan dipantau.",
  };
  expect(
    (
      await request(`/api/exceptions/${order.id}/follow-ups`, {
        body: next,
        method: "POST",
        role: "finance",
      })
    ).status,
  ).toBe(201);

  const history = await json(
    await request(`/api/exceptions/${order.id}/follow-ups?limit=1&page=1`, {
      role: "operations",
    }),
    exceptionFollowUpPageSchema,
  );
  expect(history.total).toBe(2);
  expect(history.followUps[0]).toMatchObject({
    note: next.note,
    outcome: "investigating",
    assignee: null,
    actorName: "Synthetic finance",
  });
  const previous = await json(
    await request(`/api/exceptions/${order.id}/follow-ups?limit=1&page=2`),
    exceptionFollowUpPageSchema,
  );
  expect(previous.followUps[0]).toMatchObject({
    note: first.note,
    assignee: { id: adminId, name: "Synthetic admin" },
    actorName: "Synthetic operations",
  });
  const inbox = await json(
    await request(`/api/exceptions?search=${order.number}`),
    exceptionPageSchema,
  );
  expect(
    inbox.exceptions.find((entry) => entry.order.id === order.id)?.followUp,
  ).toMatchObject({
    outcome: "investigating",
    assignee: null,
  });
  await error(
    await request("/api/exceptions/assignees", { role: "sales" }),
    403,
    "forbidden",
  );

  await withDatabase(connection, (database) =>
    database
      .update(invoices)
      .set({ paidAt: new Date() })
      .where(eq(invoices.id, order.invoiceId)),
  );
  await error(
    await request(`/api/exceptions/${order.id}/follow-ups`, {
      body: first,
      method: "POST",
      role: "operations",
    }),
    409,
    "exception_closed",
  );
  expect(
    (
      await json(
        await request(`/api/exceptions/${order.id}/follow-ups`),
        exceptionFollowUpPageSchema,
      )
    ).total,
  ).toBe(2);
});

test("follow-up rejects an exception closed by concurrent provisioning", async () => {
  const { order } = await orderFixture();
  expect(
    (
      await request(`/api/invoices/${order.invoiceId}/simulate-payment`, {
        method: "POST",
      })
    ).status,
  ).toBe(200);
  await withDatabase(connection, (database) =>
    database
      .update(invoices)
      .set({ paidAt: new Date(Date.now() - 20 * 60000) })
      .where(eq(invoices.id, order.invoiceId)),
  );

  const concurrent = new pg.Client({ connectionString: connection });
  await concurrent.connect();
  let transactionOpen = false;
  try {
    await concurrent.query("BEGIN");
    transactionOpen = true;
    const changed = await concurrent.query(
      "UPDATE provisioning_jobs SET status = 'ready' WHERE order_id = $1",
      [order.id],
    );
    expect(changed.rowCount).toBe(1);

    const pending = Promise.resolve(
      request(`/api/exceptions/${order.id}/follow-ups`, {
        body: {
          assigneeId: null,
          outcome: "review_complete",
          note: "Memeriksa status provisioning sebelum mencatat tindak lanjut.",
        },
        method: "POST",
        role: "operations",
      }),
    );
    const first = await Promise.race([
      pending.then((response) => response.status),
      new Promise<"waiting">((resolve) =>
        setTimeout(() => resolve("waiting"), 200),
      ),
    ]);
    expect(first).toBe("waiting");

    await concurrent.query("COMMIT");
    transactionOpen = false;
    await error(await pending, 409, "exception_closed");
    const history = await json(
      await request(`/api/exceptions/${order.id}/follow-ups`),
      exceptionFollowUpPageSchema,
    );
    expect(history.total).toBe(0);
  } finally {
    if (transactionOpen) await concurrent.query("ROLLBACK");
    await concurrent.end();
  }
}, 15000);

test("local automation queues one internal reminder after 24 hours and suppresses stale events", async () => {
  const enqueue = () =>
    app.request(
      "/automation/reminders/enqueue",
      {
        headers: { Authorization: `Bearer ${bindings.AUTOMATION_TOKEN}` },
        method: "POST",
      },
      bindings,
    );
  const resultSchema = z.object({ enqueued: z.number().int() });
  // The persistent test database may contain due invoices from earlier runs.
  while (true) {
    const { enqueued } = await json(await enqueue(), resultSchema);
    if (enqueued === 0) break;
  }
  const due = await orderFixture();
  const almostDue = await orderFixture();
  const alreadyPaid = await orderFixture();
  const alreadyCancelled = await orderFixture();
  const paidAfterQueue = await orderFixture();
  const cancelledAfterQueue = await orderFixture();
  const now = Date.now();
  await withDatabase(connection, async (database) => {
    for (const fixture of [
      due,
      alreadyPaid,
      alreadyCancelled,
      paidAfterQueue,
      cancelledAfterQueue,
    ])
      await database
        .update(invoices)
        .set({ createdAt: new Date(now - 24 * 3600000 - 5000) })
        .where(eq(invoices.id, fixture.order.invoiceId));
    await database
      .update(invoices)
      .set({ createdAt: new Date(now - 24 * 3600000 + 5000) })
      .where(eq(invoices.id, almostDue.order.invoiceId));
  });
  expect(
    (
      await request(
        `/api/invoices/${alreadyPaid.order.invoiceId}/simulate-payment`,
        {
          method: "POST",
        },
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await request(`/api/orders/${alreadyCancelled.order.id}/cancel`, {
        method: "POST",
      })
    ).status,
  ).toBe(200);

  expect((await json(await enqueue(), resultSchema)).enqueued).toBe(3);
  expect((await json(await enqueue(), resultSchema)).enqueued).toBe(0);
  expect((await eventsFor(due.order.id)).map((event) => event.kind)).toEqual([
    "invoice.reminder_due",
  ]);
  for (const fixture of [almostDue, alreadyCancelled])
    expect(
      (await eventsFor(fixture.order.id)).some(
        (event) => event.kind === "invoice.reminder_due",
      ),
    ).toBe(false);
  expect(
    (await eventsFor(alreadyPaid.order.id)).some(
      (event) => event.kind === "invoice.reminder_due",
    ),
  ).toBe(false);
  expect(
    (
      await request(
        `/api/invoices/${paidAfterQueue.order.invoiceId}/simulate-payment`,
        {
          method: "POST",
        },
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await request(`/api/orders/${cancelledAfterQueue.order.id}/cancel`, {
        method: "POST",
      })
    ).status,
  ).toBe(200);
  for (const fixture of [paidAfterQueue, cancelledAfterQueue])
    expect(
      (await eventsFor(fixture.order.id)).some(
        (event) => event.kind === "invoice.reminder_due",
      ),
    ).toBe(false);
  const [reminder] = await eventsFor(due.order.id);
  if (!reminder) throw new Error("Reminder event is absent");
  expect(reminder).not.toHaveProperty("customerEmail");
  expect(reminder).not.toHaveProperty("activationCode");
  const ack = await app.request(
    `/automation/events/${reminder.id}/ack`,
    {
      headers: { Authorization: `Bearer ${bindings.AUTOMATION_TOKEN}` },
      method: "POST",
    },
    bindings,
  );
  expect(ack.status).toBe(200);
  expect((await json(await enqueue(), resultSchema)).enqueued).toBe(0);
  expect(await eventsFor(due.order.id)).toHaveLength(0);
  await error(
    await request("/automation/reminders/enqueue", { method: "POST" }),
    403,
    "invalid_automation_token",
  );
  await error(
    await app.request(
      "/automation/reminders/enqueue",
      {
        headers: { Authorization: `Bearer ${bindings.AUTOMATION_TOKEN}` },
        method: "POST",
      },
      {
        ...bindings,
        ALLOW_DEMO_PAYMENTS: "false",
        APP_ENV: "staging",
      },
    ),
    403,
    "local_only",
  );
}, 30000);
