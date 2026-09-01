import { describe, expect, it } from "vitest";
import { instant } from "@hookx/domain";
import { WebhookError } from "../errors.js";
import { normalizedEventKeys } from "../event.js";
import { headerValue } from "../signature/headers.js";
import { razorpayProviderAdapter } from "./adapter.js";
import {
  RAZORPAY_EVENT_ID_HEADER,
  RAZORPAY_PROVIDER_NAME,
} from "./constants.js";
import {
  RAZORPAY_FIXTURE_AMOUNT,
  RAZORPAY_FIXTURE_CAPTURED_OCCURRED_AT,
  RAZORPAY_FIXTURE_CURRENCY,
  RAZORPAY_FIXTURE_EVENT_ID,
  RAZORPAY_FIXTURE_FAILED_OCCURRED_AT,
  RAZORPAY_FIXTURE_OCCURRED_AT,
  RAZORPAY_FIXTURE_ORDER_ID,
  RAZORPAY_FIXTURE_PAYMENT_ID,
  RAZORPAY_FIXTURE_REFUND_ID,
  RAZORPAY_FIXTURE_REFUND_OCCURRED_AT,
  razorpayMalformedPayload,
  razorpayPaymentAuthorizedPayload,
  razorpayPaymentCapturedPayload,
  razorpayPaymentFailedPayload,
  razorpayRefundCreatedPayload,
  razorpayUnsupportedEventPayload,
} from "./fixtures.js";

const RECEIVED_AT = instant("2026-01-15T10:00:01.000Z");

function options(eventId: string) {
  return {
    receivedAt: RECEIVED_AT,
    headers: new Map([[RAZORPAY_EVENT_ID_HEADER, eventId]]),
  };
}

