import { describe, expect, it } from "vitest";
import { formatClock, isSyntheticRef } from "./format";
import { buildTimeline } from "./timeline";
import { sampleAudit, sampleWebhooks } from "../test-support/fixtures";

describe("formatClock", () => {
  it("extracts the clock from an instant", () => {
    expect(formatClock("2026-01-15T14:02:18.000Z")).toBe("14:02:18");
  });
});

describe("isSyntheticRef", () => {
  it("labels simulator provider and payment ids", () => {
    expect(isSyntheticRef("SYNTHETIC")).toBe(true);
    expect(isSyntheticRef("SYNTHETIC:pay:ui")).toBe(true);
    expect(isSyntheticRef("razorpay")).toBe(false);
  });
});

describe("buildTimeline", () => {
  it("orders events and labels delayed capture replay", () => {
    const items = buildTimeline(sampleWebhooks, sampleAudit);
    expect(items.map((item) => item.label)).toContain("payment.created");
    expect(items.map((item) => item.label)).toContain("REPLAY");
    const replay = items.find((item) => item.label === "REPLAY");
    expect(replay?.result).toBe("CAPTURED");
    expect(replay?.previousState).toBe("AUTHORIZED");
    expect(replay?.nextState).toBe("CAPTURED");
    const delayed = items.find((item) => item.result === "DELAYED");
    expect(delayed?.label).toBe("payment.captured");
  });
});
