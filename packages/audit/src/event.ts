import {
  DomainError,
  instant,
  isPaymentState,
  paymentId,
  providerId,
  type Instant,
  type PaymentId,
  type PaymentState,
  type ProviderId,
} from "@hookx/domain";
import { isAuditActor, type AuditActor } from "./actor.js";
import { isAuditEventType, type AuditEventType } from "./event-type.js";
import {
  sanitizeAuditMetadata,
  type AuditMetadata,
} from "./metadata.js";
import { auditReasonCode } from "./reason.js";

export type NewAuditEvent = {
  readonly auditEventId?: string;
  readonly eventType: AuditEventType;
  readonly occurredAt: Instant;
  readonly recordedAt: Instant;
  readonly provider: ProviderId | null;
  readonly paymentId: PaymentId | null;
  readonly webhookEventId: string | null;
  readonly previousState: PaymentState | null;
  readonly resultingState: PaymentState | null;
  readonly actor: AuditActor;
  readonly reason: string;
  readonly correlationId: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
};

export type AuditEvent = {
  readonly auditEventId: string;
  readonly eventType: AuditEventType;
  readonly occurredAt: Instant;
  readonly recordedAt: Instant;
  readonly provider: ProviderId | null;
  readonly paymentId: PaymentId | null;
  readonly webhookEventId: string | null;
  readonly previousState: PaymentState | null;
  readonly resultingState: PaymentState | null;
  readonly actor: AuditActor;
  readonly reason: string;
  readonly correlationId: string;
  readonly metadata: AuditMetadata;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CORRELATION = /^[A-Za-z0-9._:~-]+$/;

function assertCorrelationId(value: string): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new DomainError(
      "INVALID_IDENTITY",
      "correlationId must be a non-empty trimmed identifier",
    );
  }
  if (!CORRELATION.test(value)) {
    throw new DomainError(
      "INVALID_IDENTITY",
      "correlationId may contain only A-Z, a-z, 0-9, and . _ : ~ -",
    );
  }
  return value;
}

function assertOptionalUuid(value: string | null, label: string): string | null {
  if (value === null) {
    return null;
  }
  if (!UUID.test(value)) {
    throw new DomainError("INVALID_IDENTITY", `${label} must be a UUID`);
  }
  return value;
}

function assertOptionalState(
  value: PaymentState | null,
  label: string,
): PaymentState | null {
  if (value === null) {
    return null;
  }
  if (!isPaymentState(value)) {
    throw new DomainError("INVALID_PAYMENT_STATE", `${label} is not a payment state`);
  }
  return value;
}

export function createAuditEvent(input: NewAuditEvent): AuditEvent {
  if (!isAuditEventType(input.eventType)) {
    throw new DomainError("INVALID_AUDIT_EVENT", "Unknown audit event type");
  }
  if (!isAuditActor(input.actor)) {
    throw new DomainError("INVALID_AUDIT_EVENT", "Unknown audit actor");
  }
  const auditEventId = input.auditEventId;
  if (auditEventId === undefined || !UUID.test(auditEventId)) {
    throw new DomainError(
      "INVALID_IDENTITY",
      "auditEventId must be a UUID assigned at the persistence boundary",
    );
  }
  const occurredAt = instant(input.occurredAt);
  const recordedAt = instant(input.recordedAt);
  const webhookEventId = assertOptionalUuid(
    input.webhookEventId,
    "webhookEventId",
  );
  return Object.freeze({
    auditEventId,
    eventType: input.eventType,
    occurredAt,
    recordedAt,
    provider: input.provider === null ? null : providerId(input.provider),
    paymentId: input.paymentId === null ? null : paymentId(input.paymentId),
    webhookEventId,
    previousState: assertOptionalState(input.previousState, "previousState"),
    resultingState: assertOptionalState(input.resultingState, "resultingState"),
    actor: input.actor,
    reason: auditReasonCode(input.reason),
    correlationId: assertCorrelationId(input.correlationId),
    metadata: sanitizeAuditMetadata(input.metadata),
  });
}

export function draftAuditEvent(
  input: Omit<NewAuditEvent, "auditEventId">,
): Omit<AuditEvent, "auditEventId"> {
  const created = createAuditEvent({
    ...input,
    auditEventId: "00000000-0000-4000-8000-000000000000",
  });
  const { auditEventId: _id, ...draft } = created;
  return Object.freeze(draft);
}
