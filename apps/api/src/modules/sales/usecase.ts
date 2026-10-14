import type {
  Dashboard,
  ExceptionAssigneePage,
  ExceptionFollowUpInput,
  ExceptionFollowUpPage,
  ExceptionPage,
  ExceptionQuery,
  Installation,
  ListQuery,
  Order,
  OrderInput,
  OrderPage,
  Staff,
} from "@esim-erp/contracts";
import { requireRole } from "../auth/usecase";
import { DomainError } from "../errors";

export type SalesRepository = {
  create: (input: OrderInput, actorId: string) => Promise<Order>;
  cancel: (id: string, actorId: string) => Promise<Order>;
  list: (query: ListQuery) => Promise<OrderPage>;
  exceptions: (query: ExceptionQuery) => Promise<ExceptionPage>;
  exceptionAssignees: () => Promise<ExceptionAssigneePage>;
  exceptionFollowUps: (
    id: string,
    query: Pick<ListQuery, "page" | "limit">,
  ) => Promise<ExceptionFollowUpPage>;
  recordExceptionFollowUp: (
    id: string,
    actorId: string,
    input: ExceptionFollowUpInput,
  ) => Promise<void>;
  find: (id: string) => Promise<Order | undefined>;
  installation: (
    id: string,
    actorId: string,
  ) => Promise<
    { orderNumber: string; iccid: string; ciphertext: string } | undefined
  >;
  retryProvisioning: (id: string, actorId: string) => Promise<boolean>;
  dashboard: () => Promise<
    Omit<
      Dashboard,
      "supplierMode" | "midtransConfigured" | "demoPaymentsEnabled"
    >
  >;
};

export async function createOrder(
  repository: SalesRepository,
  staff: Staff,
  input: OrderInput,
) {
  requireRole(staff, ["admin", "sales"]);
  return repository.create(input, staff.id);
}

export function cancelOrder(
  repository: SalesRepository,
  staff: Staff,
  id: string,
) {
  requireRole(staff, ["admin", "sales"]);
  return repository.cancel(id, staff.id);
}

export function listOrders(repository: SalesRepository, query: ListQuery) {
  return repository.list(query);
}

export async function getOrder(repository: SalesRepository, id: string) {
  const order = await repository.find(id);
  if (!order) {
    throw new DomainError("order_not_found", 404, "Pesanan tidak ditemukan.");
  }

  return order;
}

export function listExceptionAssignees(
  repository: SalesRepository,
  staff: Staff,
) {
  requireRole(staff, ["admin", "operations", "finance"]);
  return repository.exceptionAssignees();
}

export function listExceptionFollowUps(
  repository: SalesRepository,
  staff: Staff,
  id: string,
  query: Pick<ListQuery, "page" | "limit">,
) {
  requireRole(staff, ["admin", "operations", "finance"]);
  return repository.exceptionFollowUps(id, query);
}

export function recordExceptionFollowUp(
  repository: SalesRepository,
  staff: Staff,
  id: string,
  input: ExceptionFollowUpInput,
) {
  requireRole(staff, ["admin", "operations", "finance"]);
  return repository.recordExceptionFollowUp(id, staff.id, input);
}

export async function revealInstallation(
  repository: SalesRepository,
  staff: Staff,
  id: string,
  decrypt: (ciphertext: string) => Promise<string>,
): Promise<Installation> {
  requireRole(staff, ["admin", "sales", "operations"]);

  const profile = await repository.installation(id, staff.id);
  if (!profile) {
    throw new DomainError(
      "profile_not_ready",
      409,
      "eSIM belum tersedia. Periksa status fulfillment.",
    );
  }

  return {
    activationCode: await decrypt(profile.ciphertext),
    activationRule: "first_network_connection",
    iccid: profile.iccid,
    mode: "mock",
    orderNumber: profile.orderNumber,
  };
}

export async function retryProvisioning(
  repository: SalesRepository,
  staff: Staff,
  id: string,
) {
  requireRole(staff, ["admin", "operations"]);
  if (!(await repository.retryProvisioning(id, staff.id))) {
    throw new DomainError(
      "retry_not_allowed",
      409,
      "Hanya kegagalan yang dipastikan belum mengeluarkan eSIM yang boleh diulang.",
    );
  }
}
