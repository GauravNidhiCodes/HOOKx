import type {
  PublicAuditEvent,
  PublicDeadLetter,
  PublicRetry,
} from "../api/types";

const RETRY_TYPES = new Set([
  "RETRY_SCHEDULED",
  "RETRY_ATTEMPTED",
  "RETRY_SUCCEEDED",
  "RETRY_DEAD_LETTERED",
]);

export type RetryAttemptView = {
  readonly attempt: number;
  readonly at: string;
  readonly result: string;
  readonly failureClass: string | null;
  readonly nextRetry: string | null;
  readonly webhookEventId: string | null;
};

function attemptOf(metadata: PublicAuditEvent["metadata"]): number {
  const raw = metadata["attempt"];
  return typeof raw === "number" && Number.isInteger(raw) && raw > 0 ? raw : 1;
}

function nextRetryOf(metadata: PublicAuditEvent["metadata"]): string | null {
  const raw = metadata["nextAttemptAt"];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

export function retryHistoryFromAudit(
  audit: readonly PublicAuditEvent[],
  webhookEventId?: string,
): readonly RetryAttemptView[] {
  return audit
    .filter((row) => RETRY_TYPES.has(row.eventType))
    .filter(
      (row) =>
        webhookEventId === undefined || row.webhookEventId === webhookEventId,
    )
    .map((row) => {
      const failureClass =
        row.eventType === "RETRY_SCHEDULED" || row.eventType === "RETRY_ATTEMPTED"
          ? row.reason
          : null;
      const result =
        row.eventType === "RETRY_SUCCEEDED"
          ? "SUCCESS"
          : row.eventType === "RETRY_DEAD_LETTERED"
            ? "DEAD LETTERED"
            : row.eventType === "RETRY_SCHEDULED"
              ? "TEMPORARY FAILURE"
              : "ATTEMPTED";
      return {
        attempt: attemptOf(row.metadata),
        at: row.recordedAt,
        result,
        failureClass,
        nextRetry: nextRetryOf(row.metadata),
        webhookEventId: row.webhookEventId,
      };
    });
}

export function hasRetryHistory(
  retry: PublicRetry | null,
  deadLetter: PublicDeadLetter | null,
  attempts: readonly RetryAttemptView[],
): boolean {
  if (deadLetter !== null || attempts.length > 0) {
    return true;
  }
  if (retry === null) {
    return false;
  }
  return retry.status !== "SUCCEEDED" || retry.lastErrorCode !== null;
}
