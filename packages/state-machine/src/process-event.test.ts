import { describe, expect, it } from "vitest";
import {
  instant,
  isoCurrencyCode,
  paymentId,
  type PaymentState,
} from "@hookx/domain";
import { eventIdentityKey } from "@hookx/webhook";
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
  type Payment,
  type ProcessingHistory,
  type TransitionResult,
  TRANSITION_TABLE,
} from "./index.js";

function emptyHistory(): ProcessingHistory {
  return [];
}

function expectAccepted(
  result: TransitionResult,
): asserts result is Extract<TransitionResult, { status: "ACCEPTED" }> {
  expect(result.status).toBe("ACCEPTED");
}

function accept(
  payment: Payment | null,
  event: Parameters<typeof processEvent>[1],
  history: ProcessingHistory,
): { payment: Payment; history: ProcessingHistory } {
  const result = processEvent(payment, event, history);
  expectAccepted(result);
  return {
    payment: result.payment,
    history: withProcessedEvent(history, event),
  };
}

describe("valid transitions", () => {
  it("CREATED → AUTHORIZED", () => {
    const created = syntheticPaymentCreated();
    const authorized = syntheticPaymentAuthorized({
      occurredAt: "2026-01-15T10:00:02.000Z",
    });
    const afterCreate = accept(null, created, emptyHistory());
    const result = processEvent(
      afterCreate.payment,
      authorized,
      afterCreate.history,
    );
    expect(result).toMatchObject({
      status: "ACCEPTED",
      from: "CREATED",
      to: "AUTHORIZED",
    });
  });

  it("CREATED → FAILED", () => {
    const created = syntheticPaymentCreated();
    const failed = syntheticPaymentFailed({
      occurredAt: "2026-01-15T10:00:02.000Z",
    });
    const afterCreate = accept(null, created, emptyHistory());
    const result = processEvent(afterCreate.payment, failed, afterCreate.history);
    expectAccepted(result);
    expect(result.to).toBe("FAILED");
  });

  it("AUTHORIZED → CAPTURED", () => {
    const afterCreate = accept(null, syntheticPaymentCreated(), emptyHistory());
    const afterAuth = accept(
      afterCreate.payment,
      syntheticPaymentAuthorized({ occurredAt: "2026-01-15T10:00:02.000Z" }),
      afterCreate.history,
    );
    const result = processEvent(
      afterAuth.payment,
      syntheticPaymentCaptured({ occurredAt: "2026-01-15T10:00:03.000Z" }),
      afterAuth.history,
    );
    expectAccepted(result);
    expect(result.from).toBe("AUTHORIZED");
    expect(result.to).toBe("CAPTURED");
  });

  it("AUTHORIZED → FAILED", () => {
    const afterCreate = accept(null, syntheticPaymentCreated(), emptyHistory());
    const afterAuth = accept(
      afterCreate.payment,
      syntheticPaymentAuthorized({ occurredAt: "2026-01-15T10:00:02.000Z" }),
      afterCreate.history,
    );
    const result = processEvent(
      afterAuth.payment,
      syntheticPaymentFailed({ occurredAt: "2026-01-15T10:00:03.000Z" }),
      afterAuth.history,
    );
    expectAccepted(result);
    expect(result.to).toBe("FAILED");
  });

  it("CAPTURED → REFUNDED", () => {
    const afterCreate = accept(null, syntheticPaymentCreated(), emptyHistory());
    const afterAuth = accept(
      afterCreate.payment,
      syntheticPaymentAuthorized({ occurredAt: "2026-01-15T10:00:02.000Z" }),
      afterCreate.history,
    );
    const afterCapture = accept(
      afterAuth.payment,
      syntheticPaymentCaptured({ occurredAt: "2026-01-15T10:00:03.000Z" }),
      afterAuth.history,
    );
    const result = processEvent(
      afterCapture.payment,
      syntheticRefundCreated({ occurredAt: "2026-01-15T10:00:04.000Z" }),
      afterCapture.history,
    );
    expectAccepted(result);
    expect(result.from).toBe("CAPTURED");
    expect(result.to).toBe("REFUNDED");
  });
});

