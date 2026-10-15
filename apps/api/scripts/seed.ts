import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { createBillingRepository } from "../src/infrastructure/billing-repository";
import { createCatalogRepository } from "../src/infrastructure/catalog-repository";
import { encryptProfile, hashPassword } from "../src/infrastructure/crypto";
import { withDatabase } from "../src/infrastructure/database";
import { createFulfillmentRepository } from "../src/infrastructure/fulfillment-repository";
import { createSalesRepository } from "../src/infrastructure/sales-repository";
import {
  customers,
  orders,
  supplierAccount,
  users,
} from "../src/infrastructure/schema";
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
    .values({ id: 1, name: "Supplier belum terhubung", balanceIdr: 12500000 })
    .onConflictDoNothing();
  await database
    .update(supplierAccount)
    .set({ name: "Supplier belum terhubung" })
    .where(
      and(
        eq(supplierAccount.id, 1),
        eq(supplierAccount.name, "Travel eSIM mock supplier"),
      ),
    );

  const staff = [
    { role: "admin", name: "Dewi Kartika", previousName: "Admin" },
    { role: "sales", name: "Rizky Ananda", previousName: "Sales" },
    { role: "operations", name: "Bima Prasetyo", previousName: "Operations" },
    { role: "finance", name: "Sinta Maharani", previousName: "Finance" },
  ] as const;
  for (const member of staff) {
    await database
      .insert(users)
      .values({
        email: `${member.role}@demo.invalid`,
        name: member.name,
        role: member.role,
        passwordHash,
      })
      .onConflictDoNothing({ target: users.email });
    await database
      .update(users)
      .set({ name: member.name })
      .where(
        and(
          eq(users.email, `${member.role}@demo.invalid`),
          eq(users.name, member.previousName),
        ),
      );
  }

  const catalog = createCatalogRepository(database);
  const supplier = createMockSupplier();
  await catalog.sync(await supplier.catalog());
  const [admin] = await database
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, "admin@demo.invalid"))
    .limit(1);
  if (!admin) throw new Error("Synthetic admin is absent");

  const packages = await catalog.list({ page: 1, limit: 50, search: "" });
  const sales = createSalesRepository(database);
  const billing = createBillingRepository(database);
  const examples = [
    {
      name: "Nadia Pratama",
      email: "nadia.pratama@perjalanan.invalid",
      phone: "+6280000000101",
      sku: "mock-jp-5gb-7d",
      status: "paid",
      note: "Perjalanan ke Tokyo dan Osaka.",
    },
    {
      name: "Raka Wijaya",
      email: "raka.wijaya@perjalanan.invalid",
      phone: "+6280000000102",
      sku: "mock-eu-5gb-30d",
      status: "paid",
      note: "Perjalanan melalui Prancis dan Jerman.",
    },
    {
      name: "Maya Lestari",
      email: "maya.lestari@perjalanan.invalid",
      phone: "+6280000000103",
      sku: "mock-kr-10gb-15d",
      status: "paid",
      scenario: "fail_once",
      note: "Perlu tindak lanjut provisioning setelah pembayaran.",
    },
    {
      name: "Dimas Saputra",
      email: "dimas.saputra@perjalanan.invalid",
      phone: "+6280000000104",
      sku: "mock-sg-3gb-5d",
      status: "paid",
      note: "Kunjungan singkat ke Singapura.",
    },
    {
      name: "Laras Wulandari",
      email: "laras.wulandari@perjalanan.invalid",
      phone: "+6280000000105",
      sku: "mock-th-10gb-15d",
      status: "unpaid",
      note: "Menunggu konfirmasi pembayaran sebelum keberangkatan.",
    },
    {
      name: "Nadia Pratama",
      email: "nadia.pratama@perjalanan.invalid",
      phone: "+6280000000101",
      sku: "mock-au-5gb-15d",
      status: "paid",
      note: "Perjalanan lanjutan ke Sydney.",
    },
    {
      name: "Fajar Mahendra",
      email: "fajar.mahendra@perjalanan.invalid",
      phone: "+6280000000106",
      sku: "mock-jp-5gb-7d",
      status: "expired",
      note: "Pelanggan menunda keberangkatan.",
    },
    {
      name: "Putri Amelia",
      email: "putri.amelia@perjalanan.invalid",
      phone: "+6280000000107",
      sku: "mock-eu-5gb-30d",
      status: "unpaid",
      note: "Menunggu kepastian tanggal perjalanan.",
    },
    {
      name: "Naufal Hakim",
      email: "naufal.hakim@perjalanan.invalid",
      phone: "+6280000000108",
      sku: "mock-th-10gb-15d",
      status: "paid",
      note: "Kunjungan kerja ke Bangkok.",
    },
    {
      name: "Sinta Permata",
      email: "sinta.permata@perjalanan.invalid",
      phone: "+6280000000109",
      sku: "mock-kr-10gb-15d",
      status: "cancelled",
      note: "Perjalanan dibatalkan sebelum ada upaya pembayaran.",
    },
    {
      name: "Arya Kurniawan",
      email: "arya.kurniawan@perjalanan.invalid",
      phone: "+6280000000110",
      sku: "mock-sg-3gb-5d",
      status: "failed",
      note: "Kunjungan akhir pekan ke Singapura.",
    },
    {
      name: "Bagas Santoso",
      email: "bagas.santoso@perjalanan.invalid",
      phone: "+6280000000111",
      sku: "mock-as-5gb-15d",
      status: "unpaid",
      note: "Rute Singapura, Malaysia, dan Thailand.",
    },
    {
      name: "Raka Wijaya",
      email: "raka.wijaya@perjalanan.invalid",
      phone: "+6280000000102",
      sku: "mock-us-10gb-30d",
      status: "paid",
      note: "Perjalanan lanjutan ke Amerika Serikat.",
    },
    {
      name: "Wulan Safitri",
      email: "wulan.safitri@perjalanan.invalid",
      phone: "+6280000000112",
      sku: "mock-us-10gb-30d",
      status: "paid",
      note: "Penugasan satu bulan di Amerika Serikat.",
    },
    {
      name: "Dimas Saputra",
      email: "dimas.saputra@perjalanan.invalid",
      phone: "+6280000000104",
      sku: "mock-as-5gb-15d",
      status: "unpaid",
      note: "Rute perjalanan berikutnya belum dikonfirmasi.",
    },
    {
      name: "Jihan Nabila",
      email: "jihan.nabila@perjalanan.invalid",
      phone: "+6280000000113",
      sku: "mock-au-5gb-15d",
      status: "unpaid",
      note: "Persiapan perjalanan ke Melbourne.",
    },
  ] as const;

  const knownOrders = new Set(
    (
      await database
        .select({ email: customers.email, snapshot: orders.packageSnapshot })
        .from(orders)
        .innerJoin(customers, eq(customers.id, orders.customerId))
    ).map(({ email, snapshot }) => `${email}:${snapshot.providerSku}`),
  );
  let added = 0;
  for (const example of examples) {
    const product = packages.products.find(
      (entry) => entry.providerSku === example.sku,
    );
    if (!product) throw new Error("Synthetic package is absent");
    if (knownOrders.has(`${example.email}:${example.sku}`)) continue;

    const order = await sales.create(
      {
        productId: product.id,
        customerName: example.name,
        customerEmail: example.email,
        customerPhone: example.phone,
        note: example.note,
        supplierScenario: "scenario" in example ? example.scenario : "success",
      },
      admin.id,
    );
    added++;
    if (example.status === "cancelled") {
      await sales.cancel(order.id, admin.id);
      continue;
    }
    if (example.status === "unpaid") continue;

    const reservation = await billing.reserveAttempt(order.invoiceId, "demo");
    await billing.recordVerifiedPayment(
      {
        gatewayOrderId: reservation.attempt.gatewayOrderId,
        grossAmount: `${reservation.amountIdr}.00`,
        status: example.status,
        transactionId: `demo-${reservation.attempt.id}`,
      },
      "demo",
    );
  }

  if (added > 0) {
    await processProvisioningJobs(
      createFulfillmentRepository(database),
      supplier,
      (plaintext) => encryptProfile(plaintext, encryptionKey),
    );
  }
  console.info(`Added ${added} synthetic travel orders; existing orders kept.`);
});

console.info(
  "Local seed complete. Credentials are in .amp/in/local-login.txt.",
);
