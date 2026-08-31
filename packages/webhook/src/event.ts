import {
  DomainError,
  externalEventId,
  instant,
  isoCurrencyCode,
  payloadHash,
  paymentId,
  providerId,
  type ExternalEventId,
  type Instant,
  type IsoCurrencyCode,
  type PayloadHash,
  type PaymentId,
  type ProviderId,
} from "@hookx/domain";
import { isWebhookEventType, type WebhookEventType } from "./event-type.js";
import { webhookIdentityKey, type WebhookIdentityKey } from "./identity.js";

export interface NormalizedWebhookEvent {
  readonly provider: ProviderId;
  readonly externalEventId: ExternalEventId;
  readonly paymentId: PaymentId;
  readonly eventType: WebhookEventType;
  readonly occurredAt: Instant;
  readonly receivedAt: Instant;
  readonly amountMinor: bigint;
  readonly currency: IsoCurrencyCode;
  readonly payloadHash: PayloadHash;
}

export interface NormalizedWebhookEventInput {
  readonly provider: string;
  readonly externalEventId: string;
  readonly paymentId: string;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly receivedAt: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly payloadHash: string;
}

const NORMALIZED_KEYS = [
  "provider",
  "externalEventId",
  "paymentId",
  "eventType",
  "occurredAt",
  "receivedAt",
  "amountMinor",
  "currency",
  "payloadHash",
] as const;

export function createNormalizedWebhookEvent(
  input: NormalizedWebhookEventInput,
): NormalizedWebhookEvent {
  if (typeof input.amountMinor !== "bigint") {
    throw new DomainError(
      "MONEY_AMOUNT_NOT_BIGINT",
      "amountMinor must be a bigint minor-unit value",
    );
  }
  if (input.amountMinor < 0n) {
    throw new DomainError(
      "MONEY_AMOUNT_NEGATIVE",
      "amountMinor must be greater than or equal to 0",
    );
  }
  if (!isWebhookEventType(input.eventType)) {
    throw new DomainError(
      "UNKNOWN_EVENT_TYPE",
      `unsupported webhook event type: ${input.eventType}`,
    );
  }

  return Object.freeze({
    provider: providerId(input.provider),
    externalEventId: externalEventId(input.externalEventId),
    paymentId: paymentId(input.paymentId),
    eventType: input.eventType,
    occurredAt: instant(input.occurredAt),
    receivedAt: instant(input.receivedAt),
    amountMinor: input.amountMinor,
    currency: isoCurrencyCode(input.currency),
    payloadHash: payloadHash(input.payloadHash),
  });
}

export function eventIdentityKey(
  event: NormalizedWebhookEvent,
): WebhookIdentityKey {
  return webhookIdentityKey(event.provider, event.externalEventId);
}

export function normalizedEventKeys(): readonly string[] {
  return NORMALIZED_KEYS;
}
