import {
  DomainError,
  type ExternalEventId,
  type ProviderId,
} from "@hookx/domain";

export type WebhookIdentityKey = string & { readonly __brand: "WebhookIdentityKey" };

export interface WebhookIdentity {
  readonly provider: ProviderId;
  readonly externalEventId: ExternalEventId;
}

export function webhookIdentityKey(
  provider: ProviderId,
  externalEventId: ExternalEventId,
): WebhookIdentityKey {
  if (typeof provider !== "string" || typeof externalEventId !== "string") {
    throw new DomainError(
      "INVALID_WEBHOOK_IDENTITY",
      "webhook identity requires provider and externalEventId",
    );
  }
  return JSON.stringify({
    provider,
    externalEventId,
  }) as WebhookIdentityKey;
}

export function identitiesEqual(
  left: WebhookIdentity,
  right: WebhookIdentity,
): boolean {
  return (
    webhookIdentityKey(left.provider, left.externalEventId) ===
    webhookIdentityKey(right.provider, right.externalEventId)
  );
}
