import {
  customerDetailSchema,
  customerPageSchema,
  customerSchema,
  type ListQuery,
} from "@esim-erp/contracts";
import { count, desc, eq, ilike, or, sql } from "drizzle-orm";
import { DomainError } from "../modules/errors";
import type { Database } from "./database";
import { selectOrderPage, toOrder } from "./order-records";
import { customers, invoices, orders } from "./schema";

function customerDirectory(database: Database) {
  const email = sql<string>`lower(${customers.email})`;

  // Contacts remain immutable order snapshots; email is the directory grouping key.
  return database
    .select({
      id: sql<string>`(array_agg(${customers.id} ORDER BY ${orders.createdAt}, ${orders.sequence}))[1]`.as(
        "id",
      ),
      name: sql<string>`(array_agg(${customers.name} ORDER BY ${orders.createdAt} DESC, ${orders.sequence} DESC))[1]`.as(
        "name",
      ),
      email: email.as("email"),
      phone:
        sql<string>`(array_agg(${customers.phone} ORDER BY ${orders.createdAt} DESC, ${orders.sequence} DESC))[1]`.as(
          "phone",
        ),
      orderCount: count().as("order_count"),
      paidGrossIdr:
        sql<number>`coalesce(sum(${invoices.amountIdr}) FILTER (WHERE ${invoices.paymentStatus} = 'paid'), 0)`
          .mapWith(Number)
          .as("paid_gross_idr"),
      lastOrderAt: sql<Date>`max(${orders.createdAt})`
        .mapWith((value) => new Date(String(value)))
        .as("last_order_at"),
    })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .innerJoin(invoices, eq(invoices.orderId, orders.id))
    .groupBy(email)
    .as("customer_directory");
}

function toCustomer(row: {
  id: string;
  name: string;
  email: string;
  phone: string;
  orderCount: number;
  paidGrossIdr: number;
  lastOrderAt: Date;
}) {
  return customerSchema.parse({
    ...row,
    lastOrderAt: row.lastOrderAt.toISOString(),
  });
}

export async function listCustomers(database: Database, query: ListQuery) {
  const directory = customerDirectory(database);
  const pattern = `%${query.search.replace(/[\\%_]/g, "\\$&")}%`;
  const filter = query.search
    ? or(
        ilike(directory.name, pattern),
        ilike(directory.email, pattern),
        ilike(directory.phone, pattern),
      )
    : undefined;
  const rows = await database
    .select()
    .from(directory)
    .where(filter)
    .orderBy(desc(directory.lastOrderAt), directory.email)
    .limit(query.limit)
    .offset((query.page - 1) * query.limit);
  const [totals] = await database
    .select({ total: count() })
    .from(directory)
    .where(filter);

  return customerPageSchema.parse({
    customers: rows.map(toCustomer),
    total: totals?.total ?? 0,
  });
}

export async function getCustomer(
  database: Database,
  id: string,
  query: Pick<ListQuery, "page" | "limit">,
) {
  const [contact] = await database
    .select({ email: customers.email })
    .from(customers)
    .where(eq(customers.id, id))
    .limit(1);
  if (!contact)
    throw new DomainError("customer_not_found", 404, "Kontak tidak ditemukan.");

  const normalizedEmail = contact.email.toLowerCase();
  const directory = customerDirectory(database);
  const [profile] = await database
    .select()
    .from(directory)
    .where(eq(directory.email, normalizedEmail))
    .limit(1);
  if (!profile)
    throw new DomainError("customer_not_found", 404, "Kontak tidak ditemukan.");

  const records = await selectOrderPage(
    database,
    query,
    eq(sql`lower(${customers.email})`, normalizedEmail),
  );

  return customerDetailSchema.parse({
    customer: toCustomer(profile),
    orders: records.map(toOrder),
    total: profile.orderCount,
  });
}
