import {
  createAuditEvent,
  isAuditActor,
  isAuditEventType,
  sanitizeAuditMetadata,
  type AuditEvent,
} from "@hookx/audit";
import {
  isPaymentState,
  paymentId,
  providerId,
  type PaymentState,
} from "@hookx/domain";
import { StorageError } from "../errors.js";
import { instantFromDate } from "../mapping.js";

export type AuditPersistenceRow = {
  readonly id: string;
  readonly eventType: string;
  readonly occurredAt: Date;
  readonly recordedAt: Date;
  readonly provider: string | null;
  readonly paymentId: string | null;
  readonly webhookEventId: string | null;
  readonly previousState: string | null;
  readonly resultingState: string | null;
  readonly actor: string;
  readonly reason: string;
  readonly correlationId: string;
  readonly metadata: unknown;
};

function optionalPaymentState(value: string | null): PaymentState | null {
  if (value === null) {
    return null;
  }
  if (!isPaymentState(value)) {
    throw new StorageError("INVALID_ROW", "Stored audit payment state is invalid");
  }
  return value;
}

export function toAuditEvent(row: AuditPersistenceRow): AuditEvent {
  if (!isAuditEventType(row.eventType) || !isAuditActor(row.actor)) {
    throw new StorageError("INVALID_ROW", "Stored audit event type or actor is invalid");
  }
  const metadata =
    row.metadata !== null &&
    typeof row.metadata === "object" &&
    !Array.isArray(row.metadata)
      ? sanitizeAuditMetadata(row.metadata as Record<string, unknown>)
      : sanitizeAuditMetadata(undefined);
  return createAuditEvent({
    auditEventId: row.id,
    eventType: row.eventType,
    occurredAt: instantFromDate(row.occurredAt),
    recordedAt: instantFromDate(row.recordedAt),
    provider: row.provider === null ? null : providerId(row.provider),
    paymentId: row.paymentId === null ? null : paymentId(row.paymentId),
    webhookEventId: row.webhookEventId,
    previousState: optionalPaymentState(row.previousState),
    resultingState: optionalPaymentState(row.resultingState),
    actor: row.actor,
    reason: row.reason,
    correlationId: row.correlationId,
    metadata,
  });
}
