import { describe, expect, it } from "vitest";
import { instant } from "@hookx/domain";
import {
  RAZORPAY_EVENT_ID_HEADER,
  RAZORPAY_FIXTURE_EVENT_ID,
  razorpayPaymentAuthorizedPayload,
  razorpayPaymentCapturedPayload,
  razorpayPaymentFailedPayload,
  razorpayProviderAdapter,
  razorpayRefundCreatedPayload,
} from "@hookx/webhook";
import { withProcessedEvent } from "./history.js";
import { processEvent } from "./process-event.js";
import { replayEvents } from "./replay.js";

const RECEIVED_AT = instant("2026-01-15T10:00:01.000Z");

function normalizeAuthorized(amount: number | string = 10000) {
  return razorpayProviderAdapter.normalize(
    razorpayPaymentAuthorizedPayload({ amount }),
    {
      receivedAt: RECEIVED_AT,
      headers: new Map([
        [RAZORPAY_EVENT_ID_HEADER, RAZORPAY_FIXTURE_EVENT_ID.AUTHORIZED],
      ]),
    },
  );
}

describe("Razorpay normalized events through the HOOKX engine", () => {
  it("does not invent payment.created; Razorpay-only authorized stays DELAYED", () => {
    const event = normalizeAuthorized();
    const replay = replayEvents([event]);
    expect(replay.payment).toBeNull();
    expect(replay.decisions).toEqual([
      expect.objectContaining({
        eventId: event.externalEventId,
        previousState: null,
        resultingState: null,
        decision: "DELAYED",
        reason: "AWAITING_PREREQUISITE",
      }),
    ]);
    expect(processEvent(null, event, []).status).toBe("REJECTED");
  });

  it("delays captured and failed Razorpay-only streams the same way", () => {
    const captured = razorpayProviderAdapter.normalize(
      razorpayPaymentCapturedPayload(),
      {
        receivedAt: RECEIVED_AT,
        headers: new Map([
          [RAZORPAY_EVENT_ID_HEADER, RAZORPAY_FIXTURE_EVENT_ID.CAPTURED],
        ]),
      },
    );
    const failed = razorpayProviderAdapter.normalize(
      razorpayPaymentFailedPayload(),
      {
        receivedAt: RECEIVED_AT,
        headers: new Map([
          [RAZORPAY_EVENT_ID_HEADER, RAZORPAY_FIXTURE_EVENT_ID.FAILED],
        ]),
      },
    );
    const refund = razorpayProviderAdapter.normalize(
      razorpayRefundCreatedPayload(),
      {
        receivedAt: RECEIVED_AT,
        headers: new Map([
          [RAZORPAY_EVENT_ID_HEADER, RAZORPAY_FIXTURE_EVENT_ID.REFUND_CREATED],
        ]),
      },
    );
    expect(replayEvents([captured]).payment).toBeNull();
    expect(replayEvents([failed]).payment).toBeNull();
    expect(replayEvents([refund]).payment).toBeNull();
    expect(replayEvents([captured]).decisions[0]?.decision).toBe("DELAYED");
    expect(replayEvents([failed]).decisions[0]?.decision).toBe("DELAYED");
    expect(replayEvents([refund]).decisions[0]?.decision).toBe("DELAYED");
  });

  it("classifies a second identical identity as IGNORED_DUPLICATE", () => {
    const event = normalizeAuthorized();
    const result = processEvent(null, event, withProcessedEvent([], event));
    expect(result.status).toBe("IGNORED_DUPLICATE");
    if (result.status === "IGNORED_DUPLICATE") {
      expect(result.payment).toBeNull();
    }
  });

  it("classifies same identity and different amount as CONFLICT without changing payment", () => {
    const original = normalizeAuthorized(10000);
    const conflicting = normalizeAuthorized(25000);
    expect(original.externalEventId).toBe(conflicting.externalEventId);
    expect(original.payloadHash).not.toBe(conflicting.payloadHash);
    const result = processEvent(
      null,
      conflicting,
      withProcessedEvent([], original),
    );
    expect(result.status).toBe("CONFLICT");
    if (result.status === "CONFLICT") {
      expect(result.existing.payloadHash).toBe(original.payloadHash);
      expect(result.incoming.payloadHash).toBe(conflicting.payloadHash);
      expect(result.payment).toBeNull();
    }
  });

  it("keeps occurredAt from the provider envelope when capture is delivered first", () => {
    const captured = razorpayProviderAdapter.normalize(
      razorpayPaymentCapturedPayload(),
      {
        receivedAt: RECEIVED_AT,
        headers: new Map([
          [RAZORPAY_EVENT_ID_HEADER, RAZORPAY_FIXTURE_EVENT_ID.CAPTURED],
        ]),
      },
    );
    const authorized = normalizeAuthorized();
    expect(captured.occurredAt > authorized.occurredAt).toBe(true);
    const replay = replayEvents([captured, authorized]);
    expect(replay.payment).toBeNull();
    expect(replay.delayed).toHaveLength(2);
  });
});
