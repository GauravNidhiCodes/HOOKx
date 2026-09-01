import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { instant, paymentId, providerId } from "@hookx/domain";
import {
  applyWebhookEventMigrations,
  defaultTestDatabaseUrl,
  isFailureLabPaymentId,
  openWebhookEventStore,
  recreateDatabase,
  type WebhookEventStore,
} from "@hookx/storage";
import { getScenario, SCENARIO_ID, SIMULATOR_SECRET } from "@hookx/simulator";
import { createSignatureVerifierRegistry } from "@hookx/webhook";
import { createApp } from "../app.js";
import { fixedClock } from "../clock.js";
import { runScenario as runSimulatorScenario } from "../simulate/run-scenario.js";
import { FAILURE_LAB_RESET_CONFIRM } from "./http.js";
import type { FailureLabRunReport } from "./report.js";

function failureLabApiTestDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const parsed = new URL(defaultTestDatabaseUrl(env));
  parsed.pathname = "/hookx_failure_lab_test";
  return parsed.toString();
}

const TEST_URL = failureLabApiTestDatabaseUrl(process.env);
const NOW = instant("2026-01-15T10:00:01.000Z");

async function runLab(
  app: ReturnType<typeof createApp>,
  scenario: string,
): Promise<FailureLabRunReport> {
  const response = await app.request("/failure-lab/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenario }),
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { run: FailureLabRunReport }).run;
}

describe("Failure Lab end-to-end", () => {
  let store: WebhookEventStore;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    try {
      await recreateDatabase({ url: TEST_URL });
      await applyWebhookEventMigrations({ url: TEST_URL });
      store = await openWebhookEventStore({ url: TEST_URL });
      app = createApp({
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
        }),
        clock: fixedClock(NOW),
        ping: () => store.ping(),
        syntheticWebhookSecret: SIMULATOR_SECRET,
        purgeFailureLab: () => store.purgeFailureLab(),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "unknown database error";
      throw new Error(
        `HOOKX Failure Lab e2e tests require PostgreSQL. Cause: ${message}`,
        { cause: error },
      );
    }
  }, 30_000);

  afterAll(async () => {
    if (store !== undefined) {
      await store.close();
    }
  });

  it("DUPLICATE: one stored event, one transition, duplicate HTTP", async () => {
    const report = await runLab(app, "DUPLICATE_DELIVERY");
    expect(report.result.accepted).toBe(1);
    expect(report.result.duplicate).toBe(1);
    expect(report.stateChange).toBe(1);
    expect(report.payment.state).toBe("CREATED");
    expect(report.exception?.exceptionCode).toBe("DUPLICATE_EVENT");
    const events = await store.repository.listByPayment(
      providerId("SYNTHETIC"),
      paymentId(report.payment.paymentId),
    );
    expect(events).toHaveLength(1);
  });

  it("OUT_OF_ORDER: sent order differs from event time; final CAPTURED", async () => {
    const report = await runLab(app, "OUT_OF_ORDER");
    expect(report.input.eventOrderSent).toEqual([
      "payment.created",
      "payment.captured",
      "payment.authorized",
    ]);
    expect(report.input.eventTimeOrder).toEqual([
      "payment.created",
      "payment.authorized",
      "payment.captured",
    ]);
    expect(report.payment.state).toBe("CAPTURED");
    expect(report.replay?.delayed).toBe(true);
    const events = await store.repository.listByPayment(
      providerId("SYNTHETIC"),
      paymentId(report.payment.paymentId),
    );
    expect(events).toHaveLength(3);
  });

  it("CONFLICT: original payload unchanged", async () => {
    const report = await runLab(app, "CONFLICTING_EVENT");
    expect(report.result.conflict).toBe(1);
    expect(report.originalAmountMinor).toBe("10000");
    expect(report.exception?.exceptionCode).toBe("CONFLICTING_EVENT");
    const events = await store.repository.listByPayment(
      providerId("SYNTHETIC"),
      paymentId(report.payment.paymentId),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.event.payloadHash).toBe(report.originalPayloadHash);
    expect(events[0]?.event.amountMinor.toString()).toBe("10000");
  });

  it("TRANSIENT_FAILURE: retry succeeds using FAIL_ONCE", async () => {
    const report = await runLab(app, "TRANSIENT_FAILURE");
    expect(report.failureMode).toBe("FAIL_ONCE");
    expect(report.retry?.status).toBe("SUCCEEDED");
    expect(report.payment.state).toBe("CREATED");
    expect(report.stateChange).toBe(1);
    expect(report.deadLetter).toBeNull();
  });

  it("RETRY_EXHAUSTION: configured max attempts then dead-letter", async () => {
    const report = await runLab(app, "RETRY_EXHAUSTION");
    expect(report.retryPolicy.maxAttempts).toBe(2);
    expect(report.retry?.status).toBe("DEAD_LETTERED");
    expect(report.retry?.attemptCount).toBe(2);
    expect(report.deadLetter).not.toBeNull();
    expect(report.payment.state).toBeNull();
    expect(report.exception?.exceptionCode).toBe("RETRY_EXHAUSTED");
  });

  it("REPLAY: delayed capture applied once created is not duplicated", async () => {
    const report = await runLab(app, "REPLAY_RECOVERY");
    expect(report.replay?.beforeState).toBe("CREATED");
    expect(report.replay?.afterState).toBe("CAPTURED");
    const audit = await store.audit.listByPayment(
      paymentId(report.payment.paymentId),
      providerId("SYNTHETIC"),
    );
    const created = audit.filter(
      (row) =>
        row.eventType === "PAYMENT_STATE_CHANGED" &&
        row.resultingState === "CREATED",
    );
    expect(created).toHaveLength(1);
  });

  it("reset deletes lab rows only, including after a simulator seed", async () => {
    await runSimulatorScenario(store, getScenario(SCENARIO_ID.DUPLICATE_DELIVERY));
    const beforeSim = await store.repository.listByPayment(
      providerId("SYNTHETIC"),
      paymentId("SYNTHETIC:pay:sim-duplicate"),
    );
    expect(beforeSim.length).toBeGreaterThan(0);

    const lab = await runLab(app, "DUPLICATE_DELIVERY");
    expect(isFailureLabPaymentId(lab.payment.paymentId)).toBe(true);

    const reset = await app.request("/failure-lab/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: FAILURE_LAB_RESET_CONFIRM }),
    });
    expect(reset.status).toBe(200);

    const afterLab = await store.repository.listByPayment(
      providerId("SYNTHETIC"),
      paymentId(lab.payment.paymentId),
    );
    const afterSim = await store.repository.listByPayment(
      providerId("SYNTHETIC"),
      paymentId("SYNTHETIC:pay:sim-duplicate"),
    );
    expect(afterLab).toHaveLength(0);
    expect(afterSim.length).toBe(beforeSim.length);
  });
});
