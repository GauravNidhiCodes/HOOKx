import { describe, expect, it } from "vitest";
import { createProcessMetrics, recordLifecycleMetric } from "./index.js";

describe("process metrics", () => {
  it("counts only observed lifecycle increments", () => {
    const metrics = createProcessMetrics();
    expect(metrics.snapshot().counts.webhooksReceived).toBe(0);
    recordLifecycleMetric(metrics, "WEBHOOK_RECEIVED");
    recordLifecycleMetric(metrics, "DUPLICATE_DETECTED");
    const snap = metrics.snapshot();
    expect(snap.source).toBe("process");
    expect(snap.note).toContain("Not historical");
    expect(snap.counts.webhooksReceived).toBe(1);
    expect(snap.counts.duplicates).toBe(1);
    expect(snap.counts.conflicts).toBe(0);
  });
});
