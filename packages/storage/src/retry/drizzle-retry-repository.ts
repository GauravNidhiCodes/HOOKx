import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Instant } from "@hookx/domain";
import { StorageError } from "../errors.js";
import { dateFromInstant } from "../mapping.js";
import { webhookDeadLetters } from "../schema/webhook-dead-letters.js";
import { webhookRetries } from "../schema/webhook-retries.js";
import { addMilliseconds } from "./time.js";
import { toDeadLetterRecord, toRetryRecord } from "./mapping.js";
import type { DeadLetterInput, RetryRepository, ScheduleRetryInput } from "./repository.js";
import type { DeadLetterRecord, RetryRecord } from "./types.js";

type StorageDatabase = ReturnType<typeof drizzle>;

export class DrizzleRetryRepository implements RetryRepository {
  public constructor(private readonly db: StorageDatabase) {}

  public async ensurePending(
    webhookEventId: string,
    now: Instant,
  ): Promise<RetryRecord> {
    const nowDate = dateFromInstant(now);
    await this.db
      .insert(webhookRetries)
      .values({
        webhookEventId,
        attemptCount: 0,
        status: "PENDING",
        nextAttemptAt: nowDate,
        createdAt: nowDate,
        updatedAt: nowDate,
      })
      .onConflictDoNothing({
        target: [webhookRetries.webhookEventId],
      });
    const existing = await this.getByWebhookEventId(webhookEventId);
    if (existing === null) {
      throw new StorageError(
        "INCONSISTENT_IDENTITY",
        "Retry row was not created",
      );
    }
    return existing;
  }

  public async getByWebhookEventId(
    webhookEventId: string,
  ): Promise<RetryRecord | null> {
    const rows = await this.db
      .select()
      .from(webhookRetries)
      .where(eq(webhookRetries.webhookEventId, webhookEventId))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toRetryRecord(row);
  }

  public async getById(id: string): Promise<RetryRecord | null> {
    const rows = await this.db
      .select()
      .from(webhookRetries)
      .where(eq(webhookRetries.id, id))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toRetryRecord(row);
  }

  public async listActive(): Promise<readonly RetryRecord[]> {
    const rows = await this.db
      .select()
      .from(webhookRetries)
      .where(
        sql`${webhookRetries.status} IN ('PENDING', 'PROCESSING', 'RETRY_SCHEDULED')`,
      );
    return rows.map((row) => toRetryRecord(row));
  }

  public async listDeadLetters(): Promise<readonly DeadLetterRecord[]> {
    const rows = await this.db.select().from(webhookDeadLetters);
    return rows.map((row) => toDeadLetterRecord(row));
  }

  public async getDeadLetterByWebhookEventId(
    webhookEventId: string,
  ): Promise<DeadLetterRecord | null> {
    const rows = await this.db
      .select()
      .from(webhookDeadLetters)
      .where(eq(webhookDeadLetters.webhookEventId, webhookEventId))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toDeadLetterRecord(row);
  }

  public async claimDue(
    now: Instant,
    limit: number,
    leaseMs: number,
  ): Promise<readonly RetryRecord[]> {
    const nowDate = dateFromInstant(now);
    const leaseExpires = dateFromInstant(addMilliseconds(now, leaseMs));
    return this.db.transaction(async (tx) => {
      const result = await tx.execute(sql`
        WITH due AS (
          SELECT id
          FROM webhook_retries
          WHERE (
            (
              status IN ('PENDING', 'RETRY_SCHEDULED')
              AND next_attempt_at IS NOT NULL
              AND next_attempt_at <= ${nowDate}
            )
            OR (
              status = 'PROCESSING'
              AND lease_expires_at IS NOT NULL
              AND lease_expires_at <= ${nowDate}
            )
          )
          ORDER BY next_attempt_at ASC NULLS FIRST, id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
        )
        UPDATE webhook_retries AS r
        SET
          status = 'PROCESSING',
          attempt_count = r.attempt_count + 1,
          lease_expires_at = ${leaseExpires},
          updated_at = ${nowDate}
        FROM due
        WHERE r.id = due.id
        RETURNING r.*
      `);
      const rows = result.rows as Array<{
        id: string;
        webhook_event_id: string;
        attempt_count: number | string;
        status: string;
        next_attempt_at: Date | string | null;
        lease_expires_at: Date | string | null;
        last_error_code: string | null;
        last_failed_at: Date | string | null;
        created_at: Date | string;
        updated_at: Date | string;
      }>;
      return rows.map((row) =>
        toRetryRecord({
          id: row.id,
          webhookEventId: row.webhook_event_id,
          attemptCount: Number(row.attempt_count),
          status: row.status,
          nextAttemptAt: toDate(row.next_attempt_at),
          leaseExpiresAt: toDate(row.lease_expires_at),
          lastErrorCode: row.last_error_code,
          lastFailedAt: toDate(row.last_failed_at),
          createdAt: toDateRequired(row.created_at),
          updatedAt: toDateRequired(row.updated_at),
        }),
      );
    });
  }

