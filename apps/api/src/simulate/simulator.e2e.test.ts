import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { paymentId, providerId } from "@hookx/domain";
import {
  applyWebhookEventMigrations,
  calculateRetryDelay,
  defaultTestDatabaseUrl,
  openWebhookEventStore,
  recreateDatabase,
  type WebhookEventStore,
} from "@hookx/storage";
import {
  generateDeliveries,
  getScenario,
  SCENARIO_ID,
  type ScenarioDefinition,
} from "@hookx/simulator";
import { runScenario } from "./run-scenario.js";

function simulatorTestDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const parsed = new URL(defaultTestDatabaseUrl(env));
  parsed.pathname = "/hookx_simulator_test";
  return parsed.toString();
}

const TEST_URL = simulatorTestDatabaseUrl(process.env);

async function run(store: WebhookEventStore, id: ScenarioDefinition["id"]) {
  return runScenario(store, getScenario(id));
}

describe("synthetic webhook simulator scenarios", () => {
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
        `HOOKX simulator e2e tests require PostgreSQL. Cause: ${message}`,
        { cause: error },
      );
    }
  }, 30_000);

  afterAll(async () => {
    if (store !== undefined) {
      await store.close();
    }
  });

  it("NORMAL_FLOW: created → authorized → captured through the HTTP pipeline", async () => {
    const scenario = getScenario(SCENARIO_ID.NORMAL_FLOW);
    const generated = generateDeliveries(scenario);
    expect(generated.map((row) => row.eventType)).toEqual([
      "payment.created",
      "payment.authorized",
      "payment.captured",
    ]);
    const result = await run(store, SCENARIO_ID.NORMAL_FLOW);
    expect(result.deliveries.map((row) => row.httpStatus)).toEqual(
      scenario.expected.http.map((row) => row.status),
    );
    expect(result.deliveries.map((row) => row.bodyStatus)).toEqual(
      scenario.expected.http.map((row) => row.bodyStatus),
    );
    expect(result.storedEventCount).toBe(scenario.expected.storedEventCount);
    expect(result.stateTransitionCount).toBe(
      scenario.expected.stateTransitionCount,
    );
    expect(result.payments).toEqual(scenario.expected.payments);
    expect(result.auditEventTypes).toEqual(
      expect.arrayContaining([...scenario.expected.auditEventTypes]),
    );
  });

  it("DUPLICATE_DELIVERY: one stored event and one transition", async () => {
    const scenario = getScenario(SCENARIO_ID.DUPLICATE_DELIVERY);
    const result = await run(store, SCENARIO_ID.DUPLICATE_DELIVERY);
    expect(result.deliveries[1]?.bodyStatus).toBe("duplicate");
    expect(result.storedEventCount).toBe(1);
    expect(result.stateTransitionCount).toBe(1);
    expect(result.payments[0]?.state).toBe("CREATED");
    expect(result.auditEventTypes).toContain("WEBHOOK_DUPLICATE");
    expect(result.exceptionCodes).toContain("DUPLICATE_EVENT");
    expect(scenario.expected.storedEventCount).toBe(1);
  });

  it("OUT_OF_ORDER: delayed capture then authorization resolves to CAPTURED", async () => {
    const scenario = getScenario(SCENARIO_ID.OUT_OF_ORDER);
    const result = await run(store, SCENARIO_ID.OUT_OF_ORDER);
    expect(result.deliveries.map((row) => row.eventType)).toEqual([
      "payment.created",
      "payment.captured",
      "payment.authorized",
    ]);
    expect(result.delayedAuditCount).toBe(scenario.expected.delayedAuditCount);
    expect(result.stateTransitionCount).toBe(
      scenario.expected.stateTransitionCount,
    );
    expect(result.payments[0]?.state).toBe("CAPTURED");
    expect(result.auditEventTypes).toContain("WEBHOOK_DELAYED");
    expect(result.exceptionCodes).toContain("OUT_OF_ORDER_EVENT");
    expect(result.exceptionCodes).toContain("MISSING_EVENT");
  });

  it("CONFLICT: original event is unchanged and payment stays safe", async () => {
    const result = await run(store, SCENARIO_ID.CONFLICT);
    expect(result.deliveries[1]?.httpStatus).toBe(409);
    expect(result.deliveries[1]?.bodyStatus).toBe("conflict");
    expect(result.storedEventCount).toBe(1);
    expect(result.originalAmountMinor).toBe("10000");
    expect(result.payments[0]?.state).toBe("CREATED");
    expect(result.stateTransitionCount).toBe(1);
    expect(result.auditEventTypes).toContain("WEBHOOK_CONFLICT");
    expect(result.exceptionCodes).toContain("CONFLICTING_EVENT");
  });

  it("RETRY_FAILURE: first attempt fails, second succeeds", async () => {
    const scenario = getScenario(SCENARIO_ID.RETRY_FAILURE);
    const result = await run(store, SCENARIO_ID.RETRY_FAILURE);
    expect(result.deliveries[0]?.httpStatus).toBe(500);
    expect(result.deliveries[0]?.code).toBe("TEMPORARY_PROCESSING_FAILURE");
    expect(result.retryStatus).toBe("SUCCEEDED");
    expect(result.retryAttemptCount).toBeGreaterThanOrEqual(
      scenario.expected.retryMinAttempts ?? 2,
    );
    expect(result.payments[0]?.state).toBe("CREATED");
    expect(result.stateTransitionCount).toBe(1);
    expect(result.auditEventTypes).toEqual(
      expect.arrayContaining([
        "RETRY_SCHEDULED",
        "RETRY_ATTEMPTED",
        "RETRY_SUCCEEDED",
        "PAYMENT_STATE_CHANGED",
      ]),
    );
    expect(result.exceptionCodes).toContain("PROCESSING_FAILURE");
    expect(
      calculateRetryDelay(1, {
        maxAttempts: scenario.retry.maxAttempts,
        baseDelayMs: scenario.retry.baseDelayMs,
        maxDelayMs: scenario.retry.maxDelayMs,
      }),
    ).toBe(1_000);
  });

  it("PERMANENT_FAILURE: retries stop at max attempts and dead-letter", async () => {
    const scenario = getScenario(SCENARIO_ID.PERMANENT_FAILURE);
    const result = await run(store, SCENARIO_ID.PERMANENT_FAILURE);
    expect(result.deliveries[0]?.httpStatus).toBe(500);
    expect(result.deadLettered).toBe(true);
    expect(result.retryStatus).toBe("DEAD_LETTERED");
    expect(result.retryAttemptCount).toBe(scenario.retry.maxAttempts);
    expect(result.storedEventCount).toBe(1);
    expect(result.payments[0]?.state).toBeNull();
    expect(result.stateTransitionCount).toBe(0);
    expect(result.auditEventTypes).toContain("RETRY_DEAD_LETTERED");
    expect(result.exceptionCodes).toContain("RETRY_EXHAUSTED");
  });

  it("MULTI_PAYMENT: interleaved events stay isolated", async () => {
    const result = await run(store, SCENARIO_ID.MULTI_PAYMENT);
    expect(result.storedEventCount).toBe(6);
    expect(result.stateTransitionCount).toBe(6);
    expect(result.payments).toEqual([
      { paymentId: "SYNTHETIC:pay:sim-multi-a", state: "CAPTURED" },
      { paymentId: "SYNTHETIC:pay:sim-multi-b", state: "CAPTURED" },
    ]);
    const provider = providerId("SYNTHETIC");
    const eventsA = await store.repository.listByPayment(
      provider,
      paymentId("SYNTHETIC:pay:sim-multi-a"),
    );
    const eventsB = await store.repository.listByPayment(
      provider,
      paymentId("SYNTHETIC:pay:sim-multi-b"),
    );
    expect(eventsA).toHaveLength(3);
    expect(eventsB).toHaveLength(3);
    expect(
      eventsA.every((row) => row.event.paymentId === "SYNTHETIC:pay:sim-multi-a"),
    ).toBe(true);
    expect(
      eventsA.some((row) => row.event.paymentId === "SYNTHETIC:pay:sim-multi-b"),
    ).toBe(false);
    expect(
      eventsA.map((row) => row.event.externalEventId).join(","),
    ).not.toContain("sim-multi-b");
    expect(
      eventsB.map((row) => row.event.externalEventId).join(","),
    ).not.toContain("sim-multi-a");
  });
});
