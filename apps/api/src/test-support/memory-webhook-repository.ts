import { randomUUID } from "node:crypto";
import type { PaymentId, ProviderId } from "@hookx/domain";
import type {
  StoredWebhookEvent,
  StoreWebhookEventResult,
  WebhookEventRepository,
} from "@hookx/storage";
import { StorageError } from "@hookx/storage";
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

  public async listByPayment(
    provider: ProviderId,
    paymentId: PaymentId,
  ): Promise<readonly StoredWebhookEvent[]> {
    return this.records.filter(
      (row) =>
        row.event.provider === provider && row.event.paymentId === paymentId,
    );
  }

  public async markProcessing(_id: string): Promise<StoredWebhookEvent> {
    throw new StorageError("INVALID_STATUS_TRANSITION", "not used in ingest tests");
  }

  public async markProcessed(_id: string): Promise<StoredWebhookEvent> {
    throw new StorageError("INVALID_STATUS_TRANSITION", "not used in ingest tests");
  }

  public async markRejected(_id: string): Promise<StoredWebhookEvent> {
    throw new StorageError("INVALID_STATUS_TRANSITION", "not used in ingest tests");
  }

  public async markConflict(_id: string): Promise<StoredWebhookEvent> {
    throw new StorageError("INVALID_STATUS_TRANSITION", "not used in ingest tests");
  }
}
