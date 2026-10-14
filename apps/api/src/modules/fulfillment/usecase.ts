import type { AutomationEvent } from "@esim-erp/contracts";
import type { Supplier } from "../catalog/usecase";
import { DomainError } from "../errors";

export type ProvisioningJob = {
  id: string;
  leaseToken: string;
  orderId: string;
  providerSku: string;
  supplierCostIdr: number;
  scenario: "success" | "fail_once";
  attempt: number;
};

export type FulfillmentRepository = {
  claim: () => Promise<ProvisioningJob | undefined>;
  complete: (
    job: ProvisioningJob,
    profile: { providerOrderId: string; iccid: string; ciphertext: string },
  ) => Promise<void>;
  fail: (
    job: ProvisioningJob,
    reason: string,
    isAmbiguous: boolean,
  ) => Promise<void>;
  events: () => Promise<AutomationEvent[]>;
  acknowledge: (eventId: string) => Promise<boolean>;
};

export async function processProvisioningJobs(
  repository: FulfillmentRepository,
  supplier: Supplier,
  encrypt: (plaintext: string) => Promise<string>,
) {
  let processed = 0;
  for (let index = 0; index < 10; index++) {
    const job = await repository.claim();
    if (!job) break;

    try {
      const profile = await supplier.provision({
        attempt: job.attempt,
        orderId: job.orderId,
        providerSku: job.providerSku,
        scenario: job.scenario,
      });
      await repository.complete(job, {
        ciphertext: await encrypt(profile.activationCode),
        iccid: profile.iccid,
        providerOrderId: profile.providerOrderId,
      });
    } catch (error) {
      const isKnownFailure =
        error instanceof DomainError &&
        ["supplier_rejected", "insufficient_supplier_balance"].includes(
          error.code,
        );
      await repository.fail(
        job,
        isKnownFailure
          ? error.message
          : "Hasil provisioning belum pasti. Rekonsiliasi supplier diperlukan.",
        !isKnownFailure,
      );
    }

    processed++;
  }

  return processed;
}
