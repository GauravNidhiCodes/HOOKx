import { describe, expect, it } from "vitest";
import { eventIdentityKey, type NormalizedWebhookEvent } from "@hookx/webhook";
import {
  syntheticPaymentAuthorized,
  syntheticPaymentCaptured,
  syntheticPaymentCreated,
  syntheticPaymentFailed,
  syntheticRefundCreated,
} from "@hookx/testkit";
import { processEvent } from "./process-event.js";
import { replayEvents } from "./replay.js";
import type { ReplayResult } from "./replay-result.js";

function serializeReplay(result: ReplayResult): string {
  return JSON.stringify(result, (_key, value: unknown) => {
    if (typeof value === "bigint") {
      return `${value.toString()}n`;
    }
    return value;
  });
}

function decisionMap(result: ReplayResult): Record<string, string> {
  return Object.fromEntries(
    result.decisions.map((decision) => [
      decision.eventId,
      `${decision.decision}:${decision.reason}`,
    ]),
  );
}

const T0 = "2026-01-15T10:00:00.000Z";
const T1 = "2026-01-15T10:00:01.000Z";
const T2 = "2026-01-15T10:00:02.000Z";
const T3 = "2026-01-15T10:00:03.000Z";

describe("replayEvents", () => {
  it("replays a normal ordered path to CAPTURED", () => {
    const created = syntheticPaymentCreated({ occurredAt: T0 });
    const authorized = syntheticPaymentAuthorized({ occurredAt: T1 });
    const captured = syntheticPaymentCaptured({ occurredAt: T2 });

    const result = replayEvents([created, authorized, captured]);
    expect(result.payment?.state).toBe("CAPTURED");
    expect(result.delayed).toHaveLength(0);
    expect(result.requiresInvestigation).toBe(false);
    expect(result.decisions.map((decision) => decision.decision)).toEqual([
      "ACCEPTED",
      "ACCEPTED",
      "ACCEPTED",
    ]);
    expect(result.decisions[0]).toMatchObject({
      paymentId: created.paymentId,
      eventId: created.externalEventId,
      previousState: null,
      resultingState: "CREATED",
      decision: "ACCEPTED",
      reason: "TRANSITION",
    });
  });

  it("classifies captured-before-authorized as DELAYED and keeps CREATED", () => {
    const created = syntheticPaymentCreated({ occurredAt: T0 });
    const captured = syntheticPaymentCaptured({ occurredAt: T2 });

    const result = replayEvents([created, captured]);
    expect(result.payment?.state).toBe("CREATED");
    expect(result.delayed).toEqual([captured]);
    expect(decisionMap(result)[captured.externalEventId]).toBe(
      "DELAYED:AWAITING_PREREQUISITE",
    );
    expect(result.requiresInvestigation).toBe(false);
  });

  it("does not silently capture when CREATED is followed only by CAPTURED", () => {
    const created = syntheticPaymentCreated({ occurredAt: T0 });
    const captured = syntheticPaymentCaptured({ occurredAt: T2 });

    const machine = processEvent(
      replayEvents([created]).payment,
      captured,
      [],
    );
    expect(machine.status).toBe("REJECTED");
    if (machine.status === "REJECTED") {
      expect(machine.reason).toBe("INVALID_TRANSITION");
    }

    const result = replayEvents([captured, created]);
    expect(result.payment?.state).toBe("CREATED");
    expect(result.payment?.state).not.toBe("CAPTURED");
    expect(result.delayed.map((event) => event.eventType)).toEqual([
      "payment.captured",
    ]);
  });

  it("resolves a delayed capture after authorized arrives", () => {
    const created = syntheticPaymentCreated({ occurredAt: T0 });
    const captured = syntheticPaymentCaptured({ occurredAt: T2 });
    const authorized = syntheticPaymentAuthorized({ occurredAt: T1 });

    const before = replayEvents([created, captured]);
    expect(before.payment?.state).toBe("CREATED");
    expect(before.delayed).toHaveLength(1);

    const after = replayEvents([created, captured, authorized]);
    expect(after.payment?.state).toBe("CAPTURED");
    expect(after.delayed).toHaveLength(0);
    expect(after.decisions.map((decision) => decision.decision)).toEqual([
      "ACCEPTED",
      "ACCEPTED",
      "ACCEPTED",
    ]);
    expect(
      after.decisions.map((decision) => [
        decision.previousState,
        decision.resultingState,
      ]),
    ).toEqual([
      [null, "CREATED"],
      ["CREATED", "AUTHORIZED"],
      ["AUTHORIZED", "CAPTURED"],
    ]);
  });

  it("retains delayed events in the result without dropping them from history", () => {
    const created = syntheticPaymentCreated({ occurredAt: T0 });
    const captured = syntheticPaymentCaptured({ occurredAt: T2 });
    const input: NormalizedWebhookEvent[] = [created, captured];

    const result = replayEvents(input);
    expect(input).toHaveLength(2);
    expect(result.delayed[0]).toBe(captured);
    expect(result.decisions).toHaveLength(2);
  });

  it("keeps multiple delayed events until prerequisites exist", () => {
    const created = syntheticPaymentCreated({ occurredAt: T0 });
    const captured = syntheticPaymentCaptured({ occurredAt: T2 });
    const refund = syntheticRefundCreated({ occurredAt: T3 });

    const delayed = replayEvents([refund, captured, created]);
    expect(delayed.payment?.state).toBe("CREATED");
    expect(delayed.delayed.map((event) => event.eventType).sort()).toEqual([
      "payment.captured",
      "refund.created",
    ]);

    const authorized = syntheticPaymentAuthorized({ occurredAt: T1 });
    const resolved = replayEvents([refund, captured, created, authorized]);
    expect(resolved.payment?.state).toBe("REFUNDED");
    expect(resolved.delayed).toHaveLength(0);
  });

  it("orders identical timestamps with a deterministic identity tie-break", () => {
    const created = syntheticPaymentCreated({
      occurredAt: T0,
      receivedAt: "2026-01-15T12:00:00.000Z",
    });
    const authorized = syntheticPaymentAuthorized({
      occurredAt: T0,
      receivedAt: "2026-01-15T08:00:00.000Z",
    });
    expect(eventIdentityKey(authorized) < eventIdentityKey(created)).toBe(true);

    const left = replayEvents([created, authorized]);
    const right = replayEvents([authorized, created]);
    expect(serializeReplay(left)).toBe(serializeReplay(right));
    expect(left.payment?.state).toBe("AUTHORIZED");
    expect(left.decisions.map((decision) => decision.eventId)).toEqual([
      authorized.externalEventId,
      created.externalEventId,
    ]);
  });

  it("marks an impossible transition after ordering as CONFLICT investigation", () => {
    const created = syntheticPaymentCreated({ occurredAt: T0 });
    const failed = syntheticPaymentFailed({ occurredAt: T1 });
    const captured = syntheticPaymentCaptured({ occurredAt: T2 });

    const result = replayEvents([captured, failed, created]);
    expect(result.payment?.state).toBe("FAILED");
    expect(result.payment?.state).not.toBe("CAPTURED");
    expect(result.requiresInvestigation).toBe(true);
    expect(decisionMap(result)[captured.externalEventId]).toBe(
      "CONFLICT:IMPOSSIBLE_AFTER_ORDERING",
    );
  });

  it("classifies a second copy of the same identity as DUPLICATE", () => {
    const created = syntheticPaymentCreated({ occurredAt: T0 });
    const result = replayEvents([created, created]);
    expect(result.payment?.state).toBe("CREATED");
    expect(result.decisions.map((decision) => decision.decision)).toEqual([
      "ACCEPTED",
      "DUPLICATE",
    ]);
    expect(result.decisions[1]?.reason).toBe("IDENTICAL_DELIVERY");
  });

  it("produces an identical result when replayed twice", () => {
    const created = syntheticPaymentCreated({ occurredAt: T0 });
    const captured = syntheticPaymentCaptured({ occurredAt: T2 });
    const authorized = syntheticPaymentAuthorized({ occurredAt: T1 });
    const events = [captured, created, authorized];

    const first = replayEvents(events);
    const second = replayEvents(events);
    expect(serializeReplay(first)).toBe(serializeReplay(second));
    expect(first.payment?.state).toBe("CAPTURED");
  });

  it("isolates events from different payments", () => {
    const payA = syntheticPaymentCreated({
      paymentId: "SYNTHETIC:pay:aaa",
      occurredAt: T0,
    });
    const payBCaptured = syntheticPaymentCaptured({
      paymentId: "SYNTHETIC:pay:bbb",
      occurredAt: T2,
      externalEventId: "SYNTHETIC:evt:pay-b-captured",
      payloadHash: "SYNTHETIC:hash:pay-b-captured",
    });

    const result = replayEvents([payA, payBCaptured], {
      provider: payA.provider,
      paymentId: payA.paymentId,
    });
    expect(result.payment?.paymentId).toBe(payA.paymentId);
    expect(result.payment?.state).toBe("CREATED");
    expect(result.decisions).toHaveLength(1);
    expect(result.delayed).toHaveLength(0);
  });

  it("isolates events from different providers", () => {
    const synthetic = syntheticPaymentCreated({ occurredAt: T0 });
    const other = syntheticPaymentCaptured({
      provider: "OTHER-PROVIDER",
      paymentId: synthetic.paymentId,
      occurredAt: T2,
      externalEventId: "OTHER:evt:captured",
      payloadHash: "OTHER:hash:captured",
    });

    const result = replayEvents([synthetic, other], {
      provider: synthetic.provider,
      paymentId: synthetic.paymentId,
    });
    expect(result.payment?.state).toBe("CREATED");
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0]?.provider).toBe("SYNTHETIC");
  });
});
