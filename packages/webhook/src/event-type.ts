export const WEBHOOK_EVENT_TYPES = [
  "payment.created",
  "payment.authorized",
  "payment.captured",
  "payment.failed",
  "refund.created",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export function isWebhookEventType(value: string): value is WebhookEventType {
  return (WEBHOOK_EVENT_TYPES as readonly string[]).includes(value);
}
