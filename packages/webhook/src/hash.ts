import { createHash } from "node:crypto";
import { payloadHash, type PayloadHash } from "@hookx/domain";

export interface CanonicalPayloadFields {
  readonly provider: string;
  readonly externalEventId: string;
  readonly providerEventName: string;
  readonly paymentId: string;
  readonly occurredAt: string;
  readonly amountMinor: string;
  readonly currency: string;
}

export function canonicalPayloadDocument(fields: CanonicalPayloadFields): string {
  return JSON.stringify({
    amountMinor: fields.amountMinor,
    currency: fields.currency,
    externalEventId: fields.externalEventId,
    occurredAt: fields.occurredAt,
    paymentId: fields.paymentId,
    provider: fields.provider,
    providerEventName: fields.providerEventName,
  });
}

export function hashCanonicalPayload(fields: CanonicalPayloadFields): PayloadHash {
  const digest = createHash("sha256")
    .update(canonicalPayloadDocument(fields), "utf8")
    .digest("hex");
  return payloadHash(digest);
}