describe("invalid transitions", () => {
  it("rejects CAPTURED → AUTHORIZED", () => {
    const payment = createPayment({
      paymentId: paymentId("SYNTHETIC:pay:001"),
      state: "CAPTURED",
      amountMinor: 10000n,
      currency: isoCurrencyCode("INR"),
      lastOccurredAt: instant("2026-01-15T10:00:00.000Z"),
    });
    const result = processEvent(
      payment,
      syntheticPaymentAuthorized({
        occurredAt: "2026-01-15T10:00:05.000Z",
      }),
      emptyHistory(),
    );
    expect(result).toMatchObject({
      status: "REJECTED",
      reason: "INVALID_TRANSITION",
      from: "CAPTURED",
      eventType: "payment.authorized",
    });
  });

  it("rejects unspecified transitions instead of applying them", () => {
    expect(lookupTransition("CAPTURED", "payment.authorized")).toBeNull();
    expect(lookupTransition("REFUNDED", "payment.captured")).toBeNull();
    expect(lookupTransition("FAILED", "payment.captured")).toBeNull();
    expect(lookupTransition("CREATED", "payment.captured")).toBeNull();
  });

  it("rejects terminal-state transitions from FAILED and REFUNDED", () => {
    for (const state of ["FAILED", "REFUNDED"] as const) {
      const payment = createPayment({
        paymentId: paymentId("SYNTHETIC:pay:001"),
        state,
        amountMinor: 10000n,
        currency: isoCurrencyCode("INR"),
        lastOccurredAt: instant("2026-01-15T10:00:00.000Z"),
      });
      const result = processEvent(
        payment,
        syntheticPaymentCaptured({
          occurredAt: "2026-01-15T10:00:05.000Z",
        }),
        emptyHistory(),
      );
      expect(result.status).toBe("REJECTED");
      if (result.status === "REJECTED") {
        expect(result.reason).toBe("INVALID_TRANSITION");
        expect(result.payment?.state).toBe(state);
      }
    }
  });

  it("does not mutate payment or history on rejection", () => {
    const payment = createPayment({
      paymentId: paymentId("SYNTHETIC:pay:001"),
      state: "CREATED",
      amountMinor: 10000n,
      currency: isoCurrencyCode("INR"),
      lastOccurredAt: instant("2026-01-15T10:00:00.000Z"),
    });
    const history = emptyHistory();
    processEvent(
      payment,
      syntheticPaymentCaptured({ occurredAt: "2026-01-15T10:00:05.000Z" }),
      history,
    );
    expect(payment.state).toBe("CREATED");
    expect(history).toHaveLength(0);
  });
});

describe("duplicate webhook identity", () => {
  it("returns IGNORED_DUPLICATE for the same provider + externalEventId", () => {
    const event = syntheticPaymentAuthorized({
      occurredAt: "2026-01-15T10:00:02.000Z",
    });
    const afterCreate = accept(null, syntheticPaymentCreated(), emptyHistory());
    const first = processEvent(afterCreate.payment, event, afterCreate.history);
    expectAccepted(first);

    const second = processEvent(
      first.payment,
      event,
      withProcessedEvent(afterCreate.history, event),
    );
    expect(second).toEqual({
      status: "IGNORED_DUPLICATE",
      identityKey: eventIdentityKey(event),
      payment: first.payment,
    });
  });

  it("does not produce a second state transition on redelivery", () => {
    const event = syntheticPaymentCreated();
    const first = processEvent(null, event, emptyHistory());
    expectAccepted(first);
    const second = processEvent(
      first.payment,
      event,
      withProcessedEvent(emptyHistory(), event),
    );
    expect(second.status).toBe("IGNORED_DUPLICATE");
    expect(second).not.toHaveProperty("to");
    expect(first.payment.state).toBe("CREATED");
  });

  it("treats a later receivedAt as the same delivery when material fields match", () => {
    const event = syntheticPaymentCreated();
    const redelivery = syntheticPaymentCreated({
      receivedAt: "2026-01-16T00:00:00.000Z",
    });
    const first = processEvent(null, event, emptyHistory());
    expectAccepted(first);
    const second = processEvent(
      first.payment,
      redelivery,
      withProcessedEvent(emptyHistory(), event),
    );
    expect(second.status).toBe("IGNORED_DUPLICATE");
  });
});

