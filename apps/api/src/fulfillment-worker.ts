import { encryptProfile } from "./infrastructure/crypto";
import type { Database } from "./infrastructure/database";
import { createFulfillmentRepository } from "./infrastructure/fulfillment-repository";
import { createMockSupplier } from "./infrastructure/supplier";
import { processProvisioningJobs } from "./modules/fulfillment/usecase";

export function runFulfillment(database: Database, encryptionKey: string) {
  return processProvisioningJobs(
    createFulfillmentRepository(database),
    createMockSupplier(),
    (plaintext) => encryptProfile(plaintext, encryptionKey),
  );
}
