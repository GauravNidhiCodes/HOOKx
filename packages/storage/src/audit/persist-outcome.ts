import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { randomUUID } from "node:crypto";
import { createAuditEvent } from "@hookx/audit";
import { StorageError } from "../errors.js";
import { webhookEvents } from "../schema/webhook-events.js";
import { auditEvents } from "../schema/audit-events.js";
import type { WebhookEventRepository } from "../repository.js";
import type { WebhookProcessingStatus } from "../status.js";
import { toInsertValues } from "./drizzle-audit-repository.js";
import type {
  AuditAppendInput,
  AuditRepository,
  PersistOutcomeFn,
  WebhookTerminalStatus,
} from "./repository.js";

type StorageDatabase = ReturnType<typeof drizzle>;

const FROM_STATUS: Record<
  WebhookTerminalStatus,
  readonly WebhookProcessingStatus[]
> = {
  PROCESSED: ["PROCESSING"],
  REJECTED: ["PROCESSING"],
  CONFLICT: ["RECEIVED", "PROCESSING", "REJECTED", "CONFLICT"],
};

export function createSequentialOutcomeWriter(
  events: WebhookEventRepository,
  audit: AuditRepository,
): PersistOutcomeFn {
  return async (webhookEventId, status, drafts) => {
    if (status === "PROCESSED") {
      await events.markProcessed(webhookEventId);
    } else if (status === "REJECTED") {
      await events.markRejected(webhookEventId);
    } else {
      await events.markConflict(webhookEventId);
    }
    for (const draft of drafts) {
      await audit.append(draft);
    }
  };
}

export function createDrizzleOutcomeWriter(
  db: StorageDatabase,
): PersistOutcomeFn {
  return async (webhookEventId, status, drafts) => {
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(webhookEvents)
        .set({ processingStatus: status })
        .where(
          and(
            eq(webhookEvents.id, webhookEventId),
            inArray(webhookEvents.processingStatus, [...FROM_STATUS[status]]),
          ),
        )
        .returning();
      const row = updated[0];
      if (row === undefined) {
        const current = await tx
          .select()
          .from(webhookEvents)
          .where(eq(webhookEvents.id, webhookEventId))
          .limit(1);
        if (current[0]?.processingStatus === status) {
          // Already at the terminal status; still append missing audits.
        } else if (current[0] === undefined) {
          throw new StorageError(
            "EVENT_NOT_FOUND",
            "Webhook event was not found",
          );
        } else {
          throw new StorageError(
            "INVALID_STATUS_TRANSITION",
            `Cannot move webhook event to ${status}`,
          );
        }
      }
      for (const draft of drafts) {
        const created = createAuditEvent({
          ...draft,
          auditEventId: randomUUID(),
        });
        await tx.insert(auditEvents).values(toInsertValues(created));
      }
    });
  };
}

export async function appendAuditDrafts(
  audit: AuditRepository,
  drafts: readonly AuditAppendInput[],
): Promise<void> {
  for (const draft of drafts) {
    await audit.append(draft);
  }
}
