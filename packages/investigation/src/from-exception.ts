import type { ExceptionRecord } from "@hookx/exceptions";
import { sanitizeAuditMetadata } from "@hookx/audit";
import type { InvestigationExceptionView } from "./context.js";

export function exceptionViewFromRecord(
  record: ExceptionRecord,
): InvestigationExceptionView {
  return Object.freeze({
    exceptionId: record.exceptionId,
    exceptionCode: record.exceptionCode,
    severity: record.severity,
    status: record.status,
    reason: record.reason,
    paymentId: record.paymentId,
    webhookEventId: record.webhookEventId,
    provider: record.provider,
    detectedAt: record.detectedAt,
    correlationId: record.correlationId,
    metadata: sanitizeAuditMetadata(record.metadata),
  });
}
