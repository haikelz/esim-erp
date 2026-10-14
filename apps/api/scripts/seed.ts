import { count, eq } from "drizzle-orm";
import { z } from "zod";
import { createBillingRepository } from "../src/infrastructure/billing-repository";
import { createCatalogRepository } from "../src/infrastructure/catalog-repository";
import { encryptProfile, hashPassword } from "../src/infrastructure/crypto";
import { withDatabase } from "../src/infrastructure/database";
import { createFulfillmentRepository } from "../src/infrastructure/fulfillment-repository";
import { createSalesRepository } from "../src/infrastructure/sales-repository";
import { orders, supplierAccount, users } from "../src/infrastructure/schema";
import { createMockSupplier } from "../src/infrastructure/supplier";
import { processProvisioningJobs } from "../src/modules/fulfillment/usecase";
import { localDatabaseUrl } from "./local-database";

const connection = localDatabaseUrl(process.env.DATABASE_URL, "esim_erp");
const password = z.string().min(16).parse(process.env.DEMO_PASSWORD);
const encryptionKey = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .parse(process.env.ESIM_ENCRYPTION_KEY);
const passwordHash = await hashPassword(password);

await withDatabase(connection, async (database) => {
  await database
    .insert(supplierAccount)
    .values({ id: 1, name: "Travel eSIM mock supplier", balanceIdr: 12500000 })
    .onConflictDoNothing();
  for (const role of ["admin", "sales", "operations", "finance"] as const) {
    await database
      .insert(users)
      .values({
        email: `${role}@demo.invalid`,
        name:
          role === "admin"
            ? "Admin"
            : role === "sales"
              ? "Sales"
              : role === "operations"
                ? "Operations"
                : "Finance",
        role,
        passwordHash,
      })
      .onConflictDoNothing({ target: users.email });
  }

  const catalog = createCatalogRepository(database);
  const supplier = createMockSupplier();
  await catalog.sync(await supplier.catalog());
  const [totals] = await database.select({ total: count() }).from(orders);
  if (totals && totals.total > 0) {
    console.info(
      "Synthetic accounts and catalog are present. Existing orders and wallet balance were preserved.",
    );
    return;
  }

  const [admin] = await database
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, "admin@demo.invalid"))
    .limit(1);
  if (!admin) throw new Error("Demo admin is absent");

  const packages = await catalog.list({ page: 1, limit: 50, search: "" });
  const sales = createSalesRepository(database);
  const billing = createBillingRepository(database);
  const examples = [
    {
      name: "Nadia Pratama",
      sku: "mock-jp-5gb-7d",
      paid: true,
      scenario: "success",
    },
    {
      name: "Raka Wijaya",
      sku: "mock-eu-5gb-30d",
      paid: false,
      scenario: "success",
    },
    {
      name: "Maya Lestari",
      sku: "mock-kr-10gb-15d",
      paid: true,
      scenario: "fail_once",
    },
    {
      name: "Dimas Saputra",
      sku: "mock-sg-3gb-5d",
      paid: true,
      scenario: "success",
    },
    {
      name: "Laras Wulandari",
      sku: "mock-th-10gb-15d",
      paid: false,
      scenario: "success",
    },
  ] as const;

  for (const [index, example] of examples.entries()) {
    const product = packages.products.find(
      (entry) => entry.providerSku === example.sku,
    );
    if (!product) throw new Error("Synthetic package is absent");

    const order = await sales.create(
      {
        productId: product.id,
        customerName: example.name,
        customerEmail: `traveler-${index + 1}@traveller.invalid`,
        customerPhone: `+62800000000${index + 1}`,
        note: "Pembayaran perlu diverifikasi sebelum kode instalasi dibagikan.",
        supplierScenario: example.scenario,
      },
      admin.id,
    );
    if (!example.paid) continue;

    const reservation = await billing.reserveAttempt(order.invoiceId, "demo");
    await billing.recordVerifiedPayment(
      {
        gatewayOrderId: reservation.attempt.gatewayOrderId,
        grossAmount: `${reservation.amountIdr}.00`,
        status: "paid",
        transactionId: `demo-${reservation.attempt.id}`,
      },
      "demo",
    );
  }

  await processProvisioningJobs(
    createFulfillmentRepository(database),
    supplier,
    (plaintext) => encryptProfile(plaintext, encryptionKey),
  );
});

console.info(
  "Synthetic ERP demo seeded. Credentials are in .amp/in/local-login.txt.",
);
