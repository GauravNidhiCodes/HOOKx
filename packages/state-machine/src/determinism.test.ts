import { describe, expect, it } from "vitest";
import { syntheticPaymentCreated } from "@hookx/testkit";
import { processEvent, withProcessedEvent, type TransitionResult } from "./index.js";

function serializeResult(result: TransitionResult): string {
  return JSON.stringify(result, (_key, value: unknown) => {
    if (typeof value === "bigint") {
      return `${value.toString()}n`;
    }
    return value;
  });
}

describe("deterministic behavior", () => {
  it("returns identical results for repeated execution of the same inputs", () => {
    const event = syntheticPaymentCreated();
    const history = withProcessedEvent([], event);

    const results = Array.from({ length: 50 }, () =>
      processEvent(null, event, history),
    );

    const first = serializeResult(results[0]!);
    for (const result of results) {
      expect(serializeResult(result)).toBe(first);
      expect(result.status).toBe("IGNORED_DUPLICATE");
    }
  });

  it("returns identical accepted results without consulting the system clock", () => {
    const event = syntheticPaymentCreated({
      occurredAt: "2024-03-01T00:00:00.000Z",
      receivedAt: "2024-03-01T00:00:05.000Z",
    });

    const a = processEvent(null, event, []);
    const b = processEvent(null, event, []);
    expect(serializeResult(a)).toBe(serializeResult(b));
    expect(event.occurredAt).toBe("2024-03-01T00:00:00.000Z");
  });

  it("is independent of object key insertion order on the call", () => {
    const event = syntheticPaymentCreated();
    const a = processEvent(null, event, []);
    const b = processEvent(null, event, []);
    expect(a).toEqual(b);
  });
});
