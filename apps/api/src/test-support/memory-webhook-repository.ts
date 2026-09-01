import { randomUUID } from "node:crypto";
import type { PaymentId, ProviderId } from "@hookx/domain";
import type {
  StoredWebhookEvent,
  StoreWebhookEventResult,
  WebhookEventRepository,
  WebhookListFilter,
  WebhookProcessingStatus,
} from "@hookx/storage";
import { selectWebhookList, StorageError } from "@hookx/storage";
import type { NormalizedWebhookEvent, WebhookIdentity } from "@hookx/webhook";

export class MemoryWebhookEventRepository implements WebhookEventRepository {
  public readonly records: StoredWebhookEvent[] = [];
  public storeCalls = 0;

  public async store(
    event: NormalizedWebhookEvent,
  ): Promise<StoreWebhookEventResult> {
    this.storeCalls += 1;
    const existing = this.records.find(
      (row) =>
        row.event.provider === event.provider &&
        row.event.externalEventId === event.externalEventId,
    );
    if (existing !== undefined) {
      if (existing.event.payloadHash === event.payloadHash) {
        return { outcome: "DUPLICATE", record: existing };
      }
      return { outcome: "CONFLICT", existing, incoming: event };
    }

    const record: StoredWebhookEvent = Object.freeze({
      id: randomUUID(),
      event,
      processingStatus: "RECEIVED",
      createdAt: event.receivedAt,
    });
    this.records.push(record);
    return { outcome: "STORED", record };
  }

  public async findByIdentity(
    identity: WebhookIdentity,
  ): Promise<StoredWebhookEvent | null> {
    return (
      this.records.find(
        (row) =>
          row.event.provider === identity.provider &&
          row.event.externalEventId === identity.externalEventId,
      ) ?? null
    );
  }

  public async findById(id: string): Promise<StoredWebhookEvent | null> {
    return this.records.find((row) => row.id === id) ?? null;
  }

  public async list(
    filter?: WebhookListFilter,
  ): Promise<readonly StoredWebhookEvent[]> {
    return selectWebhookList(this.records, filter);
  }

  public async count(): Promise<number> {
    return this.records.length;
  }

  public async listByPayment(
    provider: ProviderId,
    paymentId: PaymentId,
  ): Promise<readonly StoredWebhookEvent[]> {
    return this.records.filter(
      (row) =>
        row.event.provider === provider && row.event.paymentId === paymentId,
    );
  }

  public async markProcessing(id: string): Promise<StoredWebhookEvent> {
    return this.transition(id, ["RECEIVED"], "PROCESSING");
  }

  public async markProcessed(id: string): Promise<StoredWebhookEvent> {
    return this.transition(id, ["PROCESSING"], "PROCESSED");
  }

  public async markRejected(id: string): Promise<StoredWebhookEvent> {
    return this.transition(id, ["PROCESSING"], "REJECTED");
  }

  public async markConflict(id: string): Promise<StoredWebhookEvent> {
    return this.transition(
      id,
      ["RECEIVED", "PROCESSING", "REJECTED", "CONFLICT"],
      "CONFLICT",
    );
  }

  private transition(
    id: string,
    from: readonly WebhookProcessingStatus[],
    to: WebhookProcessingStatus,
  ): StoredWebhookEvent {
    const index = this.records.findIndex((row) => row.id === id);
    const current = index === -1 ? undefined : this.records[index];
    if (current === undefined) {
      throw new StorageError("EVENT_NOT_FOUND", "Webhook event was not found");
    }
    if (
      current.processingStatus === to &&
      from.includes(current.processingStatus)
    ) {
      return current;
    }
    if (!from.includes(current.processingStatus)) {
      throw new StorageError(
        "INVALID_STATUS_TRANSITION",
        "Cannot apply webhook processing status",
      );
    }
    const next: StoredWebhookEvent = Object.freeze({
      ...current,
      processingStatus: to,
    });
    this.records[index] = next;
    return next;
  }
}
