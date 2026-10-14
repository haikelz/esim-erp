import { packageSnapshotSchema } from "@esim-erp/contracts";
import type { Supplier, SupplierPackage } from "../modules/catalog/usecase";
import { DomainError } from "../modules/errors";

const MOCK_PACKAGES: SupplierPackage[] = [
  {
    name: "Japan explorer",
    providerSku: "mock-jp-5gb-7d",
    countries: ["Jepang"],
    dataMb: 5120,
    validityDays: 7,
    activationRule: "first_network_connection",
    supplierCostIdr: 96000,
    sellingPriceIdr: 149000,
  },
  {
    name: "Korea connect",
    providerSku: "mock-kr-10gb-15d",
    countries: ["Korea Selatan"],
    dataMb: 10240,
    validityDays: 15,
    activationRule: "first_network_connection",
    supplierCostIdr: 178000,
    sellingPriceIdr: 249000,
  },
  {
    name: "Singapore short stay",
    providerSku: "mock-sg-3gb-5d",
    countries: ["Singapura"],
    dataMb: 3072,
    validityDays: 5,
    activationRule: "first_network_connection",
    supplierCostIdr: 52000,
    sellingPriceIdr: 89000,
  },
  {
    name: "Thailand getaway",
    providerSku: "mock-th-10gb-15d",
    countries: ["Thailand"],
    dataMb: 10240,
    validityDays: 15,
    activationRule: "first_network_connection",
    supplierCostIdr: 121000,
    sellingPriceIdr: 179000,
  },
  {
    name: "Europe essentials",
    providerSku: "mock-eu-5gb-30d",
    countries: ["Prancis", "Jerman", "Italia", "Spanyol", "Belanda"],
    dataMb: 5120,
    validityDays: 30,
    activationRule: "first_network_connection",
    supplierCostIdr: 236000,
    sellingPriceIdr: 329000,
  },
  {
    name: "Asia hop",
    providerSku: "mock-as-5gb-15d",
    countries: ["Singapura", "Malaysia", "Thailand", "Jepang", "Korea Selatan"],
    dataMb: 5120,
    validityDays: 15,
    activationRule: "first_network_connection",
    supplierCostIdr: 188000,
    sellingPriceIdr: 269000,
  },
  {
    name: "Australia roam",
    providerSku: "mock-au-5gb-15d",
    countries: ["Australia"],
    dataMb: 5120,
    validityDays: 15,
    activationRule: "first_network_connection",
    supplierCostIdr: 139000,
    sellingPriceIdr: 209000,
  },
  {
    name: "United States travel",
    providerSku: "mock-us-10gb-30d",
    countries: ["Amerika Serikat"],
    dataMb: 10240,
    validityDays: 30,
    activationRule: "first_network_connection",
    supplierCostIdr: 257000,
    sellingPriceIdr: 349000,
  },
];

export function createMockSupplier(): Supplier {
  async function catalog() {
    return MOCK_PACKAGES.map((product) => packageSnapshotSchema.parse(product));
  }

  async function provision(input: Parameters<Supplier["provision"]>[0]) {
    if (
      !MOCK_PACKAGES.some(
        (product) => product.providerSku === input.providerSku,
      )
    ) {
      throw new DomainError(
        "supplier_rejected",
        502,
        "Paket tidak tersedia pada supplier.",
      );
    }
    if (input.scenario === "fail_once" && input.attempt === 1) {
      throw new DomainError(
        "supplier_rejected",
        502,
        "Supplier gagal sebelum menerbitkan eSIM. Coba ulang provisioning.",
      );
    }

    // A mock request has no external purchase side effect and is replay-safe by order ID.
    const hash = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(input.orderId),
      ),
    );
    const digits = Array.from(hash.slice(0, 16), (byte) => byte % 10).join("");
    return {
      activationCode: `LPA:1$demo.invalid$MOCK-${input.orderId}`,
      iccid: `890${digits}`,
      providerOrderId: `mock-${input.orderId}`,
    };
  }

  return { catalog, provision };
}
