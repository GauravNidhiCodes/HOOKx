import { describe, expect, it } from "vitest";
import { RetryableProcessingError } from "@hookx/storage";
import { createSimulatorProcessFn } from "./failure-process.js";

describe("createSimulatorProcessFn", () => {
  it("throws a retryable error on the first FAIL_THEN_SUCCEED attempt", async () => {
    const fn = createSimulatorProcessFn({
      kind: "FAIL_THEN_SUCCEED",
      failAttempts: 1,
    });
    await expect(
      fn(
        { listByPayment: async () => [] } as never,
        "SYNTHETIC" as never,
        "SYNTHETIC:pay:sim-retry" as never,
      ),
    ).rejects.toBeInstanceOf(RetryableProcessingError);
  });

  it("throws the same retryable error on every EXHAUST_RETRIES attempt", async () => {
    const fn = createSimulatorProcessFn({ kind: "EXHAUST_RETRIES" });
    await expect(
      fn(
        { listByPayment: async () => [] } as never,
        "SYNTHETIC" as never,
        "SYNTHETIC:pay:sim-dead-letter" as never,
      ),
    ).rejects.toBeInstanceOf(RetryableProcessingError);
    await expect(
      fn(
        { listByPayment: async () => [] } as never,
        "SYNTHETIC" as never,
        "SYNTHETIC:pay:sim-dead-letter" as never,
      ),
    ).rejects.toBeInstanceOf(RetryableProcessingError);
  });
});
