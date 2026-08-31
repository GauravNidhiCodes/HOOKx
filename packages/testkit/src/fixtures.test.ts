import { describe, expect, it } from "vitest";
import { normalizedEventKeys } from "@hookx/webhook";
import {
  SYNTHETIC,
  SYNTHETIC_FIXTURES,
  syntheticPaymentAuthorized,
  syntheticPaymentCaptured,
  syntheticPaymentCreated,
  syntheticPaymentFailed,
  syntheticRefundCreated,
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
