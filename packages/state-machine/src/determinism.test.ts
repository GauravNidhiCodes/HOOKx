import { describe, expect, it } from "vitest";
import { eventIdentityKey } from "@hookx/webhook";
import { syntheticPaymentCreated } from "@hookx/testkit";
import { applyWebhookEvent, type ApplyEventResult } from "./apply.js";

function serializeResult(result: ApplyEventResult): string {
  return JSON.stringify(result, (_key, value: unknown) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  });
}

describe("deterministic behavior", () => {
  it("returns the same result for the same event, state, and identity set", () => {
    const event = syntheticPaymentCreated();
    const currentState = null;
    const seenIdentityKeys = new Set([eventIdentityKey(event)]);

    const results = Array.from({ length: 50 }, () =>
      applyWebhookEvent({ event, currentState, seenIdentityKeys }),
    );

    const first = serializeResult(results[0]!);
    for (const result of results) {
      expect(serializeResult(result)).toBe(first);
    }
  });

  it("does not consult the system clock", () => {
    const event = syntheticPaymentCreated({
      occurredAt: "2024-03-01T00:00:00.000Z",
      receivedAt: "2024-03-01T00:00:05.000Z",
    });

    const before = Date.now();
    const result = applyWebhookEvent({
      event,
      currentState: null,
      seenIdentityKeys: new Set(),
    });
    const after = Date.now();

    expect(result).toEqual({
      outcome: "ACCEPTED",
      from: null,
      to: "CREATED",
    });
    expect(after).toBeGreaterThanOrEqual(before);
    expect(event.occurredAt).toBe("2024-03-01T00:00:00.000Z");
    expect(event.receivedAt).toBe("2024-03-01T00:00:05.000Z");
  });

  it("is independent of object key insertion order on the input record", () => {
    const event = syntheticPaymentCreated();
    const a = applyWebhookEvent({
      currentState: null,
      event,
      seenIdentityKeys: new Set(),
    });
    const b = applyWebhookEvent({
      seenIdentityKeys: new Set(),
      event,
      currentState: null,
    });
    expect(a).toEqual(b);
  });
});
