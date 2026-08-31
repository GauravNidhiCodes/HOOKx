import { describe, expect, it } from "vitest";
import {
  calculateRetryDelay,
  DEFAULT_RETRY_POLICY,
} from "./policy.js";

describe("calculateRetryDelay", () => {
  const policy = { maxAttempts: 8, baseDelayMs: 1_000, maxDelayMs: 8_000 };

  it("uses exponential backoff without jitter", () => {
    expect(calculateRetryDelay(1, policy)).toBe(1_000);
    expect(calculateRetryDelay(2, policy)).toBe(2_000);
    expect(calculateRetryDelay(3, policy)).toBe(4_000);
  });

  it("caps at maximum delay", () => {
    expect(calculateRetryDelay(4, policy)).toBe(8_000);
    expect(calculateRetryDelay(5, policy)).toBe(8_000);
    expect(calculateRetryDelay(20, policy)).toBe(8_000);
  });

  it("is deterministic for the default policy", () => {
    const first = calculateRetryDelay(3, DEFAULT_RETRY_POLICY);
    const second = calculateRetryDelay(3, DEFAULT_RETRY_POLICY);
    expect(first).toBe(second);
    expect(first).toBe(4_000);
  });

  it("rejects a non-positive attempt without using a clock", () => {
    expect(() => calculateRetryDelay(0, DEFAULT_RETRY_POLICY)).toThrow(
      /positive integer/,
    );
  });
});
