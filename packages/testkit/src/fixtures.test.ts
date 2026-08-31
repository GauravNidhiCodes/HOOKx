import { describe, expect, it } from "vitest";
import { normalizedEventKeys } from "@hookx/webhook";
import {
  SYNTHETIC,
  SYNTHETIC_FIXTURES,
  SYNTHETIC_PROVIDER_PAYLOADS,
  duplicateConflictingSyntheticPayloads,
  duplicateIdenticalSyntheticPayloads,
  syntheticDeclinedPayload,
  syntheticHoldPayload,
  syntheticOpenedPayload,
  syntheticPaymentAuthorized,
  syntheticPaymentCaptured,
  syntheticPaymentCreated,
  syntheticPaymentFailed,
  syntheticRefundCreated,
  syntheticReturnPayload,
  syntheticSettledPayload,
} from "./index.js";

describe("synthetic fixtures", () => {
  it("marks every fixture as SYNTHETIC", () => {
    const events = [
      syntheticPaymentCreated(),
      syntheticPaymentAuthorized(),
      syntheticPaymentCaptured(),
      syntheticPaymentFailed(),
      syntheticRefundCreated(),
    ];

    for (const event of events) {
      expect(event.provider).toContain(SYNTHETIC);
      expect(event.externalEventId).toContain(SYNTHETIC);
      expect(event.paymentId).toContain(SYNTHETIC);
      expect(event.payloadHash).toContain(SYNTHETIC);
    }
  });

  it("covers the initial event set", () => {
    expect(Object.keys(SYNTHETIC_FIXTURES).sort()).toEqual(
      [
        "payment.authorized",
        "payment.captured",
        "payment.created",
        "payment.failed",
        "refund.created",
      ].sort(),
    );
  });

  it("never includes customer-identifying fields", () => {
    const event = syntheticPaymentCreated();
    const serialized = JSON.stringify(event, (_key, value: unknown) => {
      if (typeof value === "bigint") {
        return value.toString();
      }
      return value;
    });
    expect(serialized).not.toMatch(/@/);
    expect(serialized.toLowerCase()).not.toContain("customer");
    expect(Object.keys(event).sort()).toEqual([...normalizedEventKeys()].sort());
  });
});

describe("synthetic provider payloads", () => {
  it("labels every provider fixture as SYNTHETIC", () => {
    const payloads = [
      syntheticOpenedPayload(),
      syntheticHoldPayload(),
      syntheticSettledPayload(),
      syntheticDeclinedPayload(),
      syntheticReturnPayload(),
      ...duplicateIdenticalSyntheticPayloads(),
      ...duplicateConflictingSyntheticPayloads(),
    ];

    for (const payload of payloads) {
      expect(payload.infrastructure).toBe(SYNTHETIC);
      expect(payload.event_ref).toContain(SYNTHETIC);
      expect(payload.entity.payment_ref).toContain(SYNTHETIC);
    }
  });

  it("covers valid, invalid, duplicate, and conflicting envelopes", () => {
    expect(Object.keys(SYNTHETIC_PROVIDER_PAYLOADS).sort()).toEqual(
      [
        "duplicateConflicting",
        "duplicateIdentical",
        "invalidAmount",
        "invalidCurrency",
        "invalidTimestamp",
        "malformed",
        "payment.authorized",
        "payment.captured",
        "payment.created",
        "payment.failed",
        "refund.created",
        "unknownEvent",
      ].sort(),
    );
  });
});
