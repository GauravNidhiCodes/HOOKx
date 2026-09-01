import type { Instant } from "@hookx/domain";
import type { DeadLetterRecord, RetryRecord } from "./types.js";

export type ScheduleRetryInput = {
  readonly nextAttemptAt: Instant;
  readonly errorCode: string;
  readonly failedAt: Instant;
  readonly now: Instant;
};

export type DeadLetterInput = {
  readonly errorCode: string;
  readonly now: Instant;
};

export interface RetryRepository {
  ensurePending(webhookEventId: string, now: Instant): Promise<RetryRecord>;
  getByWebhookEventId(webhookEventId: string): Promise<RetryRecord | null>;
  getById(id: string): Promise<RetryRecord | null>;
  listActive(): Promise<readonly RetryRecord[]>;
  count(): Promise<number>;
  countDeadLetters(): Promise<number>;
  listDeadLetters(): Promise<readonly DeadLetterRecord[]>;
  getDeadLetterByWebhookEventId(
    webhookEventId: string,
  ): Promise<DeadLetterRecord | null>;
  claimDue(
    now: Instant,
    limit: number,
    leaseMs: number,
  ): Promise<readonly RetryRecord[]>;
  beginAttempt(
    id: string,
    now: Instant,
    leaseMs: number,
  ): Promise<RetryRecord | null>;
  markSucceeded(id: string, now: Instant): Promise<RetryRecord>;
  scheduleRetry(id: string, input: ScheduleRetryInput): Promise<RetryRecord>;
  deadLetter(id: string, input: DeadLetterInput): Promise<DeadLetterRecord>;
}
