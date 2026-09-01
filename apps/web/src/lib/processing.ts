export type PublicWebhookProcessing = {
  readonly verification: "PASSED";
  readonly normalization: "NORMALIZED";
  readonly idempotency: "STORED" | "DUPLICATE" | "CONFLICT" | "UNKNOWN";
  readonly decision: string;
};

export function processingFromAudit(
  processingStatus: string,
  audit: readonly { readonly eventType: string }[],
): PublicWebhookProcessing {
  let idempotency: PublicWebhookProcessing["idempotency"] = "UNKNOWN";
  let delayed = false;
  for (const row of audit) {
    if (row.eventType === "WEBHOOK_RECEIVED" && idempotency === "UNKNOWN") {
      idempotency = "STORED";
    }
    if (row.eventType === "WEBHOOK_DUPLICATE") {
      idempotency = "DUPLICATE";
    }
    if (row.eventType === "WEBHOOK_CONFLICT") {
      idempotency = "CONFLICT";
    }
    if (row.eventType === "WEBHOOK_DELAYED") {
      delayed = true;
    }
  }
  return {
    verification: "PASSED",
    normalization: "NORMALIZED",
    idempotency,
    decision: delayed ? "DELAYED" : processingStatus,
  };
}
