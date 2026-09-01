import { randomUUID } from "node:crypto";
import { createAuditEvent, type AuditEvent } from "@hookx/audit";
import type { PaymentId, ProviderId } from "@hookx/domain";
import type { AuditAppendInput, AuditRepository } from "./repository.js";

function compareAudit(
  left: AuditEvent,
  right: AuditEvent,
  indexOf: (event: AuditEvent) => number,
): number {
  if (left.recordedAt < right.recordedAt) {
    return -1;
  }
  if (left.recordedAt > right.recordedAt) {
    return 1;
  }
  return indexOf(left) - indexOf(right);
}

export class MemoryAuditRepository implements AuditRepository {
  public readonly records: AuditEvent[] = [];

  public async append(input: AuditAppendInput): Promise<AuditEvent> {
    const created = createAuditEvent({
      ...input,
      auditEventId: randomUUID(),
    });
    this.records.push(created);
    return created;
  }

  public async listByPayment(
    paymentId: PaymentId,
    provider?: ProviderId,
  ): Promise<readonly AuditEvent[]> {
    return this.records
      .filter((row) => {
        if (row.paymentId !== paymentId) {
          return false;
        }
        return provider === undefined || row.provider === provider;
      })
      .slice()
      .sort((left, right) =>
        compareAudit(left, right, (event) => this.records.indexOf(event)),
      );
  }

  public async listByWebhook(
    webhookEventId: string,
  ): Promise<readonly AuditEvent[]> {
    return this.records
      .filter((row) => row.webhookEventId === webhookEventId)
      .slice()
      .sort((left, right) =>
        compareAudit(left, right, (event) => this.records.indexOf(event)),
      );
  }

  public async listByCorrelationId(
    correlationId: string,
  ): Promise<readonly AuditEvent[]> {
    return this.records
      .filter((row) => row.correlationId === correlationId)
      .slice()
      .sort((left, right) =>
        compareAudit(left, right, (event) => this.records.indexOf(event)),
      );
  }

  public async count(): Promise<number> {
    return this.records.length;
  }

  public async countByEventType(): Promise<Readonly<Record<string, number>>> {
    const tallies: Record<string, number> = {};
    for (const row of this.records) {
      tallies[row.eventType] = (tallies[row.eventType] ?? 0) + 1;
    }
    return tallies;
  }
}
