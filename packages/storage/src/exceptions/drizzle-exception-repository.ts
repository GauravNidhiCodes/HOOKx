import { and, desc, eq, like, or, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { randomUUID } from "node:crypto";
import {
  canTransitionExceptionStatus,
  createException,
  type ExceptionDraft,
  type ExceptionRecord,
  type ExceptionStatus,
} from "@hookx/exceptions";
import type { PaymentId } from "@hookx/domain";
import { StorageError } from "../errors.js";
import { dateFromInstant } from "../mapping.js";
import { exceptions } from "../schema/exceptions.js";
import { toExceptionRecord } from "./mapping.js";
import type {
  ExceptionCreateResult,
  ExceptionListFilter,
  ExceptionRepository,
} from "./repository.js";

type StorageDatabase = ReturnType<typeof drizzle>;

function toInsertValues(record: ExceptionRecord) {
  return {
    id: record.exceptionId,
    exceptionCode: record.exceptionCode,
    severity: record.severity,
    status: record.status,
    provider: record.provider,
    paymentId: record.paymentId,
    webhookEventId: record.webhookEventId,
    reason: record.reason,
    detectedAt: dateFromInstant(record.detectedAt),
    correlationId: record.correlationId,
    metadata: { ...record.metadata },
    identityKey: record.identity,
  };
}

export class DrizzleExceptionRepository implements ExceptionRepository {
  public constructor(private readonly db: StorageDatabase) {}

  public async create(draft: ExceptionDraft): Promise<ExceptionCreateResult> {
    const created = createException({
      ...draft,
      exceptionId: randomUUID(),
    });
    const inserted = await this.db
      .insert(exceptions)
      .values(toInsertValues(created))
      .onConflictDoNothing({ target: exceptions.identityKey })
      .returning();
    const row = inserted[0];
    if (row !== undefined) {
      return { record: toExceptionRecord(row), inserted: true };
    }
    const existing = await this.findByIdentity(draft.identity);
    if (existing === null) {
      throw new StorageError("INVALID_ROW", "Exception conflict did not load");
    }
    return { record: existing, inserted: false };
  }

  public async findById(exceptionId: string): Promise<ExceptionRecord | null> {
    const rows = await this.db
      .select()
      .from(exceptions)
      .where(eq(exceptions.id, exceptionId))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toExceptionRecord(row);
  }

  public async findByIdentity(identity: string): Promise<ExceptionRecord | null> {
    const rows = await this.db
      .select()
      .from(exceptions)
      .where(eq(exceptions.identityKey, identity))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toExceptionRecord(row);
  }

  public async list(
    filter?: ExceptionListFilter,
  ): Promise<readonly ExceptionRecord[]> {
    const clauses: SQL[] = [];
    if (filter?.status !== undefined) {
      clauses.push(eq(exceptions.status, filter.status));
    }
    if (filter?.severity !== undefined) {
      clauses.push(eq(exceptions.severity, filter.severity));
    }
    if (filter?.exceptionCode !== undefined) {
      clauses.push(eq(exceptions.exceptionCode, filter.exceptionCode));
    }
    if (filter?.provider !== undefined) {
      clauses.push(eq(exceptions.provider, filter.provider));
    }
    if (filter?.paymentId !== undefined) {
      clauses.push(eq(exceptions.paymentId, filter.paymentId));
    }
    if (filter?.webhookEventId !== undefined) {
      clauses.push(eq(exceptions.webhookEventId, filter.webhookEventId));
    }
    if (filter?.q !== undefined) {
      const q = filter.q;
      const escaped = q
        .replace(/\\/g, "\\\\")
        .replace(/%/g, "\\%")
        .replace(/_/g, "\\_");
      const pattern = `%${escaped}%`;
      const uuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          q,
        );
      const search = uuid
        ? or(
            eq(exceptions.id, q),
            eq(exceptions.webhookEventId, q),
            eq(exceptions.paymentId, q),
            like(exceptions.paymentId, pattern),
          )
        : or(eq(exceptions.paymentId, q), like(exceptions.paymentId, pattern));
      if (search !== undefined) {
        clauses.push(search);
      }
    }
    const rows =
      clauses.length === 0
        ? await this.db
            .select()
            .from(exceptions)
            .orderBy(desc(exceptions.detectedAt), desc(exceptions.id))
        : await this.db
            .select()
            .from(exceptions)
            .where(and(...clauses))
            .orderBy(desc(exceptions.detectedAt), desc(exceptions.id));
    return rows.map((row) => toExceptionRecord(row));
  }

  public async listByPayment(
    paymentId: PaymentId,
  ): Promise<readonly ExceptionRecord[]> {
    const rows = await this.db
      .select()
      .from(exceptions)
      .where(eq(exceptions.paymentId, paymentId))
      .orderBy(desc(exceptions.detectedAt), desc(exceptions.id));
    return rows.map((row) => toExceptionRecord(row));
  }

  public async listOpen(): Promise<readonly ExceptionRecord[]> {
    return this.list({ status: "OPEN" });
  }

  public async updateStatus(
    exceptionId: string,
    status: ExceptionStatus,
  ): Promise<ExceptionRecord> {
    const current = await this.findById(exceptionId);
    if (current === null) {
      throw new StorageError("EVENT_NOT_FOUND", "Exception was not found");
    }
    if (!canTransitionExceptionStatus(current.status, status)) {
      throw new StorageError(
        "INVALID_STATUS_TRANSITION",
        `Cannot move exception from ${current.status} to ${status}`,
      );
    }
    if (current.status === status) {
      return current;
    }
    const updated = await this.db
      .update(exceptions)
      .set({ status })
      .where(eq(exceptions.id, exceptionId))
      .returning();
    const row = updated[0];
    if (row === undefined) {
      throw new StorageError("EVENT_NOT_FOUND", "Exception was not updated");
    }
    return toExceptionRecord(row);
  }
}
