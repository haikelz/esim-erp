import type { Order } from "@esim-erp/contracts";

type ProgressRecord = Pick<
  Order,
  "paymentStatus" | "fulfillmentStatus" | "reconciliationRequired"
>;

export function recordPollingInterval(
  record: ProgressRecord | undefined,
): number | false {
  if (!record || record.reconciliationRequired) return false;
  if (record.paymentStatus === "pending") return 10000;
  if (
    record.paymentStatus === "paid" &&
    (record.fulfillmentStatus === "queued" ||
      record.fulfillmentStatus === "processing")
  )
    return 5000;

  return false;
}
