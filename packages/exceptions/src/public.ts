import { sanitizeAuditMetadata } from "@hookx/audit";
import type { Instant, PaymentId, ProviderId } from "@hookx/domain";
import type { ExceptionCode } from "./codes.js";
import type { ExceptionRecord, ExceptionMetadata } from "./exception.js";
import type { ExceptionSeverity } from "./severity.js";
import type { ExceptionStatus } from "./status.js";

/**
 * HTTP/operator view of a stored exception. Classification fields are copied
 * from the deterministic record; they are not inferred by a client.
 */
export type PublicException = {
  readonly exceptionId: string;
  readonly exceptionCode: ExceptionCode;
  readonly severity: ExceptionSeverity;
  readonly paymentId: PaymentId | null;
  readonly webhookEventId: string | null;
  readonly provider: ProviderId | null;
  readonly status: ExceptionStatus;
  readonly reason: string;
  readonly detectedAt: Instant;
  readonly correlationId: string;
  readonly metadata: ExceptionMetadata;
};

export function toPublicException(record: ExceptionRecord): PublicException {
  return {
    exceptionId: record.exceptionId,
    exceptionCode: record.exceptionCode,
    severity: record.severity,
    paymentId: record.paymentId,
    webhookEventId: record.webhookEventId,
    provider: record.provider,
    status: record.status,
    reason: record.reason,
    detectedAt: record.detectedAt,
    correlationId: record.correlationId,
    metadata: sanitizeAuditMetadata(record.metadata),
  };
}
