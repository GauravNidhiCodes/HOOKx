import type { Instant } from "@hookx/domain";
import type { NormalizedWebhookEvent } from "@hookx/webhook";
import type { WebhookProcessingStatus } from "./status.js";

export type StoredWebhookEvent = {
  readonly id: string;
  readonly event: NormalizedWebhookEvent;
  readonly processingStatus: WebhookProcessingStatus;
  readonly createdAt: Instant;
};

export type StoreWebhookEventResult =
  | {
      readonly outcome: "STORED";
      readonly record: StoredWebhookEvent;
    }
  | {
      readonly outcome: "DUPLICATE";
      readonly record: StoredWebhookEvent;
    }
  | {
      readonly outcome: "CONFLICT";
      readonly existing: StoredWebhookEvent;
      readonly incoming: NormalizedWebhookEvent;
    };
