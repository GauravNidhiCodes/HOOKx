import { describe, expect, it } from "vitest";
import {
  resolveRetryRuntimeConfig,
  resolveSyntheticWebhookSecret,
  resolveSyntheticWebhookToleranceSeconds,
} from "./config.js";

describe("webhook secret configuration", () => {
  it("reads the synthetic secret from the environment", () => {
    const secret = "dev-only-not-a-real-secret";
    expect(
      resolveSyntheticWebhookSecret({
        HOOKX_SYNTHETIC_WEBHOOK_SECRET: secret,
      }),
    ).toBe(secret);
  });

  it("does not embed secrets in configuration errors", () => {
    const secret = "must-never-appear-in-errors";
    expect(() => resolveSyntheticWebhookSecret({})).toThrow(
      /HOOKX_SYNTHETIC_WEBHOOK_SECRET is not set/,
    );
    try {
      resolveSyntheticWebhookToleranceSeconds({
        HOOKX_SYNTHETIC_WEBHOOK_SECRET: secret,
        HOOKX_SYNTHETIC_WEBHOOK_TOLERANCE_SECONDS: "-1",
      });
      throw new Error("expected tolerance error");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      if (error instanceof Error) {
        expect(error.message).not.toContain(secret);
        expect(error.message).toBe(
          "HOOKX_SYNTHETIC_WEBHOOK_TOLERANCE_SECONDS is invalid",
        );
      }
    }
  });

  it("defaults the synthetic replay window", () => {
    expect(resolveSyntheticWebhookToleranceSeconds({})).toBe(300);
  });
});

describe("retry configuration", () => {
  it("defaults retry policy and lease", () => {
    expect(resolveRetryRuntimeConfig({})).toEqual({
      policy: {
        maxAttempts: 5,
        baseDelayMs: 1_000,
        maxDelayMs: 60_000,
      },
      leaseMs: 30_000,
    });
  });

  it("reads retry integers from the environment", () => {
    expect(
      resolveRetryRuntimeConfig({
        HOOKX_RETRY_MAX_ATTEMPTS: "3",
        HOOKX_RETRY_BASE_DELAY_MS: "500",
        HOOKX_RETRY_MAX_DELAY_MS: "4000",
        HOOKX_RETRY_LEASE_MS: "15000",
      }),
    ).toEqual({
      policy: {
        maxAttempts: 3,
        baseDelayMs: 500,
        maxDelayMs: 4_000,
      },
      leaseMs: 15_000,
    });
  });

  it("rejects invalid retry configuration without leaking other secrets", () => {
    const secret = "must-never-appear-in-retry-errors";
    expect(() =>
      resolveRetryRuntimeConfig({
        HOOKX_SYNTHETIC_WEBHOOK_SECRET: secret,
        HOOKX_RETRY_MAX_ATTEMPTS: "0",
      }),
    ).toThrow("HOOKX_RETRY_MAX_ATTEMPTS is invalid");
  });
});
