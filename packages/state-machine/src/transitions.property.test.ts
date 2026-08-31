import { describe, expect, it } from "vitest";
import {
  instant,
  isoCurrencyCode,
  paymentId,
  PAYMENT_STATES,
} from "@hookx/domain";
import { WEBHOOK_EVENT_TYPES, type WebhookEventType } from "@hookx/webhook";
import {
  syntheticPaymentAuthorized,
  syntheticPaymentCaptured,
  syntheticPaymentCreated,
  syntheticPaymentFailed,
  syntheticRefundCreated,
} from "@hookx/testkit";
import {
  createPayment,
  lookupTransition,
  processEvent,
  withProcessedEvent,
  type PaymentRecordState,
  type ProcessingHistory,
} from "./index.js";

const LATER = "2026-01-15T12:00:00.000Z";

const EVENT_FACTORY: Record<
  WebhookEventType,
  (occurredAt: string) => ReturnType<typeof syntheticPaymentCreated>
> = {
  "payment.created": (occurredAt) => syntheticPaymentCreated({ occurredAt }),
  "payment.authorized": (occurredAt) =>
    syntheticPaymentAuthorized({ occurredAt }),
  "payment.captured": (occurredAt) => syntheticPaymentCaptured({ occurredAt }),
  "payment.failed": (occurredAt) => syntheticPaymentFailed({ occurredAt }),
  "refund.created": (occurredAt) => syntheticRefundCreated({ occurredAt }),
};

const RECORD_STATES: PaymentRecordState[] = [null, ...PAYMENT_STATES];

function paymentAt(state: Exclude<PaymentRecordState, null>) {
  return createPayment({
    paymentId: paymentId("SYNTHETIC:pay:001"),
    state,
    amountMinor: 10000n,
    currency: isoCurrencyCode("INR"),
    lastOccurredAt: instant("2026-01-15T10:00:00.000Z"),
  });
}

describe("unsupported transitions are never accepted", () => {
  for (const from of RECORD_STATES) {
    for (const eventType of WEBHOOK_EVENT_TYPES) {
      const allowed = lookupTransition(from, eventType) !== null;
      if (allowed) {
        continue;
      }

      it(`${String(from)} + ${eventType} is not ACCEPTED`, () => {
        const payment = from === null ? null : paymentAt(from);
        const event = EVENT_FACTORY[eventType](LATER);
        const result = processEvent(payment, event, []);
        expect(result.status).not.toBe("ACCEPTED");
        expect(result.status).toBe("REJECTED");
      });
    }
  }
});

describe("duplicate delivery does not create additional transitions", () => {
  it("processing the same event repeatedly stays IGNORED_DUPLICATE after the first accept", () => {
    const event = syntheticPaymentCreated();
    const first = processEvent(null, event, []);
    expect(first.status).toBe("ACCEPTED");
    if (first.status !== "ACCEPTED") {
      return;
    }

    const history: ProcessingHistory = withProcessedEvent([], event);
    const payment = first.payment;

    for (let i = 0; i < 20; i += 1) {
      const result = processEvent(payment, event, history);
      expect(result.status).toBe("IGNORED_DUPLICATE");
      expect(result.payment?.state).toBe("CREATED");
      expect(history).toHaveLength(1);
    }

    expect(payment.state).toBe("CREATED");
  });
});
