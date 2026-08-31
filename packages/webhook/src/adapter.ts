import type { Instant, PaymentId, ProviderId } from "@hookx/domain";
import type { Money } from "@hookx/domain";
import type { PayloadHash } from "@hookx/domain";
import type { NormalizedWebhookEvent } from "./event.js";
import type { WebhookEventType } from "./event-type.js";
import type { WebhookIdentity } from "./identity.js";

export interface NormalizeOptions {
  readonly receivedAt: Instant;
}

export interface ProviderAdapter<TPayload> {
  readonly provider: ProviderId;
  validate(payload: unknown): TPayload;
  identify(payload: TPayload): WebhookIdentity;
  extractPaymentId(payload: TPayload): PaymentId;
  extractOccurredAt(payload: TPayload): Instant;
  extractMoney(payload: TPayload): Money;
  mapEventType(payload: TPayload): WebhookEventType;
  hashPayload(payload: TPayload): PayloadHash;
  normalize(payload: unknown, options: NormalizeOptions): NormalizedWebhookEvent;
}
