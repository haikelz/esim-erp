import { beforeAll, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
  automationEventSchema,
  errorResponseSchema,
  financeSummarySchema,
  installationSchema,
  invoiceDetailSchema,
  orderPageSchema,
  orderSchema,
  productPageSchema,
  STAFF_ROLES,
  type StaffRole,
  staffSchema,
} from "@esim-erp/contracts";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { z } from "zod";
import { localDatabaseUrl } from "../../scripts/local-database";
import type { Bindings } from "../config";
import { createBillingRepository } from "../infrastructure/billing-repository";
import { createCatalogRepository } from "../infrastructure/catalog-repository";
import { hashPassword, hashToken } from "../infrastructure/crypto";
import { withDatabase } from "../infrastructure/database";
import { createFulfillmentRepository } from "../infrastructure/fulfillment-repository";
import { createMidtransGateway } from "../infrastructure/midtrans";
import { sessions, supplierAccount, users } from "../infrastructure/schema";
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
  connection = localDatabaseUrl(process.env.TEST_DATABASE_URL, "esim_erp_test");
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
};

function request(
  path: string,
  { body, env = bindings, method = "GET", role = "admin" }: RequestOptions = {},
) {
  return app.request(
    path,
    {
      body: body ? JSON.stringify(body) : undefined,
      headers: {
        Authorization: `Bearer ${tokens.get(role)}`,
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
  scenario = "success",
  sku = "mock-jp-5gb-7d",
}: {
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
    customerEmail: "traveller@demo.invalid",
    customerName: `Test traveller ${crypto.randomUUID()}`,
    customerPhone: "+628110000000",
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

test("concurrent duplicate payments issue one profile, charge the wallet once and expose realized margin", async () => {
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
  const detail = await invoice(order.invoiceId);
  expect(detail.attempts).toHaveLength(1);
  expect(detail.invoice).toMatchObject({
    paymentStatus: "paid",
    fulfillmentStatus: "ready",
    marginIdr: 53000,
  });
  const after = await json(await request("/api/finance"), financeSummarySchema);
  expect(after.paidGrossIdr - before.paidGrossIdr).toBe(149000);
  expect(after.supplierSpendIdr - before.supplierSpendIdr).toBe(96000);
  expect(after.realizedMarginIdr - before.realizedMarginIdr).toBe(53000);
  const catalogAfter = await json(
    await request("/api/products"),
    productPageSchema,
  );
  expect(
    catalogBefore.supplier.balanceIdr - catalogAfter.supplier.balanceIdr,
  ).toBe(96000);
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

test("demo payments are denied when disabled and cannot be enabled in staging", async () => {
  const { order } = await orderFixture();
  await error(
    await request(`/api/invoices/${order.invoiceId}/simulate-payment`, {
      env: { ...bindings, ALLOW_DEMO_PAYMENTS: "false" },
      method: "POST",
    }),
    403,
    "demo_disabled",
  );
  await error(
    await request(`/api/invoices/${order.invoiceId}/simulate-payment`, {
      env: {
        ...bindings,
        APP_ENV: "staging",
        HYPERDRIVE: { connectionString: connection },
      },
      method: "POST",
    }),
    503,
    "unsafe_demo_configuration",
  );
  expect((await invoice(order.invoiceId)).invoice.paymentStatus).toBe("unpaid");
});
