import { describe, expect, it } from "vitest";
import { DomainError } from "@hookx/domain";
import {
  createNormalizedWebhookEvent,
  normalizedEventKeys,
  type NormalizedWebhookEventInput,
} from "./event.js";

const BASE_INPUT: NormalizedWebhookEventInput = {
  provider: "SYNTHETIC",
  externalEventId: "SYNTHETIC:evt:001",
  paymentId: "SYNTHETIC:pay:001",
  eventType: "payment.created",
  occurredAt: "2026-01-15T10:00:00.000Z",
  receivedAt: "2026-01-15T10:00:01.000Z",
  amountMinor: 10000n,
  currency: "INR",
  payloadHash: "SYNTHETIC:hash:001",
};

describe("provider isolation", () => {
  it("copies only the normalized contract fields", () => {
    const providerShaped = {
      ...BASE_INPUT,
      razorpayEvent: "payment.authorized",
      payload: { notes: { customer_email: "hidden@example.com" } },
      signature: "rzp_sig_placeholder",
    };

    const event = createNormalizedWebhookEvent(providerShaped);

    expect(Object.keys(event).sort()).toEqual([...normalizedEventKeys()].sort());
    expect(event).not.toHaveProperty("razorpayEvent");
    expect(event).not.toHaveProperty("payload");
    expect(event).not.toHaveProperty("signature");
  });

  it("does not accept provider-specific event names", () => {
    expect(() =>
      createNormalizedWebhookEvent({
        ...BASE_INPUT,
        eventType: "razorpay.payment.authorized",
      }),
    ).toThrow(DomainError);
  });

  it("keeps amountMinor as bigint on the normalized event", () => {
    const event = createNormalizedWebhookEvent(BASE_INPUT);
    expect(typeof event.amountMinor).toBe("bigint");
    expect(event.amountMinor).toBe(10000n);
    expect(event.currency).toBe("INR");
  });
});
