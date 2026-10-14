import {
  automationEventSchema,
  dashboardSchema,
  errorResponseSchema,
  financeSummarySchema,
  idParamsSchema,
  installationSchema,
  invoiceDetailSchema,
  invoicePageSchema,
  listQuerySchema,
  loginInputSchema,
  okSchema,
  orderInputSchema,
  orderPageSchema,
  orderSchema,
  paymentAttemptSchema,
  productPageSchema,
  productUpdateSchema,
  type Staff,
  staffSchema,
} from "@esim-erp/contracts";
import { swaggerUI } from "@hono/swagger-ui";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { sql } from "drizzle-orm";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import { type Bindings, type Config, readConfig } from "../config";
import { runFulfillment } from "../fulfillment-worker";
import { createAuthRepository } from "../infrastructure/auth-repository";
import { createBillingRepository } from "../infrastructure/billing-repository";
import { createCatalogRepository } from "../infrastructure/catalog-repository";
import {
  AUTH_CRYPTO,
  decryptProfile,
  hashToken,
  secureEqual,
} from "../infrastructure/crypto";
import { type Database, withDatabase } from "../infrastructure/database";
import { createFulfillmentRepository } from "../infrastructure/fulfillment-repository";
import {
  createMidtransGateway,
  midtransNotificationSchema,
} from "../infrastructure/midtrans";
import { createSalesRepository } from "../infrastructure/sales-repository";
import { createMockSupplier } from "../infrastructure/supplier";
import { authenticate, login, requireRole } from "../modules/auth/usecase";
import {
  assertBillingRole,
  createPaymentLink,
  getInvoice,
  receiveNotification,
  reconcilePayment,
  simulatePayment,
} from "../modules/billing/usecase";
import {
  listProducts,
  syncCatalog,
  updateProduct,
} from "../modules/catalog/usecase";
import { DomainError } from "../modules/errors";
import {
  createOrder,
  getOrder,
  listOrders,
  retryProvisioning,
  revealInstallation,
} from "../modules/sales/usecase";

export type ApiEnvironment = {
  Bindings: Bindings;
  Variables: {
    database: Database;
    config: Config;
    staff: Staff;
    requestId: string;
  };
};

function jsonResponse<Schema extends z.ZodType>(schema: Schema) {
  return {
    description: "Successful response",
    content: { "application/json": { schema } },
  };
}

const ERROR_RESPONSES = {
  400: jsonResponse(errorResponseSchema),
  401: jsonResponse(errorResponseSchema),
  403: jsonResponse(errorResponseSchema),
  404: jsonResponse(errorResponseSchema),
  409: jsonResponse(errorResponseSchema),
  429: jsonResponse(errorResponseSchema),
  502: jsonResponse(errorResponseSchema),
  503: jsonResponse(errorResponseSchema),
};
const STAFF_SECURITY = [{ ProxyAuth: [], StaffSession: [] }];

