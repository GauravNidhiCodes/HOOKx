import type { PublicAuditEvent, PublicWebhookEvent } from "../api/types";

export type StateTransitionView = {
  readonly at: string;
  readonly previousState: string | null;
  readonly nextState: string;
  readonly eventType: string | null;
  readonly webhookEventId: string | null;
  readonly reason: string;
};

export function stateHistoryFromAudit(
  audit: readonly PublicAuditEvent[],
  webhooks: readonly PublicWebhookEvent[],
): readonly StateTransitionView[] {
  const byId = new Map(webhooks.map((row) => [row.webhookEventId, row]));
  return audit
    .filter((row) => row.eventType === "PAYMENT_STATE_CHANGED")
    .map((row) => {
      const linked =
        row.webhookEventId === null ? undefined : byId.get(row.webhookEventId);
      return {
        at: row.recordedAt,
        previousState: row.previousState,
        nextState: row.resultingState ?? "UNKNOWN",
        eventType: linked?.eventType ?? null,
        webhookEventId: row.webhookEventId,
        reason: row.reason,
      };
    });
}
