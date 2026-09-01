import { describe, expect, it } from "vitest";
import {
  externalEventId,
  instant,
  isoCurrencyCode,
  paymentId,
  providerId,
} from "@hookx/domain";
import { createPayment } from "@hookx/state-machine";
import { storedPaymentFromReplay } from "./from-replay.js";

const NOW = instant("2026-01-15T10:00:01.000Z");
const PROVIDER = providerId("SYNTHETIC");
const PAYMENT_ID = paymentId("SYNTHETIC:pay:persist");

function replayWithCreated() {
  return {
    payment: createPayment({
      paymentId: PAYMENT_ID,
      state: "CREATED",
      amountMinor: 10000n,
      currency: isoCurrencyCode("INR"),
      lastOccurredAt: NOW,
    }),
    decisions: [],
    delayed: [],
    requiresInvestigation: false,
  };
}

describe("storedPaymentFromReplay", () => {
  it("maps an ACCEPTED replay payment onto a durable record", () => {
    const stored = storedPaymentFromReplay(
      replayWithCreated(),
      {
        paymentId: PAYMENT_ID,
        provider: PROVIDER,
        eventId: externalEventId("SYNTHETIC:evt:1"),
        previousState: null,
        resultingState: "CREATED",
        decision: "ACCEPTED",
        reason: "TRANSITION",
      },
      PROVIDER,
      NOW,
    );
    expect(stored).toMatchObject({
      provider: PROVIDER,
      paymentId: PAYMENT_ID,
      state: "CREATED",
      amountMinor: 10000n,
    });
  });

  it("does not persist payment state for DELAYED or CONFLICT decisions", () => {
    const replay = replayWithCreated();
    expect(
      storedPaymentFromReplay(
        replay,
        {
          paymentId: PAYMENT_ID,
          provider: PROVIDER,
          eventId: externalEventId("SYNTHETIC:evt:2"),
          previousState: "CREATED",
          resultingState: "CREATED",
          decision: "DELAYED",
          reason: "AWAITING_PREREQUISITE",
        },
        PROVIDER,
        NOW,
      ),
    ).toBeNull();
    expect(
      storedPaymentFromReplay(
        replay,
        {
          paymentId: PAYMENT_ID,
          provider: PROVIDER,
          eventId: externalEventId("SYNTHETIC:evt:3"),
          previousState: "CREATED",
          resultingState: "CREATED",
          decision: "CONFLICT",
          reason: "IMPOSSIBLE_AFTER_ORDERING",
        },
        PROVIDER,
        NOW,
      ),
    ).toBeNull();
  });
});
