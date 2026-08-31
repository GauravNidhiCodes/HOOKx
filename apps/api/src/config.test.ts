import { describe, expect, it } from "vitest";
import {
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
