import type { PaymentId, ProviderId } from "@hookx/domain";
import type { WebhookProcessingStatus } from "./status.js";
import type { StoredWebhookEvent } from "./types.js";

export const WEBHOOK_LIST_LIMIT = 500;

export type WebhookListFilter = {
  readonly q?: string;
  readonly eventType?: string;
  readonly processingStatus?: WebhookProcessingStatus;
  readonly paymentId?: PaymentId;
  readonly provider?: ProviderId;
};

export function matchesWebhookListFilter(
  row: StoredWebhookEvent,
  filter?: WebhookListFilter,
): boolean {
  if (filter === undefined) {
    return true;
  }
  if (filter.provider !== undefined && row.event.provider !== filter.provider) {
    return false;
  }
  if (
    filter.paymentId !== undefined &&
    row.event.paymentId !== filter.paymentId
  ) {
    return false;
  }
  if (
    filter.eventType !== undefined &&
    row.event.eventType !== filter.eventType
  ) {
    return false;
  }
  if (
    filter.processingStatus !== undefined &&
    row.processingStatus !== filter.processingStatus
  ) {
    return false;
  }
  if (filter.q !== undefined) {
    const q = filter.q;
    const hit =
      row.id === q ||
      row.id.includes(q) ||
      row.event.externalEventId === q ||
      row.event.externalEventId.includes(q) ||
      row.event.paymentId === q ||
      row.event.paymentId.includes(q);
    if (!hit) {
      return false;
    }
  }
  return true;
}

export function compareWebhooksReceivedDesc(
  left: StoredWebhookEvent,
  right: StoredWebhookEvent,
): number {
  if (left.event.receivedAt > right.event.receivedAt) {
    return -1;
  }
  if (left.event.receivedAt < right.event.receivedAt) {
    return 1;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export function selectWebhookList(
  rows: readonly StoredWebhookEvent[],
  filter?: WebhookListFilter,
): readonly StoredWebhookEvent[] {
  return rows
    .filter((row) => matchesWebhookListFilter(row, filter))
    .slice()
    .sort(compareWebhooksReceivedDesc)
    .slice(0, WEBHOOK_LIST_LIMIT);
}
