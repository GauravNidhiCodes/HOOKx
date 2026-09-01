import { describe, expect, it } from "vitest";
import {
  createInvestigatorFromEnv,
  resolveInvestigationRuntimeConfig,
} from "@hookx/investigation";
import {
  resolveLiveProviders,
  resolveRetryRuntimeConfig,
  resolveRazorpayWebhookSecret,
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

  it("does not require a Razorpay webhook secret at process start", () => {
    expect(resolveRazorpayWebhookSecret({})).toBeUndefined();
  });

  it("treats providers as synthetic unless opted into live ingest", () => {
    expect(resolveLiveProviders({})).toEqual([]);
    expect(resolveLiveProviders({ HOOKX_LIVE_PROVIDERS: "razorpay" })).toEqual([
      "razorpay",
    ]);
  });

  it("reads the Razorpay webhook secret only from the environment", () => {
    const secret = "dev-only-razorpay-webhook-secret";
    expect(
      resolveRazorpayWebhookSecret({ RAZORPAY_WEBHOOK_SECRET: secret }),
    ).toBe(secret);
  });

  it("does not treat Key Id or Key Secret as the webhook secret", () => {
    expect(
      resolveRazorpayWebhookSecret({
        RAZORPAY_KEY_ID: "unused",
        RAZORPAY_KEY_SECRET: "unused",
      }),
    ).toBeUndefined();
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

describe("investigation configuration", () => {
  it("defaults to the stub investigator without an API key", () => {
    expect(resolveInvestigationRuntimeConfig({})).toMatchObject({
      provider: "stub",
      openaiApiKey: null,
    });
    expect(createInvestigatorFromEnv({}).implementation).toBe("stub");
  });

  it("does not require or leak an OpenAI key for the default provider", () => {
    const secret = "must-never-appear-in-investigation-errors";
    const investigator = createInvestigatorFromEnv({
      HOOKX_SYNTHETIC_WEBHOOK_SECRET: secret,
    });
    expect(investigator.implementation).toBe("stub");
    expect(JSON.stringify(resolveInvestigationRuntimeConfig({}))).not.toContain(
      secret,
    );
  });

  it("becomes unavailable when OpenAI is requested without a key", () => {
    expect(
      createInvestigatorFromEnv({
        HOOKX_INVESTIGATION_PROVIDER: "openai",
      }).implementation,
    ).toBe("unavailable");
  });
});
