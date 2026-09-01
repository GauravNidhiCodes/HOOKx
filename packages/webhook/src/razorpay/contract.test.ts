import { describe, expect, it } from "vitest";
import { instant } from "@hookx/domain";
import { hashCanonicalPayload } from "../hash.js";
import { normalizedEventKeys } from "../event.js";
import { WebhookError } from "../errors.js";
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
  RAZORPAY_FIXTURE_PAYMENT_ID,
  RAZORPAY_FIXTURE_REFUND_OCCURRED_AT,
  razorpayMalformedPayload,
  razorpayMissingPaymentIdPayload,
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

function expectedHash(input: {
  readonly externalEventId: string;
  readonly providerEventName: string;
  readonly paymentId: string;
  readonly occurredAt: string;
  readonly amountMinor: string;
  readonly currency?: string;
}) {
  return hashCanonicalPayload({
    provider: RAZORPAY_PROVIDER_NAME,
    externalEventId: input.externalEventId,
    providerEventName: input.providerEventName,
    paymentId: input.paymentId,
    occurredAt: input.occurredAt,
    amountMinor: input.amountMinor,
    currency: input.currency ?? RAZORPAY_FIXTURE_CURRENCY,
  });
}

describe("Razorpay adapter contract: fixture → normalized event", () => {
  it("golden: payment.authorized", () => {
    const payload = razorpayPaymentAuthorizedPayload();
    const event = razorpayProviderAdapter.normalize(
      payload,
      options(RAZORPAY_FIXTURE_EVENT_ID.AUTHORIZED),
    );
    const again = razorpayProviderAdapter.normalize(
      payload,
      options(RAZORPAY_FIXTURE_EVENT_ID.AUTHORIZED),
    );
    expect(event).toEqual({
      provider: RAZORPAY_PROVIDER_NAME,
      externalEventId: RAZORPAY_FIXTURE_EVENT_ID.AUTHORIZED,
      paymentId: RAZORPAY_FIXTURE_PAYMENT_ID,
      eventType: "payment.authorized",
      occurredAt: RAZORPAY_FIXTURE_OCCURRED_AT,
      receivedAt: RECEIVED_AT,
      amountMinor: BigInt(RAZORPAY_FIXTURE_AMOUNT),
      currency: RAZORPAY_FIXTURE_CURRENCY,
      payloadHash: expectedHash({
        externalEventId: RAZORPAY_FIXTURE_EVENT_ID.AUTHORIZED,
        providerEventName: "payment.authorized",
        paymentId: RAZORPAY_FIXTURE_PAYMENT_ID,
        occurredAt: RAZORPAY_FIXTURE_OCCURRED_AT,
        amountMinor: String(RAZORPAY_FIXTURE_AMOUNT),
      }),
    });
    expect(again).toEqual(event);
    expect(event.occurredAt).not.toBe(event.receivedAt);
    expect(payload.synthetic).toBe(true);
    expect(Object.keys(event).sort()).toEqual([...normalizedEventKeys()].sort());
  });

  it("golden: payment.captured", () => {
    const payload = razorpayPaymentCapturedPayload();
    const event = razorpayProviderAdapter.normalize(
      payload,
      options(RAZORPAY_FIXTURE_EVENT_ID.CAPTURED),
    );
    expect(event).toEqual({
      provider: RAZORPAY_PROVIDER_NAME,
      externalEventId: RAZORPAY_FIXTURE_EVENT_ID.CAPTURED,
      paymentId: RAZORPAY_FIXTURE_PAYMENT_ID,
      eventType: "payment.captured",
      occurredAt: RAZORPAY_FIXTURE_CAPTURED_OCCURRED_AT,
      receivedAt: RECEIVED_AT,
      amountMinor: BigInt(RAZORPAY_FIXTURE_AMOUNT),
      currency: RAZORPAY_FIXTURE_CURRENCY,
      payloadHash: expectedHash({
        externalEventId: RAZORPAY_FIXTURE_EVENT_ID.CAPTURED,
        providerEventName: "payment.captured",
        paymentId: RAZORPAY_FIXTURE_PAYMENT_ID,
        occurredAt: RAZORPAY_FIXTURE_CAPTURED_OCCURRED_AT,
        amountMinor: String(RAZORPAY_FIXTURE_AMOUNT),
      }),
    });
    expect(payload.synthetic).toBe(true);
  });

  it("golden: payment.failed", () => {
    const payload = razorpayPaymentFailedPayload();
    const event = razorpayProviderAdapter.normalize(
      payload,
      options(RAZORPAY_FIXTURE_EVENT_ID.FAILED),
    );
    expect(event).toEqual({
      provider: RAZORPAY_PROVIDER_NAME,
      externalEventId: RAZORPAY_FIXTURE_EVENT_ID.FAILED,
      paymentId: RAZORPAY_FIXTURE_PAYMENT_ID,
      eventType: "payment.failed",
      occurredAt: RAZORPAY_FIXTURE_FAILED_OCCURRED_AT,
      receivedAt: RECEIVED_AT,
      amountMinor: BigInt(RAZORPAY_FIXTURE_AMOUNT),
      currency: RAZORPAY_FIXTURE_CURRENCY,
      payloadHash: expectedHash({
        externalEventId: RAZORPAY_FIXTURE_EVENT_ID.FAILED,
        providerEventName: "payment.failed",
        paymentId: RAZORPAY_FIXTURE_PAYMENT_ID,
        occurredAt: RAZORPAY_FIXTURE_FAILED_OCCURRED_AT,
        amountMinor: String(RAZORPAY_FIXTURE_AMOUNT),
      }),
    });
    expect(payload.synthetic).toBe(true);
  });

  it("golden: refund.created uses refund amount and payment_id", () => {
    const payload = razorpayRefundCreatedPayload();
    const event = razorpayProviderAdapter.normalize(
      payload,
      options(RAZORPAY_FIXTURE_EVENT_ID.REFUND_CREATED),
    );
    expect(event).toEqual({
      provider: RAZORPAY_PROVIDER_NAME,
      externalEventId: RAZORPAY_FIXTURE_EVENT_ID.REFUND_CREATED,
      paymentId: RAZORPAY_FIXTURE_PAYMENT_ID,
      eventType: "refund.created",
      occurredAt: RAZORPAY_FIXTURE_REFUND_OCCURRED_AT,
      receivedAt: RECEIVED_AT,
      amountMinor: 50000n,
      currency: RAZORPAY_FIXTURE_CURRENCY,
      payloadHash: expectedHash({
        externalEventId: RAZORPAY_FIXTURE_EVENT_ID.REFUND_CREATED,
        providerEventName: "refund.created",
        paymentId: RAZORPAY_FIXTURE_PAYMENT_ID,
        occurredAt: RAZORPAY_FIXTURE_REFUND_OCCURRED_AT,
        amountMinor: "50000",
      }),
    });
    expect(payload.synthetic).toBe(true);
  });

  it("maps an integer amount string to the same hash as the JSON number", () => {
    const fromNumber = razorpayProviderAdapter.normalize(
      razorpayPaymentAuthorizedPayload({ amount: 10000 }),
      options(RAZORPAY_FIXTURE_EVENT_ID.AUTHORIZED),
    );
    const fromString = razorpayProviderAdapter.normalize(
      razorpayPaymentAuthorizedPayload({ amount: "10000" }),
      options(RAZORPAY_FIXTURE_EVENT_ID.AUTHORIZED),
    );
    expect(fromString.amountMinor).toBe(10000n);
    expect(fromString.payloadHash).toBe(fromNumber.payloadHash);
  });

  it("does not treat current time as event occurrence", () => {
    const event = razorpayProviderAdapter.normalize(
      razorpayPaymentAuthorizedPayload(),
      options(RAZORPAY_FIXTURE_EVENT_ID.AUTHORIZED),
    );
    expect(event.occurredAt).toBe(RAZORPAY_FIXTURE_OCCURRED_AT);
    expect(event.receivedAt).toBe(RECEIVED_AT);
    expect(event.occurredAt < event.receivedAt).toBe(true);
  });
});