export function createApp() {
  const app = new OpenAPIHono<ApiEnvironment>({
    defaultHook: (result) => {
      if (!result.success)
        throw new DomainError(
          "invalid_input",
          400,
          result.error.issues[0]?.message ?? "Input tidak valid.",
        );
    },
  });

  // Cloudflare Workers owns response compression, including Wrangler development.
  // https://hono.dev/docs/middleware/builtin/compress
  app.use("*", secureHeaders());
  app.use("*", async (context, next) => {
    const requestId = crypto.randomUUID();
    context.set("requestId", requestId);
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");
    await next();
  });
  app.use(
    "*",
    bodyLimit({
      maxSize: 65536,
      onError: () => {
        throw new DomainError(
          "body_too_large",
          400,
          "Ukuran permintaan melebihi batas 64 KB.",
        );
      },
    }),
  );
  app.use("*", async (context, next) => {
    if (["/health", "/openapi.json", "/docs"].includes(context.req.path))
      return next();

    const limiter = context.env.API_RATE_LIMITER;
    const address = context.req.header("CF-Connecting-IP") ?? "local-client";
    if (limiter && !(await limiter.limit({ key: address })).success) {
      context.header("Retry-After", "60");
      throw new DomainError(
        "rate_limited",
        429,
        "Terlalu banyak permintaan. Tunggu satu menit lalu coba lagi.",
      );
    }

    const config = readConfig(context.env);
    context.set("config", config);
    if (
      context.req.path.startsWith("/auth/") ||
      context.req.path.startsWith("/api/")
    ) {
      if (
        !(await secureEqual(
          context.req.header("X-ERP-Proxy") ?? "",
          config.ERP_PROXY_SECRET,
        ))
      ) {
        throw new DomainError(
          "untrusted_client",
          403,
          "Akses API staf harus melalui aplikasi ERP.",
        );
      }
    }
    if (context.req.path.startsWith("/automation/")) {
      if (
        !(await secureEqual(
          context.req.header("Authorization") ?? "",
          `Bearer ${config.AUTOMATION_TOKEN}`,
        ))
      ) {
        throw new DomainError(
          "invalid_automation_token",
          403,
          "Autentikasi automation tidak valid.",
        );
      }
    }

    await withDatabase(config.connectionString, async (database) => {
      context.set("database", database);
      if (
        context.req.path.startsWith("/api/") ||
        (context.req.path.startsWith("/auth/") &&
          context.req.path !== "/auth/login")
      ) {
        const authorization = context.req.header("Authorization");
        const token = authorization?.startsWith("Bearer ")
          ? authorization.slice(7)
          : undefined;
        context.set(
          "staff",
          await authenticate(
            createAuthRepository(database),
            AUTH_CRYPTO,
            token,
          ),
        );
      }

      await next();
    });
  });

  app.onError((error, context) => {
    const requestId = context.get("requestId") ?? crypto.randomUUID();
    if (error instanceof DomainError) {
      return context.json(
        { error: { code: error.code, message: error.message, requestId } },
        error.status,
      );
    }
    if (error instanceof HTTPException && error.status === 400) {
      return context.json(
        {
          error: {
            code: "invalid_json",
            message: "Permintaan JSON tidak valid.",
            requestId,
          },
        },
        400,
      );
    }

    console.error(
      JSON.stringify({
        event: "api.request_failed",
        requestId,
        errorType: error.name,
      }),
    );
    return context.json(
      {
        error: {
          code: "server_error",
          message:
            "Server belum dapat memproses permintaan. Coba lagi atau hubungi administrator.",
          requestId,
        },
      },
      500,
    );
  });
  app.notFound((context) =>
    context.json(
      {
        error: {
          code: "not_found",
          message: "Endpoint tidak ditemukan.",
          requestId: context.get("requestId"),
        },
      },
      404,
    ),
  );

  app.openAPIRegistry.registerComponent("securitySchemes", "ProxyAuth", {
    type: "apiKey",
    in: "header",
    name: "X-ERP-Proxy",
    description:
      "Server-to-server only. Never expose this key to browser JavaScript.",
  });
  app.openAPIRegistry.registerComponent("securitySchemes", "StaffSession", {
    type: "http",
    scheme: "bearer",
    description: "Opaque database-backed staff session.",
  });
  app.openAPIRegistry.registerComponent("securitySchemes", "AutomationToken", {
    type: "http",
    scheme: "bearer",
    description: "Restricted n8n automation credential.",
  });

  app.get("/health", (context) =>
    context.json({ ok: true, service: "esim-erp-api" }),
  );
  app.get("/ready", async (context) => {
    await context.get("database").execute(sql`SELECT 1`);
    return context.json({ ok: true });
  });

  app.openapi(
    createRoute({
      method: "post",
      path: "/auth/login",
      tags: ["Staff authentication"],
      security: [{ ProxyAuth: [] }],
      request: {
        body: {
          required: true,
          content: { "application/json": { schema: loginInputSchema } },
        },
      },
      responses: {
        200: jsonResponse(
          z.object({
            staff: staffSchema,
            token: z.string(),
            expiresAt: z.iso.datetime(),
          }),
        ),
        ...ERROR_RESPONSES,
      },
    }),
    async (context) => {
      const session = await login(
        createAuthRepository(context.get("database")),
        AUTH_CRYPTO,
        context.req.valid("json"),
      );
      return context.json(
        { ...session, expiresAt: session.expiresAt.toISOString() },
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/auth/me",
      tags: ["Staff authentication"],
      security: STAFF_SECURITY,
      responses: { 200: jsonResponse(staffSchema), ...ERROR_RESPONSES },
    }),
    (context) => context.json(context.get("staff"), 200),
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/auth/logout",
      tags: ["Staff authentication"],
      security: STAFF_SECURITY,
      responses: { 200: jsonResponse(okSchema), ...ERROR_RESPONSES },
    }),
    async (context) => {
      const token = context.req.header("Authorization")?.slice(7) ?? "";
      await createAuthRepository(context.get("database")).revokeSession(
        await hashToken(token),
      );
      return context.json({ ok: true as const }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/dashboard",
      tags: ["Operations"],
      security: STAFF_SECURITY,
      responses: { 200: jsonResponse(dashboardSchema), ...ERROR_RESPONSES },
    }),
    async (context) => {
      const dashboard = await createSalesRepository(
        context.get("database"),
      ).dashboard();
      const config = context.get("config");
      return context.json(
        {
          ...dashboard,
          supplierMode: "mock" as const,
          midtransConfigured: Boolean(config.MIDTRANS_SERVER_KEY),
          demoPaymentsEnabled: config.demoPaymentsEnabled,
        },
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/products",
      tags: ["Products and supplier"],
      security: STAFF_SECURITY,
      request: { query: listQuerySchema },
      responses: { 200: jsonResponse(productPageSchema), ...ERROR_RESPONSES },
    }),
    async (context) =>
      context.json(
        await listProducts(
          createCatalogRepository(context.get("database")),
          context.req.valid("query"),
        ),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: "patch",
      path: "/api/products/{id}",
      tags: ["Products and supplier"],
      security: STAFF_SECURITY,
      request: {
        params: idParamsSchema,
        body: {
          required: true,
          content: { "application/json": { schema: productUpdateSchema } },
        },
      },
      responses: { 200: jsonResponse(okSchema), ...ERROR_RESPONSES },
    }),
    async (context) => {
      await updateProduct(
        createCatalogRepository(context.get("database")),
        context.get("staff"),
        context.req.valid("param").id,
        context.req.valid("json"),
      );
      return context.json({ ok: true as const }, 200);
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/products/sync",
      tags: ["Products and supplier"],
      security: STAFF_SECURITY,
      responses: { 200: jsonResponse(okSchema), ...ERROR_RESPONSES },
    }),
    async (context) => {
      await syncCatalog(
        createCatalogRepository(context.get("database")),
        createMockSupplier(),
        context.get("staff"),
      );
      return context.json({ ok: true as const }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/orders",
      tags: ["Sales and fulfillment"],
      security: STAFF_SECURITY,
      request: { query: listQuerySchema },
      responses: { 200: jsonResponse(orderPageSchema), ...ERROR_RESPONSES },
    }),
    async (context) =>
      context.json(
        await listOrders(
          createSalesRepository(context.get("database")),
          context.req.valid("query"),
        ),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/orders",
      tags: ["Sales and fulfillment"],
      security: STAFF_SECURITY,
      request: {
        body: {
          required: true,
          content: { "application/json": { schema: orderInputSchema } },
        },
      },
      responses: { 201: jsonResponse(orderSchema), ...ERROR_RESPONSES },
    }),
    async (context) =>
      context.json(
        await createOrder(
          createSalesRepository(context.get("database")),
          context.get("staff"),
          context.req.valid("json"),
        ),
        201,
      ),
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/orders/{id}",
      tags: ["Sales and fulfillment"],
      security: STAFF_SECURITY,
      request: { params: idParamsSchema },
      responses: { 200: jsonResponse(orderSchema), ...ERROR_RESPONSES },
    }),
    async (context) =>
      context.json(
        await getOrder(
          createSalesRepository(context.get("database")),
          context.req.valid("param").id,
        ),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/orders/{id}/installation",
      tags: ["Sales and fulfillment"],
      security: STAFF_SECURITY,
      request: { params: idParamsSchema },
      responses: { 200: jsonResponse(installationSchema), ...ERROR_RESPONSES },
    }),
    async (context) => {
      const profile = await revealInstallation(
        createSalesRepository(context.get("database")),
        context.get("staff"),
        context.req.valid("param").id,
        (ciphertext) =>
          decryptProfile(ciphertext, context.get("config").ESIM_ENCRYPTION_KEY),
      );
      return context.json(profile, 200);
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/orders/{id}/retry",
      tags: ["Sales and fulfillment"],
      security: STAFF_SECURITY,
      request: { params: idParamsSchema },
      responses: { 200: jsonResponse(okSchema), ...ERROR_RESPONSES },
    }),
    async (context) => {
      await retryProvisioning(
        createSalesRepository(context.get("database")),
        context.get("staff"),
        context.req.valid("param").id,
      );
      await runFulfillment(
        context.get("database"),
        context.get("config").ESIM_ENCRYPTION_KEY,
      );
      return context.json({ ok: true as const }, 200);
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/fulfillment/process",
      tags: ["Sales and fulfillment"],
      security: STAFF_SECURITY,
      responses: {
        200: jsonResponse(z.object({ processed: z.number().int() })),
        ...ERROR_RESPONSES,
      },
    }),
    async (context) => {
      requireRole(context.get("staff"), ["admin", "operations"]);
      return context.json(
        {
          processed: await runFulfillment(
            context.get("database"),
            context.get("config").ESIM_ENCRYPTION_KEY,
          ),
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/invoices",
      tags: ["Billing and finance"],
      security: STAFF_SECURITY,
      request: { query: listQuerySchema },
      responses: { 200: jsonResponse(invoicePageSchema), ...ERROR_RESPONSES },
    }),
    async (context) => {
      assertBillingRole(context.get("staff"));
      return context.json(
        await createBillingRepository(context.get("database")).list(
          context.req.valid("query"),
        ),
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/invoices/{id}",
      tags: ["Billing and finance"],
      security: STAFF_SECURITY,
      request: { params: idParamsSchema },
      responses: { 200: jsonResponse(invoiceDetailSchema), ...ERROR_RESPONSES },
    }),
    async (context) =>
      context.json(
        await getInvoice(
          createBillingRepository(context.get("database")),
          context.get("staff"),
          context.req.valid("param").id,
        ),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/finance",
      tags: ["Billing and finance"],
      security: STAFF_SECURITY,
      responses: {
        200: jsonResponse(financeSummarySchema),
        ...ERROR_RESPONSES,
      },
    }),
    async (context) => {
      assertBillingRole(context.get("staff"));
      return context.json(
        await createBillingRepository(context.get("database")).summary(),
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/invoices/{id}/payment-link",
      tags: ["Billing and finance"],
      security: STAFF_SECURITY,
      request: { params: idParamsSchema },
      responses: {
        200: jsonResponse(paymentAttemptSchema),
        ...ERROR_RESPONSES,
      },
    }),
    async (context) => {
      assertBillingRole(context.get("staff"));
      const gateway = createMidtransGateway(
        context.get("config").MIDTRANS_SERVER_KEY,
      );
      return context.json(
        await createPaymentLink(
          createBillingRepository(context.get("database")),
          gateway,
          context.get("staff"),
          context.req.valid("param").id,
        ),
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/invoices/{id}/reconcile",
      tags: ["Billing and finance"],
      security: STAFF_SECURITY,
      request: { params: idParamsSchema },
      responses: { 200: jsonResponse(okSchema), ...ERROR_RESPONSES },
    }),
    async (context) => {
      assertBillingRole(context.get("staff"));
      await reconcilePayment(
        createBillingRepository(context.get("database")),
        createMidtransGateway(context.get("config").MIDTRANS_SERVER_KEY),
        context.get("staff"),
        context.req.valid("param").id,
      );
      await runFulfillment(
        context.get("database"),
        context.get("config").ESIM_ENCRYPTION_KEY,
      );
      return context.json({ ok: true as const }, 200);
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/invoices/{id}/simulate-payment",
      tags: ["Billing and finance"],
      security: STAFF_SECURITY,
      request: { params: idParamsSchema },
      responses: { 200: jsonResponse(okSchema), ...ERROR_RESPONSES },
    }),
    async (context) => {
      await simulatePayment(
        createBillingRepository(context.get("database")),
        context.get("staff"),
        context.req.valid("param").id,
        context.get("config").demoPaymentsEnabled,
      );
      await runFulfillment(
        context.get("database"),
        context.get("config").ESIM_ENCRYPTION_KEY,
      );
      return context.json({ ok: true as const }, 200);
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/webhooks/midtrans",
      tags: ["Midtrans sandbox"],
      request: {
        body: {
          required: true,
          content: {
            "application/json": { schema: midtransNotificationSchema },
          },
        },
      },
      responses: { 200: jsonResponse(okSchema), ...ERROR_RESPONSES },
    }),
    async (context) => {
      await receiveNotification(
        createBillingRepository(context.get("database")),
        createMidtransGateway(context.get("config").MIDTRANS_SERVER_KEY),
        context.req.valid("json"),
      );
      await runFulfillment(
        context.get("database"),
        context.get("config").ESIM_ENCRYPTION_KEY,
      );
      return context.json({ ok: true as const }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/automation/events",
      tags: ["n8n automation"],
      security: [{ AutomationToken: [] }],
      responses: {
        200: jsonResponse(z.object({ events: z.array(automationEventSchema) })),
        ...ERROR_RESPONSES,
      },
    }),
    async (context) =>
      context.json(
        {
          events: await createFulfillmentRepository(
            context.get("database"),
          ).events(),
        },
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/automation/events/{id}/ack",
      tags: ["n8n automation"],
      security: [{ AutomationToken: [] }],
      request: { params: idParamsSchema },
      responses: { 200: jsonResponse(okSchema), ...ERROR_RESPONSES },
    }),
    async (context) => {
      if (
        !(await createFulfillmentRepository(
          context.get("database"),
        ).acknowledge(context.req.valid("param").id))
      )
        throw new DomainError("event_not_found", 404, "Event tidak ditemukan.");
      return context.json({ ok: true as const }, 200);
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/automation/finance-summary",
      tags: ["n8n automation"],
      security: [{ AutomationToken: [] }],
      responses: {
        200: jsonResponse(financeSummarySchema),
        ...ERROR_RESPONSES,
      },
    }),
    async (context) =>
      context.json(
        await createBillingRepository(context.get("database")).summary(),
        200,
      ),
  );

  app.doc("/openapi.json", {
    openapi: "3.0.0",
    info: {
      title: "Internal eSIM ERP API",
      version: "0.1.0",
      description:
        "One company, IDR, one mock supplier. Staff APIs are server-to-server; installation codes never enter automation payloads.",
    },
  });
  app.get("/docs", swaggerUI({ url: "/openapi.json" }));

  return app;
}
