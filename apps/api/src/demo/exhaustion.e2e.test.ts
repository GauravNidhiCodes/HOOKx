import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { instant, paymentId, providerId } from "@hookx/domain";
import {
  applyWebhookEventMigrations,
  defaultTestDatabaseUrl,
  openWebhookEventStore,
  recreateDatabase,
  type WebhookEventStore,
} from "@hookx/storage";
import { SIMULATOR_SECRET } from "@hookx/simulator";
import { createSignatureVerifierRegistry } from "@hookx/webhook";
import { createApp } from "../app.js";
import { fixedClock } from "../clock.js";
import { FAILURE_LAB_SCENARIO } from "../failure-lab/catalog.js";
import { createLabProcessFn } from "../failure-lab/injection.js";
import { runRazorpayShapedLab } from "../failure-lab/razorpay-path.js";

function exhaustionDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const parsed = new URL(defaultTestDatabaseUrl(env));
  parsed.pathname = "/hookx_golden_exhaustion_test";
  return parsed.toString();
}

const TEST_URL = exhaustionDatabaseUrl(process.env);
const NOW = instant("2026-01-15T10:00:01.000Z");
const RAZORPAY_LAB_SECRET = "dev-only-razorpay-webhook-secret";

describe("golden demo retry exhaustion (Razorpay-shaped)", () => {
  let store: WebhookEventStore;

  beforeAll(async () => {
    try {
      await recreateDatabase({ url: TEST_URL });
      await applyWebhookEventMigrations({ url: TEST_URL });
      store = await openWebhookEventStore({ url: TEST_URL });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "unknown database error";
      throw new Error(
        `HOOKX golden demo exhaustion tests require PostgreSQL. Cause: ${message}`,
        { cause: error },
      );
    }
  }, 30_000);

  afterAll(async () => {
    if (store !== undefined) {
      await store.close();
    }
  });

  it("reports RETRY EXHAUSTED and does not claim recovery", async () => {
    const processFn = createLabProcessFn("ALWAYS_FAIL");
    const dependencies = {
      repository: store.repository,
      retry: store.retry,
      audit: store.audit,
      payments: store.payments,
      persistOutcome: store.persistOutcome,
      exceptions: store.exceptions,
      investigations: store.investigations,
      retryPolicy: { maxAttempts: 2, baseDelayMs: 1_000, maxDelayMs: 8_000 },
      leaseMs: 2_000,
      verifiers: createSignatureVerifierRegistry({
        syntheticSecret: SIMULATOR_SECRET,
        syntheticToleranceSeconds: 300,
        razorpayWebhookSecret: RAZORPAY_LAB_SECRET,
      }),
      clock: fixedClock(NOW),
      ping: () => store.ping(),
      syntheticWebhookSecret: SIMULATOR_SECRET,
      razorpayWebhookSecret: RAZORPAY_LAB_SECRET,
      processPaymentEvents: processFn,
    };
    const app = createApp(dependencies);
    const report = await runRazorpayShapedLab(
      dependencies,
      app,
      processFn,
      RAZORPAY_LAB_SECRET,
      {
        scenarioId: FAILURE_LAB_SCENARIO.GOLDEN_DEMO,
        labels: ["SYNTHETIC", "RAZORPAY ADAPTER"],
        correlationId: "exhaust-{runId}",
        redeliverImmediately: false,
        redeliverAfterDrain: false,
      },
    );
    expect(report.retry?.status).toBe("DEAD_LETTERED");
    expect(report.deadLetter).not.toBeNull();
    expect(report.exception?.exceptionCode).toBe("RETRY_EXHAUSTED");
    expect(report.eventProcessingStatus).not.toBe("PROCESSED");
    expect(report.payment.state).toBeNull();
    expect(report.log.some((entry) => entry.lifecycle === "RETRY_SUCCEEDED")).toBe(
      false,
    );
    const stored = await store.payments.get(
      providerId("razorpay"),
      paymentId(report.payment.paymentId),
    );
    expect(stored).toBeNull();
  });
});
