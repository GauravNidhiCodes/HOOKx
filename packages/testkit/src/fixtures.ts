import {
  createNormalizedWebhookEvent,
  type NormalizedWebhookEvent,
  type NormalizedWebhookEventInput,
  type WebhookEventType,
} from "@hookx/webhook";
import {
  SYNTHETIC,
  SYNTHETIC_AMOUNT_MINOR,
  SYNTHETIC_CURRENCY,
  SYNTHETIC_PAYMENT_ID,
  SYNTHETIC_PROVIDER,
} from "./marker.js";

export type SyntheticEventOverride = Partial<
  Omit<NormalizedWebhookEventInput, "eventType">
>;

function syntheticEvent(
  eventType: WebhookEventType,
  suffix: string,
  overrides: SyntheticEventOverride = {},
): NormalizedWebhookEvent {
  return createNormalizedWebhookEvent({
    provider: SYNTHETIC_PROVIDER,
    externalEventId: `${SYNTHETIC}:evt:${suffix}`,
    paymentId: SYNTHETIC_PAYMENT_ID,
    eventType,
    occurredAt: "2026-01-15T10:00:00.000Z",
    receivedAt: "2026-01-15T10:00:01.000Z",
    amountMinor: SYNTHETIC_AMOUNT_MINOR,
    currency: SYNTHETIC_CURRENCY,
    payloadHash: `${SYNTHETIC}:hash:${suffix}`,
    ...overrides,
  });
}

export function syntheticPaymentCreated(
  overrides: SyntheticEventOverride = {},
): NormalizedWebhookEvent {
  return syntheticEvent("payment.created", "payment.created", overrides);
}

export function syntheticPaymentAuthorized(
  overrides: SyntheticEventOverride = {},
): NormalizedWebhookEvent {
  return syntheticEvent("payment.authorized", "payment.authorized", overrides);
}

export function syntheticPaymentCaptured(
  overrides: SyntheticEventOverride = {},
): NormalizedWebhookEvent {
  return syntheticEvent("payment.captured", "payment.captured", overrides);
}

export function syntheticPaymentFailed(
  overrides: SyntheticEventOverride = {},
): NormalizedWebhookEvent {
  return syntheticEvent("payment.failed", "payment.failed", overrides);
}

export function syntheticRefundCreated(
  overrides: SyntheticEventOverride = {},
): NormalizedWebhookEvent {
  return syntheticEvent("refund.created", "refund.created", overrides);
}

export const SYNTHETIC_FIXTURES = {
  "payment.created": syntheticPaymentCreated,
  "payment.authorized": syntheticPaymentAuthorized,
  "payment.captured": syntheticPaymentCaptured,
  "payment.failed": syntheticPaymentFailed,
  "refund.created": syntheticRefundCreated,
} as const;
