import type { PublicAuditEvent, PublicWebhookEvent } from "../api/types";

export type TimelineItem = {
  readonly at: string;
  readonly label: string;
  readonly result: string;
  readonly previousState: string | null;
  readonly nextState: string | null;
  readonly source: "WEBHOOK" | "STATE" | "AUDIT";
};

function webhookById(
  webhooks: readonly PublicWebhookEvent[],
): ReadonlyMap<string, PublicWebhookEvent> {
  return new Map(webhooks.map((row) => [row.webhookEventId, row]));
}

export function buildTimeline(
  webhooks: readonly PublicWebhookEvent[],
  audit: readonly PublicAuditEvent[],
): readonly TimelineItem[] {
  const items: TimelineItem[] = [];
  const byId = webhookById(webhooks);

  for (const webhook of webhooks) {
    items.push({
      at: webhook.occurredAt,
      label: webhook.eventType,
      result: webhook.processingStatus,
      previousState: null,
      nextState: null,
      source: "WEBHOOK",
    });
  }

  const delayedIds = new Set(
    audit
      .filter((event) => event.eventType === "WEBHOOK_DELAYED" && event.webhookEventId !== null)
      .map((event) => event.webhookEventId as string),
  );

  for (const event of audit) {
    const linked = event.webhookEventId === null ? undefined : byId.get(event.webhookEventId);
    if (event.eventType === "PAYMENT_STATE_CHANGED") {
      const replay =
        event.webhookEventId !== null && delayedIds.has(event.webhookEventId);
      items.push({
        at: event.occurredAt,
        label: replay ? "REPLAY" : (linked?.eventType ?? "STATE"),
        result: event.resultingState ?? "—",
        previousState: event.previousState,
        nextState: event.resultingState,
        source: "STATE",
      });
      continue;
    }
    if (event.eventType === "WEBHOOK_DELAYED") {
      items.push({
        at: event.occurredAt,
        label: linked?.eventType ?? "WEBHOOK_DELAYED",
        result: "DELAYED",
        previousState: event.previousState,
        nextState: event.resultingState,
        source: "AUDIT",
      });
      continue;
    }
    items.push({
      at: event.recordedAt,
      label: event.eventType,
      result: event.reason,
      previousState: event.previousState,
      nextState: event.resultingState,
      source: "AUDIT",
    });
  }

  return items.sort((left, right) => {
    if (left.at < right.at) {
      return -1;
    }
    if (left.at > right.at) {
      return 1;
    }
    return left.label < right.label ? -1 : 1;
  });
}
