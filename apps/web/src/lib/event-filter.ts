import type { PublicWebhookEvent } from "../api/types";

export type EventListFilter = {
  readonly eventType?: string;
  readonly processingStatus?: string;
  readonly q?: string;
};

export function filterEvents(
  events: readonly PublicWebhookEvent[],
  filter: EventListFilter,
): readonly PublicWebhookEvent[] {
  return events.filter((row) => {
    if (
      filter.eventType !== undefined &&
      filter.eventType.length > 0 &&
      row.eventType !== filter.eventType
    ) {
      return false;
    }
    if (
      filter.processingStatus !== undefined &&
      filter.processingStatus.length > 0 &&
      row.processingStatus !== filter.processingStatus
    ) {
      return false;
    }
    if (filter.q !== undefined && filter.q.length > 0) {
      const q = filter.q;
      const hit =
        row.externalEventId === q ||
        row.externalEventId.includes(q) ||
        row.webhookEventId === q ||
        row.webhookEventId.includes(q);
      if (!hit) {
        return false;
      }
    }
    return true;
  });
}

export function chronologicalEvents(
  events: readonly PublicWebhookEvent[],
  field: "occurredAt" | "receivedAt" = "occurredAt",
): readonly PublicWebhookEvent[] {
  return events.slice().sort((left, right) => {
    if (left[field] < right[field]) {
      return -1;
    }
    if (left[field] > right[field]) {
      return 1;
    }
    return left.webhookEventId < right.webhookEventId ? -1 : 1;
  });
}