  public async beginAttempt(
    id: string,
    now: Instant,
    leaseMs: number,
  ): Promise<RetryRecord | null> {
    const nowDate = dateFromInstant(now);
    const leaseExpires = dateFromInstant(addMilliseconds(now, leaseMs));
    const result = await this.db.execute(sql`
      UPDATE webhook_retries AS r
      SET
        status = 'PROCESSING',
        attempt_count = r.attempt_count + 1,
        lease_expires_at = ${leaseExpires},
        updated_at = ${nowDate}
      WHERE r.id = ${id}
        AND (
          (
            r.status IN ('PENDING', 'RETRY_SCHEDULED')
            AND r.next_attempt_at IS NOT NULL
            AND r.next_attempt_at <= ${nowDate}
          )
          OR (
            r.status = 'PROCESSING'
            AND r.lease_expires_at IS NOT NULL
            AND r.lease_expires_at <= ${nowDate}
          )
        )
      RETURNING *
    `);
    const row = (result.rows as Array<{
      id: string;
      webhook_event_id: string;
      attempt_count: number | string;
      status: string;
      next_attempt_at: Date | string | null;
      lease_expires_at: Date | string | null;
      last_error_code: string | null;
      last_failed_at: Date | string | null;
      created_at: Date | string;
      updated_at: Date | string;
    }>)[0];
    if (row === undefined) {
      return null;
    }
    return toRetryRecord({
      id: row.id,
      webhookEventId: row.webhook_event_id,
      attemptCount: Number(row.attempt_count),
      status: row.status,
      nextAttemptAt: toDate(row.next_attempt_at),
      leaseExpiresAt: toDate(row.lease_expires_at),
      lastErrorCode: row.last_error_code,
      lastFailedAt: toDate(row.last_failed_at),
      createdAt: toDateRequired(row.created_at),
      updatedAt: toDateRequired(row.updated_at),
    });
  }

  public async markSucceeded(id: string, now: Instant): Promise<RetryRecord> {
    const updated = await this.db
      .update(webhookRetries)
      .set({
        status: "SUCCEEDED",
        nextAttemptAt: null,
        leaseExpiresAt: null,
        updatedAt: dateFromInstant(now),
      })
      .where(eq(webhookRetries.id, id))
      .returning();
    const row = updated[0];
    if (row === undefined) {
      throw new StorageError("EVENT_NOT_FOUND", "Retry record was not found");
    }
    return toRetryRecord(row);
  }

  public async scheduleRetry(
    id: string,
    input: ScheduleRetryInput,
  ): Promise<RetryRecord> {
    const updated = await this.db
      .update(webhookRetries)
      .set({
        status: "RETRY_SCHEDULED",
        nextAttemptAt: dateFromInstant(input.nextAttemptAt),
        leaseExpiresAt: null,
        lastErrorCode: input.errorCode,
        lastFailedAt: dateFromInstant(input.failedAt),
        updatedAt: dateFromInstant(input.now),
      })
      .where(eq(webhookRetries.id, id))
      .returning();
    const row = updated[0];
    if (row === undefined) {
      throw new StorageError("EVENT_NOT_FOUND", "Retry record was not found");
    }
    return toRetryRecord(row);
  }

  public async deadLetter(
    id: string,
    input: DeadLetterInput,
  ): Promise<DeadLetterRecord> {
    return this.db.transaction(async (tx) => {
      const currentRows = await tx
        .select()
        .from(webhookRetries)
        .where(eq(webhookRetries.id, id))
        .limit(1);
      const current = currentRows[0];
      if (current === undefined) {
        throw new StorageError("EVENT_NOT_FOUND", "Retry record was not found");
      }

      const updated = await tx
        .update(webhookRetries)
        .set({
          status: "DEAD_LETTERED",
          nextAttemptAt: null,
          leaseExpiresAt: null,
          lastErrorCode: input.errorCode,
          lastFailedAt: dateFromInstant(input.now),
          updatedAt: dateFromInstant(input.now),
        })
        .where(eq(webhookRetries.id, id))
        .returning();
      const retryRow = updated[0];
      if (retryRow === undefined) {
        throw new StorageError("EVENT_NOT_FOUND", "Retry record was not found");
      }

      const inserted = await tx
        .insert(webhookDeadLetters)
        .values({
          webhookEventId: retryRow.webhookEventId,
          retryId: retryRow.id,
          failureCode: input.errorCode,
          attemptCount: retryRow.attemptCount,
          deadLetteredAt: dateFromInstant(input.now),
        })
        .onConflictDoNothing({
          target: [webhookDeadLetters.webhookEventId],
        })
        .returning();

      const created = inserted[0];
      if (created !== undefined) {
        return toDeadLetterRecord(created);
      }

      const existing = await tx
        .select()
        .from(webhookDeadLetters)
        .where(
          eq(webhookDeadLetters.webhookEventId, retryRow.webhookEventId),
        )
        .limit(1);
      const existingRow = existing[0];
      if (existingRow === undefined) {
        throw new StorageError(
          "INCONSISTENT_IDENTITY",
          "Dead-letter row was not created",
        );
      }
      return toDeadLetterRecord(existingRow);
    });
  }
}

function toDate(value: Date | string | null): Date | null {
  if (value === null) {
    return null;
  }
  return value instanceof Date ? value : new Date(value);
}

function toDateRequired(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