function expectWebhookError(code: string, run: () => void): void {
  try {
    run();
    throw new Error(`expected WebhookError ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(WebhookError);
    if (error instanceof WebhookError) {
      expect(error.code).toBe(code);
      expect(error.message).not.toContain("sk_live");
      expect(error.message).not.toContain("{");
    }
  }
}

describe("RazorpayProviderAdapter normalization", () => {
  it("maps payment.authorized onto HOOKX identifiers and money", () => {
    const payload = razorpayPaymentAuthorizedPayload();
    const event = razorpayProviderAdapter.normalize(
      payload,
      options(RAZORPAY_FIXTURE_EVENT_ID.AUTHORIZED),
    );
    const mapped = razorpayProviderAdapter.validate(
      payload,
      options(RAZORPAY_FIXTURE_EVENT_ID.AUTHORIZED),
    );
    expect(event.provider).toBe(RAZORPAY_PROVIDER_NAME);
    expect(event.externalEventId).toBe(RAZORPAY_FIXTURE_EVENT_ID.AUTHORIZED);
    expect(event.paymentId).toBe(RAZORPAY_FIXTURE_PAYMENT_ID);
    expect(event.eventType).toBe("payment.authorized");
    expect(event.amountMinor).toBe(BigInt(RAZORPAY_FIXTURE_AMOUNT));
    expect(event.currency).toBe(RAZORPAY_FIXTURE_CURRENCY);
    expect(event.occurredAt).toBe(RAZORPAY_FIXTURE_OCCURRED_AT);
    expect(event.receivedAt).toBe(RECEIVED_AT);
    expect(mapped.orderId).toBe(RAZORPAY_FIXTURE_ORDER_ID);
    expect(mapped.refundId).toBeNull();
    expect(event.paymentId).not.toBe(mapped.orderId);
    expect(event.externalEventId).not.toBe(event.paymentId);
    expect(Object.keys(event).sort()).toEqual([...normalizedEventKeys()].sort());
    expect(event).not.toHaveProperty("email");
    expect(event).not.toHaveProperty("notes");
    expect(payload.synthetic).toBe(true);
  });

  it("maps payment.captured", () => {
    const event = razorpayProviderAdapter.normalize(
      razorpayPaymentCapturedPayload(),
      options(RAZORPAY_FIXTURE_EVENT_ID.CAPTURED),
    );
    expect(event.eventType).toBe("payment.captured");
    expect(event.occurredAt).toBe(RAZORPAY_FIXTURE_CAPTURED_OCCURRED_AT);
    expect(event.receivedAt).toBe(RECEIVED_AT);
  });

  it("maps payment.failed", () => {
    const event = razorpayProviderAdapter.normalize(
      razorpayPaymentFailedPayload(),
      options(RAZORPAY_FIXTURE_EVENT_ID.FAILED),
    );
    expect(event.eventType).toBe("payment.failed");
    expect(event.occurredAt).toBe(RAZORPAY_FIXTURE_FAILED_OCCURRED_AT);
  });

  it("maps refund.created using refund amount and payment id", () => {
    const payload = razorpayRefundCreatedPayload();
    const event = razorpayProviderAdapter.normalize(
      payload,
      options(RAZORPAY_FIXTURE_EVENT_ID.REFUND_CREATED),
    );
    const mapped = razorpayProviderAdapter.validate(
      payload,
      options(RAZORPAY_FIXTURE_EVENT_ID.REFUND_CREATED),
    );
    expect(event.eventType).toBe("refund.created");
    expect(event.paymentId).toBe(RAZORPAY_FIXTURE_PAYMENT_ID);
    expect(event.amountMinor).toBe(50000n);
    expect(event.occurredAt).toBe(RAZORPAY_FIXTURE_REFUND_OCCURRED_AT);
    expect(mapped.refundId).toBe(RAZORPAY_FIXTURE_REFUND_ID);
    expect(mapped.orderId).toBe(RAZORPAY_FIXTURE_ORDER_ID);
    expect(event.paymentId).not.toBe(mapped.refundId);
  });

  it("uses the documented event-id header, not payment or order ids", () => {
    const mapped = razorpayProviderAdapter.validate(
      razorpayPaymentAuthorizedPayload(),
      options(RAZORPAY_FIXTURE_EVENT_ID.AUTHORIZED),
    );
    expect(mapped.externalEventId).toBe(RAZORPAY_FIXTURE_EVENT_ID.AUTHORIZED);
    expect(mapped.externalEventId).not.toBe(mapped.paymentId);
    expect(mapped.externalEventId).not.toBe(mapped.orderId);
    expect(
      headerValue(
        options(RAZORPAY_FIXTURE_EVENT_ID.AUTHORIZED).headers,
        RAZORPAY_EVENT_ID_HEADER,
      ),
    ).toBe(RAZORPAY_FIXTURE_EVENT_ID.AUTHORIZED);
  });

  it("rejects a missing event id header", () => {
    expectWebhookError("MISSING_EXTERNAL_ID", () => {
      razorpayProviderAdapter.normalize(razorpayPaymentAuthorizedPayload(), {
        receivedAt: RECEIVED_AT,
      });
    });
  });

  it("rejects malformed payloads after a valid envelope shape is required", () => {
    expectWebhookError("INVALID_PAYLOAD", () => {
      razorpayProviderAdapter.normalize(
        razorpayMalformedPayload(),
        options(RAZORPAY_FIXTURE_EVENT_ID.AUTHORIZED),
      );
    });
  });

  it("classifies unsupported Razorpay events without mapping them", () => {
    expectWebhookError("UNSUPPORTED_EVENT", () => {
      razorpayProviderAdapter.normalize(
        razorpayUnsupportedEventPayload(),
        options(RAZORPAY_FIXTURE_EVENT_ID.UNSUPPORTED),
      );
    });
  });

  it("does not treat a JSON number amount as a float", () => {
    const event = razorpayProviderAdapter.normalize(
      razorpayPaymentAuthorizedPayload({ amount: 29900 }),
      options(RAZORPAY_FIXTURE_EVENT_ID.AUTHORIZED),
    );
    expect(event.amountMinor).toBe(29900n);
    expect(typeof event.amountMinor).toBe("bigint");
  });
});
