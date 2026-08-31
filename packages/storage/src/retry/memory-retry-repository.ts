import { randomUUID } from "node:crypto";
import type { Instant } from "@hookx/domain";
import { addMilliseconds } from "./time.js";
import type {
  DeadLetterInput,
  RetryRepository,
  ScheduleRetryInput,
} from "./repository.js";
import type { DeadLetterRecord, RetryRecord } from "./types.js";

function compareInstant(left: Instant, right: Instant): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export class MemoryRetryRepository implements RetryRepository {
  public readonly records: RetryRecord[] = [];
  public readonly deadLetters: DeadLetterRecord[] = [];

  public async ensurePending(
    webhookEventId: string,
    now: Instant,
  ): Promise<RetryRecord> {
    const existing = this.records.find(
      (row) => row.webhookEventId === webhookEventId,
    );
    if (existing !== undefined) {
      return existing;
    }
    const created: RetryRecord = Object.freeze({
      id: randomUUID(),
      webhookEventId,
      attemptCount: 0,
      status: "PENDING",
      nextAttemptAt: now,
      leaseExpiresAt: null,
      lastErrorCode: null,
      lastFailedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    this.records.push(created);
    return created;
  }

  public async getByWebhookEventId(
    webhookEventId: string,
  ): Promise<RetryRecord | null> {
    return (
      this.records.find((row) => row.webhookEventId === webhookEventId) ?? null
    );
  }

  public async getById(id: string): Promise<RetryRecord | null> {
    return this.records.find((row) => row.id === id) ?? null;
  }

  public async listActive(): Promise<readonly RetryRecord[]> {
    return this.records.filter((row) =>
      ["PENDING", "PROCESSING", "RETRY_SCHEDULED"].includes(row.status),
    );
  }

  public async listDeadLetters(): Promise<readonly DeadLetterRecord[]> {
    return [...this.deadLetters];
  }

  public async getDeadLetterByWebhookEventId(
    webhookEventId: string,
  ): Promise<DeadLetterRecord | null> {
    return (
      this.deadLetters.find((row) => row.webhookEventId === webhookEventId) ??
      null
    );
  }

  public async claimDue(
    now: Instant,
    limit: number,
    leaseMs: number,
  ): Promise<readonly RetryRecord[]> {
    const due = this.records
      .filter((row) => isDue(row, now))
      .sort((left, right) => {
        const byTime = compareInstant(
          left.nextAttemptAt ?? left.createdAt,
          right.nextAttemptAt ?? right.createdAt,
        );
        if (byTime !== 0) {
          return byTime;
        }
        return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
      })
      .slice(0, limit);

    const claimed: RetryRecord[] = [];
    for (const row of due) {
      const started = await this.beginAttempt(row.id, now, leaseMs);
      if (started !== null) {
        claimed.push(started);
      }
    }
    return claimed;
  }

  public async beginAttempt(
    id: string,
    now: Instant,
    leaseMs: number,
  ): Promise<RetryRecord | null> {
    const index = this.records.findIndex((row) => row.id === id);
    const current = index === -1 ? undefined : this.records[index];
    if (current === undefined || !isDue(current, now)) {
      return null;
    }
    const next: RetryRecord = Object.freeze({
      ...current,
      status: "PROCESSING",
      attemptCount: current.attemptCount + 1,
      leaseExpiresAt: addMilliseconds(now, leaseMs),
      updatedAt: now,
    });
    this.records[index] = next;
    return next;
  }

  public async markSucceeded(id: string, now: Instant): Promise<RetryRecord> {
    return this.replace(id, (current) =>
      Object.freeze({
        ...current,
        status: "SUCCEEDED",
        nextAttemptAt: null,
        leaseExpiresAt: null,
        updatedAt: now,
      }),
    );
  }

  public async scheduleRetry(
    id: string,
    input: ScheduleRetryInput,
  ): Promise<RetryRecord> {
    return this.replace(id, (current) =>
      Object.freeze({
        ...current,
        status: "RETRY_SCHEDULED",
        nextAttemptAt: input.nextAttemptAt,
        leaseExpiresAt: null,
        lastErrorCode: input.errorCode,
        lastFailedAt: input.failedAt,
        updatedAt: input.now,
      }),
    );
  }

  public async deadLetter(
    id: string,
    input: DeadLetterInput,
  ): Promise<DeadLetterRecord> {
    const retry = await this.replace(id, (current) =>
      Object.freeze({
        ...current,
        status: "DEAD_LETTERED",
        nextAttemptAt: null,
        leaseExpiresAt: null,
        lastErrorCode: input.errorCode,
        lastFailedAt: input.now,
        updatedAt: input.now,
      }),
    );
    const existing = this.deadLetters.find(
      (row) => row.webhookEventId === retry.webhookEventId,
    );
    if (existing !== undefined) {
      return existing;
    }
    const created: DeadLetterRecord = Object.freeze({
      id: randomUUID(),
      webhookEventId: retry.webhookEventId,
      retryId: retry.id,
      failureCode: input.errorCode,
      attemptCount: retry.attemptCount,
      deadLetteredAt: input.now,
    });
    this.deadLetters.push(created);
    return created;
  }

  private async replace(
    id: string,
    update: (current: RetryRecord) => RetryRecord,
  ): Promise<RetryRecord> {
    const index = this.records.findIndex((row) => row.id === id);
    const current = index === -1 ? undefined : this.records[index];
    if (current === undefined) {
      throw new Error("Retry record was not found");
    }
    const next = update(current);
    this.records[index] = next;
    return next;
  }
}

function isDue(row: RetryRecord, now: Instant): boolean {
  if (
    (row.status === "PENDING" || row.status === "RETRY_SCHEDULED") &&
    row.nextAttemptAt !== null &&
    compareInstant(row.nextAttemptAt, now) <= 0
  ) {
    return true;
  }
  return (
    row.status === "PROCESSING" &&
    row.leaseExpiresAt !== null &&
    compareInstant(row.leaseExpiresAt, now) <= 0
  );
}
