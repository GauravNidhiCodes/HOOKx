import {
  createException,
  isExceptionCode,
  isExceptionSeverity,
  isExceptionStatus,
  type ExceptionRecord,
} from "@hookx/exceptions";
import { paymentId, providerId } from "@hookx/domain";
import { StorageError } from "../errors.js";
import { instantFromDate } from "../mapping.js";

export type ExceptionPersistenceRow = {
  readonly id: string;
  readonly exceptionCode: string;
  readonly severity: string;
  readonly status: string;
  readonly provider: string | null;
  readonly paymentId: string | null;
  readonly webhookEventId: string | null;
  readonly reason: string;
  readonly detectedAt: Date;
  readonly correlationId: string;
  readonly metadata: unknown;
  readonly identityKey: string;
};

export function toExceptionRecord(row: ExceptionPersistenceRow): ExceptionRecord {
  if (
    !isExceptionCode(row.exceptionCode) ||
    !isExceptionSeverity(row.severity) ||
    !isExceptionStatus(row.status)
  ) {
    throw new StorageError("INVALID_ROW", "Stored exception row is invalid");
  }
  const metadata =
    row.metadata !== null &&
    typeof row.metadata === "object" &&
    !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : undefined;
  return createException({
    exceptionId: row.id,
    exceptionCode: row.exceptionCode,
    severity: row.severity,
    status: row.status,
    provider: row.provider === null ? null : providerId(row.provider),
    paymentId: row.paymentId === null ? null : paymentId(row.paymentId),
    webhookEventId: row.webhookEventId,
    reason: row.reason,
    detectedAt: instantFromDate(row.detectedAt),
    correlationId: row.correlationId,
    metadata,
    identity: row.identityKey,
  });
}
