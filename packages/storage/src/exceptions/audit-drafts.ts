import type { AuditActor, AuditEventType } from "@hookx/audit";
import type { Instant } from "@hookx/domain";
import type { ExceptionCode, ExceptionRecord } from "@hookx/exceptions";
import type { AuditAppendInput } from "../audit/repository.js";

export function auditEventTypeForException(
  code: ExceptionCode,
): Extract<
  AuditEventType,
  | "EXCEPTION_DETECTED"
  | "WEBHOOK_CONFLICT_DETECTED"
  | "INVALID_TRANSITION_DETECTED"
  | "RETRY_EXHAUSTED"
> {
  if (code === "CONFLICTING_EVENT") {
    return "WEBHOOK_CONFLICT_DETECTED";
  }
  if (code === "INVALID_STATE_TRANSITION") {
    return "INVALID_TRANSITION_DETECTED";
  }
  if (code === "RETRY_EXHAUSTED") {
    return "RETRY_EXHAUSTED";
  }
  return "EXCEPTION_DETECTED";
}

export function exceptionDetectedDraft(
  record: ExceptionRecord,
  actor: AuditActor,
): AuditAppendInput {
  return {
    eventType: auditEventTypeForException(record.exceptionCode),
    occurredAt: record.detectedAt,
    recordedAt: record.detectedAt,
    provider: record.provider,
    paymentId: record.paymentId,
    webhookEventId: record.webhookEventId,
    previousState: null,
    resultingState: null,
    actor,
    reason: record.exceptionCode,
    correlationId: record.correlationId,
    metadata: {
      exceptionId: record.exceptionId,
      exceptionCode: record.exceptionCode,
      severity: record.severity,
    },
  };
}

export function exceptionStatusChangedDraft(
  record: ExceptionRecord,
  actor: AuditActor,
  recordedAt: Instant,
): AuditAppendInput {
  return {
    eventType: "EXCEPTION_STATUS_CHANGED",
    occurredAt: record.detectedAt,
    recordedAt,
    provider: record.provider,
    paymentId: record.paymentId,
    webhookEventId: record.webhookEventId,
    previousState: null,
    resultingState: null,
    actor,
    reason: record.status,
    correlationId: record.correlationId,
    metadata: {
      exceptionId: record.exceptionId,
      exceptionCode: record.exceptionCode,
      status: record.status,
    },
  };
}
