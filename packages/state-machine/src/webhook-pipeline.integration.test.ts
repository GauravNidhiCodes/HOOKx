import { describe, expect, it } from "vitest";
import { instant } from "@hookx/domain";
import {
  syntheticOpenedPayload,
  syntheticProviderAdapter,
} from "@hookx/webhook";
import { processEvent, withProcessedEvent } from "./index.js";

describe("synthetic payload to state machine", () => {
  it("normalizes a synthetic provider payload and accepts the transition", () => {
    const receivedAt = instant("2026-01-15T10:00:01.000Z");
    const payload = syntheticOpenedPayload();
    const event = syntheticProviderAdapter.normalize(payload, { receivedAt });
    const result = processEvent(null, event, []);

    expect(event.provider).toBe("SYNTHETIC");
    expect(event.eventType).toBe("payment.created");
    expect(typeof event.amountMinor).toBe("bigint");
    expect(result.status).toBe("ACCEPTED");
    if (result.status === "ACCEPTED") {
      expect(result.to).toBe("CREATED");
      expect(result.payment.amountMinor).toBe(10000n);
    }

    const duplicate = processEvent(
      result.status === "ACCEPTED" ? result.payment : null,
      event,
      withProcessedEvent([], event),
    );
    expect(duplicate.status).toBe("IGNORED_DUPLICATE");
  });
});
