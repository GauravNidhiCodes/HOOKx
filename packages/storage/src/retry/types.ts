import type { Instant } from "@hookx/domain";
import type { RetryStatus } from "./status.js";

export type RetryRecord = {
  readonly id: string;
  readonly webhookEventId: string;
  readonly attemptCount: number;
  readonly status: RetryStatus;
  readonly nextAttemptAt: Instant | null;
  readonly leaseExpiresAt: Instant | null;
  readonly lastErrorCode: string | null;
  readonly lastFailedAt: Instant | null;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
};

export type DeadLetterRecord = {
  readonly id: string;
  readonly webhookEventId: string;
  readonly retryId: string;
  readonly failureCode: string;
  readonly attemptCount: number;
  readonly deadLetteredAt: Instant;
};