describe("conflicting duplicate webhook", () => {
  it("returns CONFLICT when identity matches but contents differ", () => {
    const original = syntheticPaymentAuthorized({
      occurredAt: "2026-01-15T10:00:02.000Z",
      payloadHash: "SYNTHETIC:hash:payment.authorized",
    });
    const conflicting = syntheticPaymentAuthorized({
      occurredAt: "2026-01-15T10:00:02.000Z",
      amountMinor: 999n,
      payloadHash: "SYNTHETIC:hash:payment.authorized.altered",
    });
    const afterCreate = accept(null, syntheticPaymentCreated(), emptyHistory());
    const first = processEvent(
      afterCreate.payment,
      original,
      afterCreate.history,
    );
    expectAccepted(first);

    const result = processEvent(
      first.payment,
      conflicting,
      withProcessedEvent(afterCreate.history, original),
    );
    expect(result.status).toBe("CONFLICT");
    if (result.status === "CONFLICT") {
      expect(result.identityKey).toBe(eventIdentityKey(original));
      expect(result.existing.payloadHash).toBe(original.payloadHash);
      expect(result.incoming.payloadHash).toBe(conflicting.payloadHash);
      expect(result.incoming.amountMinor).toBe(999n);
      expect(result.payment?.state).toBe("AUTHORIZED");
    }
  });

  it("does not overwrite the original processed event", () => {
    const original = syntheticPaymentCreated();
    const conflicting = syntheticPaymentCreated({
      payloadHash: "SYNTHETIC:hash:other",
    });
    const history = withProcessedEvent(emptyHistory(), original);
    const first = processEvent(null, original, emptyHistory());
    expectAccepted(first);
    processEvent(first.payment, conflicting, history);
    expect(history).toHaveLength(1);
    expect(history[0]?.payloadHash).toBe(original.payloadHash);
    expect(first.payment.amountMinor).toBe(original.amountMinor);
  });
});

describe("webhook identity isolation", () => {
  it("does not treat different providers with the same external ID as duplicates", () => {
    const synthetic = syntheticPaymentCreated({
      externalEventId: "shared-external-id",
    });
    const other = syntheticPaymentCreated({
      provider: "OTHER-PROVIDER",
      externalEventId: "shared-external-id",
      payloadHash: "SYNTHETIC:hash:other-provider",
    });
    const first = processEvent(null, synthetic, emptyHistory());
    expectAccepted(first);
    const second = processEvent(
      null,
      other,
      withProcessedEvent(emptyHistory(), synthetic),
    );
    expect(second.status).toBe("ACCEPTED");
    expect(eventIdentityKey(synthetic)).not.toBe(eventIdentityKey(other));
  });

  it("does not treat the same provider with different external IDs as duplicates", () => {
    const created = syntheticPaymentCreated({
      externalEventId: "SYNTHETIC:evt:one",
    });
    const authorized = syntheticPaymentAuthorized({
      externalEventId: "SYNTHETIC:evt:two",
      occurredAt: "2026-01-15T10:00:02.000Z",
    });
    const afterCreate = accept(null, created, emptyHistory());
    const result = processEvent(
      afterCreate.payment,
      authorized,
      afterCreate.history,
    );
    expect(result.status).toBe("ACCEPTED");
    expect(eventIdentityKey(created)).not.toBe(eventIdentityKey(authorized));
  });
});

