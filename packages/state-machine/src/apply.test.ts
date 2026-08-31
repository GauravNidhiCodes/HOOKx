import { describe, expect, it } from "vitest";
import { eventIdentityKey } from "@hookx/webhook";
import {
  syntheticPaymentAuthorized,
  syntheticPaymentCaptured,
  syntheticPaymentCreated,
  syntheticPaymentFailed,
  syntheticRefundCreated,
} from "@hookx/testkit";
import { applyWebhookEvent } from "./apply.js";
import { lookupTransition, TRANSITION_TABLE } from "./transition-table.js";

describe("payment state transitions", () => {
  it("publishes an explicit transition table", () => {
    expect(TRANSITION_TABLE.map((row) => [row.from, row.eventType, row.to])).toEqual(
      [
        [null, "payment.created", "CREATED"],
        ["CREATED", "payment.authorized", "AUTHORIZED"],
        ["CREATED", "payment.failed", "FAILED"],
        ["AUTHORIZED", "payment.captured", "CAPTURED"],
        ["AUTHORIZED", "payment.failed", "FAILED"],
        ["CAPTURED", "refund.created", "REFUNDED"],
      ],
    );
  });

  it("accepts the happy-path lifecycle", () => {
    const created = applyWebhookEvent({
      event: syntheticPaymentCreated(),
      currentState: null,
      seenIdentityKeys: new Set(),
    });
    expect(created).toEqual({
      outcome: "ACCEPTED",
      from: null,
      to: "CREATED",
    });

    const authorized = applyWebhookEvent({
      event: syntheticPaymentAuthorized(),
      currentState: "CREATED",
      seenIdentityKeys: new Set(),
    });
    expect(authorized).toEqual({
      outcome: "ACCEPTED",
      from: "CREATED",
      to: "AUTHORIZED",
    });

    const captured = applyWebhookEvent({
      event: syntheticPaymentCaptured(),
      currentState: "AUTHORIZED",
      seenIdentityKeys: new Set(),
    });
    expect(captured).toEqual({
      outcome: "ACCEPTED",
      from: "AUTHORIZED",
      to: "CAPTURED",
    });

    const refunded = applyWebhookEvent({
      event: syntheticRefundCreated(),
      currentState: "CAPTURED",
      seenIdentityKeys: new Set(),
    });
    expect(refunded).toEqual({
      outcome: "ACCEPTED",
      from: "CAPTURED",
      to: "REFUNDED",
    });
  });

  it("accepts failure from CREATED and AUTHORIZED", () => {
    expect(
      applyWebhookEvent({
        event: syntheticPaymentFailed(),
        currentState: "CREATED",
        seenIdentityKeys: new Set(),
      }),
    ).toMatchObject({ outcome: "ACCEPTED", to: "FAILED" });

    expect(
      applyWebhookEvent({
        event: syntheticPaymentFailed(),
        currentState: "AUTHORIZED",
        seenIdentityKeys: new Set(),
      }),
    ).toMatchObject({ outcome: "ACCEPTED", to: "FAILED" });
  });
});

describe("invalid transitions", () => {
  it("rejects capture before authorization", () => {
    const result = applyWebhookEvent({
      event: syntheticPaymentCaptured(),
      currentState: "CREATED",
      seenIdentityKeys: new Set(),
    });
    expect(result).toEqual({
      outcome: "REJECTED",
      reason: "INVALID_TRANSITION",
      from: "CREATED",
      eventType: "payment.captured",
    });
  });

  it("rejects refund before capture", () => {
    const result = applyWebhookEvent({
      event: syntheticRefundCreated(),
      currentState: "AUTHORIZED",
      seenIdentityKeys: new Set(),
    });
    expect(result.outcome).toBe("REJECTED");
  });

  it("rejects any event against FAILED or REFUNDED", () => {
    expect(lookupTransition("FAILED", "payment.authorized")).toBeNull();
    expect(lookupTransition("FAILED", "refund.created")).toBeNull();
    expect(lookupTransition("REFUNDED", "payment.created")).toBeNull();
    expect(lookupTransition("REFUNDED", "refund.created")).toBeNull();
  });

  it("rejects authorization when no payment exists", () => {
    const result = applyWebhookEvent({
      event: syntheticPaymentAuthorized(),
      currentState: null,
      seenIdentityKeys: new Set(),
    });
    expect(result).toMatchObject({
      outcome: "REJECTED",
      reason: "INVALID_TRANSITION",
      from: null,
    });
  });

  it("does not mutate caller state on rejection", () => {
    const currentState = "CREATED" as const;
    const seenIdentityKeys = new Set<never>();
    applyWebhookEvent({
      event: syntheticPaymentCaptured(),
      currentState,
      seenIdentityKeys,
    });
    expect(currentState).toBe("CREATED");
    expect(seenIdentityKeys.size).toBe(0);
  });
});

describe("duplicate webhook identity", () => {
  it("accepts the first delivery and ignores the second", () => {
    const event = syntheticPaymentCreated();
    const first = applyWebhookEvent({
      event,
      currentState: null,
      seenIdentityKeys: new Set(),
    });
    expect(first.outcome).toBe("ACCEPTED");

    const second = applyWebhookEvent({
      event,
      currentState: "CREATED",
      seenIdentityKeys: new Set([eventIdentityKey(event)]),
    });
    expect(second).toEqual({
      outcome: "IGNORED_DUPLICATE",
      identityKey: eventIdentityKey(event),
    });
  });

  it("does not treat a duplicate as a second economic transition", () => {
    const event = syntheticPaymentAuthorized();
    const second = applyWebhookEvent({
      event,
      currentState: "AUTHORIZED",
      seenIdentityKeys: new Set([eventIdentityKey(event)]),
    });
    expect(second.outcome).toBe("IGNORED_DUPLICATE");
    expect(second).not.toHaveProperty("to");
  });
});
