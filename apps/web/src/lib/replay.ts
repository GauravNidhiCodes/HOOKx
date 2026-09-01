import type { PublicAuditEvent, PublicWebhookEvent } from "../api/types";

export type ReplayView = {
  readonly originalDelivery: readonly PublicWebhookEvent[];
  readonly logicalOrder: readonly PublicWebhookEvent[];
  readonly finalState: string;
  readonly outOfOrder: boolean;
};

function byReceived(left: PublicWebhookEvent, right: PublicWebhookEvent): number {
  if (left.receivedAt < right.receivedAt) {
    return -1;
  }
  if (left.receivedAt > right.receivedAt) {
    return 1;
  }
  return left.webhookEventId < right.webhookEventId ? -1 : 1;
}

function byOccurred(left: PublicWebhookEvent, right: PublicWebhookEvent): number {
  if (left.occurredAt < right.occurredAt) {
    return -1;
  }
  if (left.occurredAt > right.occurredAt) {
    return 1;
  }
  return left.webhookEventId < right.webhookEventId ? -1 : 1;
}

function sameOrder(
  left: readonly PublicWebhookEvent[],
  right: readonly PublicWebhookEvent[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((row, index) => row.webhookEventId === right[index]?.webhookEventId);
}

function deliveryOrder(
  webhooks: readonly PublicWebhookEvent[],
  audit: readonly PublicAuditEvent[],
): readonly PublicWebhookEvent[] {
  const received = audit.filter(
    (row) =>
      row.eventType === "WEBHOOK_RECEIVED" && row.webhookEventId !== null,
  );
  const index = new Map(
    received.map((row, i) => [row.webhookEventId as string, i]),
  );
  return webhooks.slice().sort((left, right) => {
    const leftIndex = index.get(left.webhookEventId);
    const rightIndex = index.get(right.webhookEventId);
    if (
      leftIndex !== undefined &&
      rightIndex !== undefined &&
      leftIndex !== rightIndex
    ) {
      return leftIndex - rightIndex;
    }
    return byReceived(left, right);
  });
}

export function buildReplay(
  webhooks: readonly PublicWebhookEvent[],
  finalState: string,
  audit: readonly PublicAuditEvent[],
): ReplayView | null {
  if (webhooks.length === 0) {
    return null;
  }
  const originalDelivery = deliveryOrder(webhooks, audit);
  const logicalOrder = webhooks.slice().sort(byOccurred);
  const delayed = audit.some((row) => row.eventType === "WEBHOOK_DELAYED");
  const outOfOrder = delayed || !sameOrder(originalDelivery, logicalOrder);
  if (!outOfOrder) {
    return null;
  }
  return {
    originalDelivery,
    logicalOrder,
    finalState,
    outOfOrder: true,
  };
}
