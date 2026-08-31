import type { WebhookIdentity } from "@hookx/webhook";
import type { NormalizedWebhookEvent } from "@hookx/webhook";
import type { StoredWebhookEvent, StoreWebhookEventResult } from "./types.js";

export interface WebhookEventRepository {
  store(event: NormalizedWebhookEvent): Promise<StoreWebhookEventResult>;
  findByIdentity(identity: WebhookIdentity): Promise<StoredWebhookEvent | null>;
  findById(id: string): Promise<StoredWebhookEvent | null>;
  markProcessing(id: string): Promise<StoredWebhookEvent>;
  markProcessed(id: string): Promise<StoredWebhookEvent>;
  markRejected(id: string): Promise<StoredWebhookEvent>;
  markConflict(id: string): Promise<StoredWebhookEvent>;
}
