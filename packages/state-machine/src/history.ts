import type {
  Instant,
  IsoCurrencyCode,
  PayloadHash,
  PaymentId,
} from "@hookx/domain";
import {
  eventIdentityKey,
  type NormalizedWebhookEvent,
  type WebhookEventType,
  type WebhookIdentityKey,
} from "@hookx/webhook";

export interface EventMaterial {
  readonly paymentId: PaymentId;
  readonly eventType: WebhookEventType;
  readonly occurredAt: Instant;
  readonly amountMinor: bigint;
  readonly currency: IsoCurrencyCode;
  readonly payloadHash: PayloadHash;
}

export interface ProcessedEventRecord extends EventMaterial {
  readonly identityKey: WebhookIdentityKey;
}

export type ProcessingHistory = readonly ProcessedEventRecord[];

export function eventMaterial(source: EventMaterial): EventMaterial {
  return Object.freeze({
    paymentId: source.paymentId,
    eventType: source.eventType,
    occurredAt: source.occurredAt,
    amountMinor: source.amountMinor,
    currency: source.currency,
    payloadHash: source.payloadHash,
  });
}

export function recordProcessedEvent(
  event: NormalizedWebhookEvent,
): ProcessedEventRecord {
  return Object.freeze({
    identityKey: eventIdentityKey(event),
    ...eventMaterial(event),
  });
}

export function withProcessedEvent(
  history: ProcessingHistory,
  event: NormalizedWebhookEvent,
): ProcessingHistory {
  return Object.freeze([...history, recordProcessedEvent(event)]);
}

export function findProcessedEvent(
  history: ProcessingHistory,
  identityKey: WebhookIdentityKey,
): ProcessedEventRecord | null {
  return history.find((record) => record.identityKey === identityKey) ?? null;
}

export function materialFingerprint(material: EventMaterial): string {
  return JSON.stringify({
    paymentId: material.paymentId,
    eventType: material.eventType,
    occurredAt: material.occurredAt,
    amountMinor: material.amountMinor.toString(),
    currency: material.currency,
    payloadHash: material.payloadHash,
  });
}

export function eventsMateriallyEqual(
  left: EventMaterial,
  right: EventMaterial,
): boolean {
  return materialFingerprint(left) === materialFingerprint(right);
}
