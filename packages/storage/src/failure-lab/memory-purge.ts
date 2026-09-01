import type { AuditEvent } from "@hookx/audit";
import type { ExceptionRecord } from "@hookx/exceptions";
import type { InvestigationRecord } from "@hookx/investigation";
import type { StoredPayment } from "../payment/types.js";
import type { DeadLetterRecord, RetryRecord } from "../retry/types.js";
import type { StoredWebhookEvent } from "../types.js";
import { isFailureLabPaymentId } from "./identity.js";
import type { FailureLabPurgeResult } from "./purge.js";

function spliceWhere<T>(rows: T[], keep: (row: T) => boolean): number {
  const removed = rows.length;
  const kept = rows.filter(keep);
  rows.splice(0, rows.length, ...kept);
  return removed - rows.length;
}

export type MemoryFailureLabRepos = {
  readonly webhooks: { readonly records: StoredWebhookEvent[] };
  readonly payments: { readonly records: StoredPayment[] };
  readonly exceptions: { readonly records: ExceptionRecord[] };
  readonly audit: { readonly records: AuditEvent[] };
  readonly retry: {
    readonly records: RetryRecord[];
    readonly deadLetters: DeadLetterRecord[];
  };
  readonly investigations: { readonly records: InvestigationRecord[] };
};

/**
 * In-memory counterpart of purgeSyntheticFailureLab. Same payment-id filter.
 */
export function purgeMemoryFailureLab(
  repos: MemoryFailureLabRepos,
): FailureLabPurgeResult {
  const labWebhookIds = new Set(
    repos.webhooks.records
      .filter((row) => isFailureLabPaymentId(row.event.paymentId))
      .map((row) => row.id),
  );
  const labExceptionIds = new Set(
    repos.exceptions.records
      .filter(
        (row) =>
          isFailureLabPaymentId(row.paymentId) ||
          (row.webhookEventId !== null && labWebhookIds.has(row.webhookEventId)),
      )
      .map((row) => row.exceptionId),
  );

  const investigations = spliceWhere(
    repos.investigations.records,
    (row) => !labExceptionIds.has(row.exceptionId),
  );
  const exceptions = spliceWhere(
    repos.exceptions.records,
    (row) => !labExceptionIds.has(row.exceptionId),
  );
  const deadLetters = spliceWhere(
    repos.retry.deadLetters,
    (row) => !labWebhookIds.has(row.webhookEventId),
  );
  const retries = spliceWhere(
    repos.retry.records,
    (row) => !labWebhookIds.has(row.webhookEventId),
  );
  const audit = spliceWhere(repos.audit.records, (row) => {
    if (isFailureLabPaymentId(row.paymentId)) {
      return false;
    }
    if (row.webhookEventId !== null && labWebhookIds.has(row.webhookEventId)) {
      return false;
    }
    return true;
  });
  const webhooks = spliceWhere(
    repos.webhooks.records,
    (row) => !labWebhookIds.has(row.id),
  );
  const payments = spliceWhere(
    repos.payments.records,
    (row) => !isFailureLabPaymentId(row.paymentId),
  );

  return {
    investigations,
    exceptions,
    deadLetters,
    retries,
    audit,
    webhooks,
    payments,
  };
}
