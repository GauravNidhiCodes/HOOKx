export const WEBHOOK_PROCESSING_STATUSES = [
  "RECEIVED",
  "PROCESSING",
  "PROCESSED",
  "REJECTED",
  "CONFLICT",
] as const;

export type WebhookProcessingStatus =
  (typeof WEBHOOK_PROCESSING_STATUSES)[number];

export function isWebhookProcessingStatus(
  value: string,
): value is WebhookProcessingStatus {
  return (WEBHOOK_PROCESSING_STATUSES as readonly string[]).includes(value);
}

const MARK_PROCESSING_FROM: ReadonlySet<WebhookProcessingStatus> = new Set([
  "RECEIVED",
]);
const MARK_PROCESSED_FROM: ReadonlySet<WebhookProcessingStatus> = new Set([
  "PROCESSING",
]);
const MARK_REJECTED_FROM: ReadonlySet<WebhookProcessingStatus> = new Set([
  "PROCESSING",
]);
const MARK_CONFLICT_FROM: ReadonlySet<WebhookProcessingStatus> = new Set([
  "RECEIVED",
  "PROCESSING",
  "REJECTED",
  "CONFLICT",
]);

export function canMarkProcessing(status: WebhookProcessingStatus): boolean {
  return MARK_PROCESSING_FROM.has(status);
}

export function canMarkProcessed(status: WebhookProcessingStatus): boolean {
  return MARK_PROCESSED_FROM.has(status);
}

export function canMarkRejected(status: WebhookProcessingStatus): boolean {
  return MARK_REJECTED_FROM.has(status);
}

export function canMarkConflict(status: WebhookProcessingStatus): boolean {
  return MARK_CONFLICT_FROM.has(status);
}
