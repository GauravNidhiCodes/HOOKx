import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { randomUUID } from "node:crypto";
import { createAuditEvent } from "@hookx/audit";
import { StorageError } from "../errors.js";
import { dateFromInstant } from "../mapping.js";
import type { PaymentRepository } from "../payment/repository.js";
import type { StoredPayment } from "../payment/types.js";
import { auditEvents } from "../schema/audit-events.js";
import { payments } from "../schema/payments.js";
import { webhookEvents } from "../schema/webhook-events.js";
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

async function writePayment(
  paymentsRepo: PaymentRepository | undefined,
  payment: StoredPayment | null | undefined,
): Promise<void> {
  if (paymentsRepo === undefined || payment === null || payment === undefined) {
    return;
  }
  await paymentsRepo.upsert(payment);
}

export function createSequentialOutcomeWriter(
  events: WebhookEventRepository,
  audit: AuditRepository,
  paymentsRepo?: PaymentRepository,
): PersistOutcomeFn {
  return async (webhookEventId, status, drafts, payment) => {
    if (status === "PROCESSED") {
      await events.markProcessed(webhookEventId);
    } else if (status === "REJECTED") {
      await events.markRejected(webhookEventId);
    } else {
      await events.markConflict(webhookEventId);
    }
    await writePayment(paymentsRepo, payment);
    for (const draft of drafts) {
      await audit.append(draft);
    }
  };
}

export function createDrizzleOutcomeWriter(
  db: StorageDatabase,
): PersistOutcomeFn {
  return async (webhookEventId, status, drafts, payment) => {
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
          // Already at the terminal status; still persist payment/audit.
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
      if (payment !== undefined && payment !== null) {
        await tx
          .insert(payments)
          .values({
            provider: payment.provider,
            paymentId: payment.paymentId,
            state: payment.state,
            amountMinorUnits: payment.amountMinor,
            currency: payment.currency,
            lastOccurredAt: dateFromInstant(payment.lastOccurredAt),
            updatedAt: dateFromInstant(payment.updatedAt),
          })
          .onConflictDoUpdate({
            target: [payments.provider, payments.paymentId],
            set: {
              state: payment.state,
              amountMinorUnits: payment.amountMinor,
              currency: payment.currency,
              lastOccurredAt: dateFromInstant(payment.lastOccurredAt),
              updatedAt: dateFromInstant(payment.updatedAt),
            },
          });
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