describe("event timestamp preservation", () => {
  it("uses occurredAt from the event and does not invent a clock reading", () => {
    const occurredAt = "2024-03-01T00:00:00.000Z";
    const receivedAt = "2024-03-01T00:00:05.000Z";
    const event = syntheticPaymentCreated({ occurredAt, receivedAt });
    const result = processEvent(null, event, emptyHistory());
    expectAccepted(result);
    expect(event.occurredAt).toBe(occurredAt);
    expect(event.receivedAt).toBe(receivedAt);
    expect(result.payment.lastOccurredAt).toBe(occurredAt);
  });

  it("does not delay an event that occurred at the same instant", () => {
    const created = syntheticPaymentCreated({
      occurredAt: "2026-01-15T10:00:00.000Z",
    });
    const first = processEvent(null, created, emptyHistory());
    expectAccepted(first);
    const result = processEvent(
      first.payment,
      syntheticPaymentAuthorized({
        occurredAt: "2026-01-15T10:00:00.000Z",
      }),
      withProcessedEvent(emptyHistory(), created),
    );
    expect(result.status).toBe("ACCEPTED");
  });

  it("returns DELAYED when occurredAt is before the payment's lastOccurredAt", () => {
    const created = syntheticPaymentCreated({
      occurredAt: "2026-01-15T10:00:10.000Z",
    });
    const first = processEvent(null, created, emptyHistory());
    expectAccepted(first);
    const late = syntheticPaymentAuthorized({
      occurredAt: "2026-01-15T10:00:01.000Z",
    });
    const result = processEvent(
      first.payment,
      late,
      withProcessedEvent(emptyHistory(), created),
    );
    expect(result).toMatchObject({
      status: "DELAYED",
      reason: "OUT_OF_ORDER",
      eventOccurredAt: "2026-01-15T10:00:01.000Z",
      lastOccurredAt: "2026-01-15T10:00:10.000Z",
    });
    expect(first.payment.state).toBe("CREATED");
  });
});

describe("bigint amount preservation", () => {
  it("keeps amountMinor as bigint and does not convert it to number", () => {
    const amountMinor = 9007199254740993n;
    const event = syntheticPaymentCreated({
      amountMinor,
      payloadHash: "SYNTHETIC:hash:large-amount",
    });
    const result = processEvent(null, event, emptyHistory());
    expectAccepted(result);
    expect(typeof result.payment.amountMinor).toBe("bigint");
    expect(result.payment.amountMinor).toBe(amountMinor);
    expect(result.payment.amountMinor).not.toBe(
      BigInt(Number(amountMinor)),
    );
  });

  it("carries payment money through later transitions unchanged", () => {
    const created = syntheticPaymentCreated({ amountMinor: 10000n });
    const afterCreate = accept(null, created, emptyHistory());
    const authorized = syntheticPaymentAuthorized({
      occurredAt: "2026-01-15T10:00:02.000Z",
      amountMinor: 50n,
    });
    const result = processEvent(
      afterCreate.payment,
      authorized,
      afterCreate.history,
    );
    expectAccepted(result);
    expect(result.payment.amountMinor).toBe(10000n);
    expect(typeof result.payment.amountMinor).toBe("bigint");
  });
});

describe("immutability", () => {
  it("does not mutate the incoming event or history", () => {
    const event = syntheticPaymentCreated();
    const history: ProcessingHistory = [];
    const result = processEvent(null, event, history);
    expectAccepted(result);
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.payment)).toBe(true);
    expect(history).toHaveLength(0);
    expect(event.eventType).toBe("payment.created");
  });
});

describe("transition table", () => {
  it("publishes the explicit allowed lifecycle", () => {
    expect(
      TRANSITION_TABLE.map((row) => [row.from, row.eventType, row.to]),
    ).toEqual([
      [null, "payment.created", "CREATED"],
      ["CREATED", "payment.authorized", "AUTHORIZED"],
      ["CREATED", "payment.failed", "FAILED"],
      ["AUTHORIZED", "payment.captured", "CAPTURED"],
      ["AUTHORIZED", "payment.failed", "FAILED"],
      ["CAPTURED", "refund.created", "REFUNDED"],
    ]);
  });
});

describe("payment identity", () => {
  it("rejects an event that targets a different payment", () => {
    const payment = createPayment({
      paymentId: paymentId("SYNTHETIC:pay:001"),
      state: "CREATED" satisfies PaymentState,
      amountMinor: 10000n,
      currency: isoCurrencyCode("INR"),
      lastOccurredAt: instant("2026-01-15T10:00:00.000Z"),
    });
    const result = processEvent(
      payment,
      syntheticPaymentAuthorized({
        paymentId: "SYNTHETIC:pay:002",
        occurredAt: "2026-01-15T10:00:02.000Z",
      }),
      emptyHistory(),
    );
    expect(result).toMatchObject({
      status: "REJECTED",
      reason: "PAYMENT_ID_MISMATCH",
    });
  });
});