describe("Razorpay adapter contract: negative normalization", () => {
  function expectCode(code: string, run: () => void): void {
    try {
      run();
      throw new Error(`expected WebhookError ${code}`);
    } catch (error) {
      expect(error).toBeInstanceOf(WebhookError);
      if (error instanceof WebhookError) {
        expect(error.code).toBe(code);
      }
    }
  }

  it("rejects unsupported events as UNSUPPORTED_EVENT", () => {
    expectCode("UNSUPPORTED_EVENT", () => {
      razorpayProviderAdapter.normalize(
        razorpayUnsupportedEventPayload(),
        options(RAZORPAY_FIXTURE_EVENT_ID.UNSUPPORTED),
      );
    });
  });

  it("rejects a missing event id", () => {
    expectCode("MISSING_EXTERNAL_ID", () => {
      razorpayProviderAdapter.normalize(razorpayPaymentAuthorizedPayload(), {
        receivedAt: RECEIVED_AT,
      });
    });
  });

  it("rejects a missing payment id", () => {
    expectCode("MISSING_PAYMENT_ID", () => {
      razorpayProviderAdapter.normalize(
        razorpayMissingPaymentIdPayload(),
        options(RAZORPAY_FIXTURE_EVENT_ID.AUTHORIZED),
      );
    });
  });

  it("rejects an invalid amount", () => {
    expectCode("INVALID_AMOUNT", () => {
      razorpayProviderAdapter.normalize(
        razorpayPaymentAuthorizedPayload({ amount: 10.5 }),
        options(RAZORPAY_FIXTURE_EVENT_ID.AUTHORIZED),
      );
    });
  });

  it("rejects an invalid currency", () => {
    expectCode("INVALID_CURRENCY", () => {
      razorpayProviderAdapter.normalize(
        razorpayPaymentAuthorizedPayload({ currency: "IN" }),
        options(RAZORPAY_FIXTURE_EVENT_ID.AUTHORIZED),
      );
    });
  });

  it("rejects malformed JSON shape", () => {
    expectCode("INVALID_PAYLOAD", () => {
      razorpayProviderAdapter.normalize(
        razorpayMalformedPayload(),
        options(RAZORPAY_FIXTURE_EVENT_ID.AUTHORIZED),
      );
    });
  });
});
