import { instant, type Instant } from "@hookx/domain";
import {
  createNormalizedWebhookEvent,
  type NormalizedWebhookEvent,
} from "@hookx/webhook";
import { StorageError } from "./errors.js";
import {
  isWebhookProcessingStatus,
  type WebhookProcessingStatus,
} from "./status.js";
import type { StoredWebhookEvent } from "./types.js";

export type WebhookEventPersistenceRow = {
  readonly id: string;
  readonly provider: string;
  readonly externalEventId: string;
  readonly paymentId: string;
  readonly eventType: string;
  readonly occurredAt: Date;
  readonly receivedAt: Date;
  readonly amountMinorUnits: bigint | string;
  readonly currency: string;
  readonly payloadHash: string;
  readonly processingStatus: string;
  readonly createdAt: Date;
};

export function bigintFromDatabase(value: unknown): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) {
    return BigInt(value);
  }
  throw new StorageError(
    "INVALID_ROW",
    "Stored amount_minor_units is not an integer bigint",
  );
}

export function dateFromInstant(value: Instant): Date {
  return new Date(value);
}

export function instantFromDate(value: Date): Instant {
  return instant(value.toISOString());
}

export function toStoredWebhookEvent(
  row: WebhookEventPersistenceRow,
): StoredWebhookEvent {
  const amountMinor = bigintFromDatabase(row.amountMinorUnits);
  if (!isWebhookProcessingStatus(row.processingStatus)) {
    throw new StorageError("INVALID_ROW", "Stored processing status is invalid");
  }

  const event: NormalizedWebhookEvent = createNormalizedWebhookEvent({
    provider: row.provider,
    externalEventId: row.externalEventId,
    paymentId: row.paymentId,
    eventType: row.eventType,
    occurredAt: instantFromDate(row.occurredAt),
    receivedAt: instantFromDate(row.receivedAt),
    amountMinor,
    currency: row.currency,
    payloadHash: row.payloadHash,
  });

  return Object.freeze({
    id: row.id,
    event,
    processingStatus: row.processingStatus,
    createdAt: instantFromDate(row.createdAt),
  });
}

export function toInsertValues(
  event: NormalizedWebhookEvent,
  status: WebhookProcessingStatus,
): {
  provider: string;
  externalEventId: string;
  paymentId: string;
  eventType: string;
  occurredAt: Date;
  receivedAt: Date;
  amountMinorUnits: bigint;
  currency: string;
  payloadHash: string;
  processingStatus: string;
} {
  return {
    provider: event.provider,
    externalEventId: event.externalEventId,
    paymentId: event.paymentId,
    eventType: event.eventType,
    occurredAt: dateFromInstant(event.occurredAt),
    receivedAt: dateFromInstant(event.receivedAt),
    amountMinorUnits: event.amountMinor,
    currency: event.currency,
    payloadHash: event.payloadHash,
    processingStatus: status,
  };
}
