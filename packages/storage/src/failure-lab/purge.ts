import { inArray, like, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { auditEvents } from "../schema/audit-events.js";
import { exceptions } from "../schema/exceptions.js";
import { investigations } from "../schema/investigations.js";
import { payments } from "../schema/payments.js";
import { webhookDeadLetters } from "../schema/webhook-dead-letters.js";
import { webhookEvents } from "../schema/webhook-events.js";
import { webhookRetries } from "../schema/webhook-retries.js";
import {
  FAILURE_LAB_PAYMENT_LIKE,
  FAILURE_LAB_PAYMENT_PREFIX,
} from "./identity.js";

type StorageDatabase = ReturnType<typeof drizzle>;

export type FailureLabPurgeResult = {
  readonly investigations: number;
  readonly exceptions: number;
  readonly deadLetters: number;
  readonly retries: number;
  readonly audit: number;
  readonly webhooks: number;
  readonly payments: number;
};

function labPaymentClause() {
  return like(webhookEvents.paymentId, FAILURE_LAB_PAYMENT_LIKE);
}

/**
 * Delete only Failure Lab rows: payment ids SYNTHETIC:pay:lab-*.
 * Provider may be SYNTHETIC or razorpay (adapter lab path). Never truncates
 * tables. Never matches simulator SYNTHETIC:pay:sim-* or live-shaped ids.
 */
export async function purgeSyntheticFailureLab(
  db: StorageDatabase,
): Promise<FailureLabPurgeResult> {
  if (FAILURE_LAB_PAYMENT_LIKE !== `${FAILURE_LAB_PAYMENT_PREFIX}%`) {
    throw new Error("Failure Lab purge prefix is misconfigured");
  }

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('hookx.allow_failure_lab_purge', 'on', true)`,
    );
    const labWebhooks = await tx
      .select({ id: webhookEvents.id, paymentId: webhookEvents.paymentId })
      .from(webhookEvents)
      .where(labPaymentClause());
    const webhookIds = labWebhooks.map((row) => row.id);

    const labExceptions = await tx
      .select({ id: exceptions.id })
      .from(exceptions)
      .where(
        or(
          like(exceptions.paymentId, FAILURE_LAB_PAYMENT_LIKE),
          webhookIds.length > 0
            ? inArray(exceptions.webhookEventId, webhookIds)
            : sql`false`,
        ),
      );
    const exceptionIds = labExceptions.map((row) => row.id);

    const investigationsDeleted =
      exceptionIds.length === 0
        ? []
        : await tx
            .delete(investigations)
            .where(inArray(investigations.exceptionId, exceptionIds))
            .returning({ id: investigations.id });

    const exceptionsDeleted =
      exceptionIds.length === 0
        ? []
        : await tx
            .delete(exceptions)
            .where(inArray(exceptions.id, exceptionIds))
            .returning({ id: exceptions.id });

    const deadDeleted =
      webhookIds.length === 0
        ? []
        : await tx
            .delete(webhookDeadLetters)
            .where(inArray(webhookDeadLetters.webhookEventId, webhookIds))
            .returning({ id: webhookDeadLetters.id });

    const retriesDeleted =
      webhookIds.length === 0
        ? []
        : await tx
            .delete(webhookRetries)
            .where(inArray(webhookRetries.webhookEventId, webhookIds))
            .returning({ id: webhookRetries.id });

    const auditDeleted = await tx
      .delete(auditEvents)
      .where(
        or(
          like(auditEvents.paymentId, FAILURE_LAB_PAYMENT_LIKE),
          webhookIds.length > 0
            ? inArray(auditEvents.webhookEventId, webhookIds)
            : sql`false`,
        ),
      )
      .returning({ id: auditEvents.id });

    const webhooksDeleted =
      webhookIds.length === 0
        ? []
        : await tx
            .delete(webhookEvents)
            .where(inArray(webhookEvents.id, webhookIds))
            .returning({ id: webhookEvents.id });

    const paymentsDeleted = await tx
      .delete(payments)
      .where(like(payments.paymentId, FAILURE_LAB_PAYMENT_LIKE))
      .returning({ paymentId: payments.paymentId });

    return {
      investigations: investigationsDeleted.length,
      exceptions: exceptionsDeleted.length,
      deadLetters: deadDeleted.length,
      retries: retriesDeleted.length,
      audit: auditDeleted.length,
      webhooks: webhooksDeleted.length,
      payments: paymentsDeleted.length,
    };
  });
}
