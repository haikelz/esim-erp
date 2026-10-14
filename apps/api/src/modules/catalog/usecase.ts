import type {
  ListQuery,
  PackageSnapshot,
  ProductPage,
  ProductUpdate,
  Staff,
} from "@esim-erp/contracts";
import { requireRole } from "../auth/usecase";
import { DomainError } from "../errors";

export type SupplierPackage = PackageSnapshot;

export type CatalogRepository = {
  list: (query: ListQuery) => Promise<ProductPage>;
  update: (id: string, input: ProductUpdate) => Promise<boolean>;
  sync: (packages: SupplierPackage[]) => Promise<void>;
};

export type Supplier = {
  catalog: () => Promise<SupplierPackage[]>;
  provision: (input: {
    orderId: string;
    providerSku: string;
    scenario: "success" | "fail_once";
    attempt: number;
  }) => Promise<{
    providerOrderId: string;
    iccid: string;
    activationCode: string;
  }>;
};

export function listProducts(repository: CatalogRepository, query: ListQuery) {
  return repository.list(query);
}

export async function updateProduct(
  repository: CatalogRepository,
  staff: Staff,
  id: string,
  input: ProductUpdate,
) {
  requireRole(staff, ["admin"]);
  if (!(await repository.update(id, input))) {
    throw new DomainError("product_not_found", 404, "Paket tidak ditemukan.");
  }
}

export async function syncCatalog(
  repository: CatalogRepository,
  supplier: Supplier,
  staff: Staff,
) {
  requireRole(staff, ["admin", "operations"]);
  await repository.sync(await supplier.catalog());
}
