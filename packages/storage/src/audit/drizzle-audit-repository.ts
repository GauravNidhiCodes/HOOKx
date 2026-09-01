import { and, asc, count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { randomUUID } from "node:crypto";
import { createAuditEvent, type AuditEvent } from "@hookx/audit";
import type { PaymentId, ProviderId } from "@hookx/domain";
import { StorageError } from "../errors.js";
import { dateFromInstant } from "../mapping.js";
import { auditEvents } from "../schema/audit-events.js";
import { toAuditEvent } from "./mapping.js";
import type { AuditAppendInput, AuditRepository } from "./repository.js";

type StorageDatabase = ReturnType<typeof drizzle>;

export class DrizzleAuditRepository implements AuditRepository {
  public constructor(private readonly db: StorageDatabase) {}

  public async append(input: AuditAppendInput): Promise<AuditEvent> {
    const created = createAuditEvent({
      ...input,
      auditEventId: randomUUID(),
    });
    const inserted = await this.db
      .insert(auditEvents)
      .values(toInsertValues(created))
      .returning();
    const row = inserted[0];
    if (row === undefined) {
      throw new StorageError("INVALID_ROW", "Audit event was not inserted");
    }
    return toAuditEvent(row);
  }

  public async listByPayment(
    paymentId: PaymentId,
    provider?: ProviderId,
  ): Promise<readonly AuditEvent[]> {
    const rows =
      provider === undefined
        ? await this.db
            .select()
            .from(auditEvents)
            .where(eq(auditEvents.paymentId, paymentId))
            .orderBy(asc(auditEvents.recordedAt), asc(auditEvents.seq))
        : await this.db
            .select()
            .from(auditEvents)
            .where(
              and(
                eq(auditEvents.paymentId, paymentId),
                eq(auditEvents.provider, provider),
              ),
            )
            .orderBy(asc(auditEvents.recordedAt), asc(auditEvents.seq));
    return rows.map((row) => toAuditEvent(row));
  }

  public async listByWebhook(
    webhookEventId: string,
  ): Promise<readonly AuditEvent[]> {
    const rows = await this.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.webhookEventId, webhookEventId))
      .orderBy(asc(auditEvents.recordedAt), asc(auditEvents.seq));
    return rows.map((row) => toAuditEvent(row));
  }

  public async listByCorrelationId(
    correlationId: string,
  ): Promise<readonly AuditEvent[]> {
    const rows = await this.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.correlationId, correlationId))
      .orderBy(asc(auditEvents.recordedAt), asc(auditEvents.seq));
    return rows.map((row) => toAuditEvent(row));
  }

  public async count(): Promise<number> {
    const rows = await this.db.select({ value: count() }).from(auditEvents);
    return Number(rows[0]?.value ?? 0);
  }

  public async countByEventType(): Promise<Readonly<Record<string, number>>> {
    const rows = await this.db
      .select({
        eventType: auditEvents.eventType,
        value: count(),
      })
      .from(auditEvents)
      .groupBy(auditEvents.eventType);
    const tallies: Record<string, number> = {};
    for (const row of rows) {
      tallies[row.eventType] = Number(row.value);
    }
    return tallies;
  }
}

export function toInsertValues(event: AuditEvent) {
  return {
    id: event.auditEventId,
    eventType: event.eventType,
    occurredAt: dateFromInstant(event.occurredAt),
    recordedAt: dateFromInstant(event.recordedAt),
    provider: event.provider,
    paymentId: event.paymentId,
    webhookEventId: event.webhookEventId,
    previousState: event.previousState,
    resultingState: event.resultingState,
    actor: event.actor,
    reason: event.reason,
    correlationId: event.correlationId,
    metadata: { ...event.metadata },
  };
}
