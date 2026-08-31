import { describe, expect, it } from "vitest";
import { AUDIT_REASON } from "@hookx/audit";
import { instant, paymentId, providerId } from "@hookx/domain";
import { syntheticPaymentCreated } from "@hookx/testkit";
import { outcomeDraftsFromDecision } from "./live.js";

const NOW = instant("2026-01-15T10:00:01.000Z");

describe("outcomeDraftsFromDecision", () => {
  it("records an unchanged resulting state for a rejected transition", () => {
    const event = syntheticPaymentCreated();
    const drafts = outcomeDraftsFromDecision(
      {
        stored: {
          id: "22222222-2222-4222-8222-222222222222",
          event,
          processingStatus: "PROCESSING",
          createdAt: NOW,
        },
        now: NOW,
        correlationId: "corr-reject",
        actor: "SYSTEM",
        attempt: 1,
      },
      {
        paymentId: paymentId(event.paymentId),
        provider: providerId(event.provider),
        eventId: event.externalEventId,
        previousState: "CREATED",
        resultingState: "CREATED",
        decision: "REJECTED",
        reason: "IMPOSSIBLE_AFTER_ORDERING",
      },
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.eventType).toBe("PAYMENT_STATE_CHANGED");
    expect(drafts[0]?.previousState).toBe("CREATED");
    expect(drafts[0]?.resultingState).toBe("CREATED");
    expect(drafts[0]?.reason).toBe(AUDIT_REASON.INVALID_TRANSITION);
  });
});
