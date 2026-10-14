import { type ProductPage, productSchema } from "@esim-erp/contracts";
import { count, eq, ilike, or, sql } from "drizzle-orm";
import type { CatalogRepository } from "../modules/catalog/usecase";
import { DomainError } from "../modules/errors";
import type { Database } from "./database";
import { products, supplierAccount } from "./schema";

export function createCatalogRepository(database: Database): CatalogRepository {
  async function list(
    query: Parameters<CatalogRepository["list"]>[0],
  ): Promise<ProductPage> {
    const pattern = `%${query.search.replace(/[\\%_]/g, "\\$&")}%`;
    const search = query.search
      ? or(
          ilike(products.name, pattern),
          ilike(sql`array_to_string(${products.countries}, ', ')`, pattern),
        )
      : undefined;
    const rows = await database
      .select()
      .from(products)
      .where(search)
      .orderBy(products.name)
      .limit(query.limit)
      .offset((query.page - 1) * query.limit);
    const totals = await database
      .select({ total: count() })
      .from(products)
      .where(search);
    const suppliers = await database
      .select()
      .from(supplierAccount)
      .where(eq(supplierAccount.id, 1))
      .limit(1);
    const supplier = suppliers[0];
    if (!supplier) {
      throw new DomainError(
        "supplier_not_initialized",
        503,
        "Supplier belum dikonfigurasi. Hubungi administrator.",
      );
    }

    return {
      products: rows.map((product) =>
        productSchema.parse({
          ...product,
          updatedAt: product.updatedAt.toISOString(),
        }),
      ),
      total: totals[0]?.total ?? 0,
      supplier: {
        name: supplier.name,
        mode: "mock",
        balanceIdr: supplier.balanceIdr,
        syncedAt: supplier.syncedAt?.toISOString() ?? null,
      },
    };
  }

  async function update(
    id: string,
    input: Parameters<CatalogRepository["update"]>[1],
  ) {
    const updated = await database
      .update(products)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(products.id, id))
      .returning({ id: products.id });

    return updated.length === 1;
  }

  async function sync(packages: Parameters<CatalogRepository["sync"]>[0]) {
    await database.transaction(async (transaction) => {
      for (const product of packages) {
        await transaction
          .insert(products)
          .values(product)
          .onConflictDoUpdate({
            target: products.providerSku,
            set: {
              name: product.name,
              countries: product.countries,
              dataMb: product.dataMb,
              validityDays: product.validityDays,
              activationRule: product.activationRule,
              supplierCostIdr: product.supplierCostIdr,
              updatedAt: new Date(),
            },
          });
      }

      await transaction
        .update(supplierAccount)
        .set({ syncedAt: new Date() })
        .where(eq(supplierAccount.id, 1));
    });
  }

  return { list, sync, update };
}
