import type { Instant } from "@hookx/domain";
import { StorageError } from "../errors.js";
import { dateFromInstant, instantFromDate } from "../mapping.js";
import { isRetryStatus } from "./status.js";
import type { DeadLetterRecord, RetryRecord } from "./types.js";

export type RetryPersistenceRow = {
  readonly id: string;
  readonly webhookEventId: string;
  readonly attemptCount: number;
  readonly status: string;
  readonly nextAttemptAt: Date | null;
  readonly leaseExpiresAt: Date | null;
  readonly lastErrorCode: string | null;
  readonly lastFailedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type DeadLetterPersistenceRow = {
  readonly id: string;
  readonly webhookEventId: string;
  readonly retryId: string;
  readonly failureCode: string;
  readonly attemptCount: number;
  readonly deadLetteredAt: Date;
};

export function toRetryRecord(row: RetryPersistenceRow): RetryRecord {
  if (!isRetryStatus(row.status)) {
    throw new StorageError("INVALID_ROW", "Stored retry status is invalid");
  }
  if (!Number.isInteger(row.attemptCount) || row.attemptCount < 0) {
    throw new StorageError("INVALID_ROW", "Stored retry attempt count is invalid");
  }
  return Object.freeze({
    id: row.id,
    webhookEventId: row.webhookEventId,
    attemptCount: row.attemptCount,
    status: row.status,
    nextAttemptAt:
      row.nextAttemptAt === null ? null : instantFromDate(row.nextAttemptAt),
    leaseExpiresAt:
      row.leaseExpiresAt === null ? null : instantFromDate(row.leaseExpiresAt),
    lastErrorCode: row.lastErrorCode,
    lastFailedAt:
      row.lastFailedAt === null ? null : instantFromDate(row.lastFailedAt),
    createdAt: instantFromDate(row.createdAt),
    updatedAt: instantFromDate(row.updatedAt),
  });
}

export function toDeadLetterRecord(
  row: DeadLetterPersistenceRow,
): DeadLetterRecord {
  if (!Number.isInteger(row.attemptCount) || row.attemptCount < 0) {
    throw new StorageError(
      "INVALID_ROW",
      "Stored dead-letter attempt count is invalid",
    );
  }
  return Object.freeze({
    id: row.id,
    webhookEventId: row.webhookEventId,
    retryId: row.retryId,
    failureCode: row.failureCode,
    attemptCount: row.attemptCount,
    deadLetteredAt: instantFromDate(row.deadLetteredAt),
  });
}

export function dateOrNull(value: Instant | null): Date | null {
  return value === null ? null : dateFromInstant(value);
}
