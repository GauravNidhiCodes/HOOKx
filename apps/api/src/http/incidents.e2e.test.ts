import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { paymentId } from "@hookx/domain";
import {
  applyWebhookEventMigrations,
  defaultTestDatabaseUrl,
  openWebhookEventStore,
  recreateDatabase,
  type WebhookEventStore,
} from "@hookx/storage";
import { getScenario, SCENARIO_ID } from "@hookx/simulator";
import { createSignatureVerifierRegistry } from "@hookx/webhook";
import { createApp } from "../app.js";
import { fixedClock } from "../clock.js";
import { instant } from "@hookx/domain";
import { SIMULATOR_NOW, SIMULATOR_SECRET } from "@hookx/simulator";
import { runScenario } from "../simulate/run-scenario.js";

function incidentApiTestDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const parsed = new URL(defaultTestDatabaseUrl(env));
  parsed.pathname = "/hookx_incident_api_test";
  return parsed.toString();
}

const TEST_URL = incidentApiTestDatabaseUrl(process.env);

type TimelineBody = {
  incident: {
    incidentId: string;
    exceptionCode: string;
    synthetic: boolean;
    paymentId: string | null;
    eventId: string | null;
    correlationId: string;
  };
  timeline: Array<{
    lifecycle: string;
    clock: string;
    eventTime: string | null;
    receivedTime: string | null;
    retry: { attempt: number | null } | null;
    replay: { replayId: string } | null;
  }>;
};

describe("incident timeline end-to-end", () => {
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
        retryPolicy: { maxAttempts: 5, baseDelayMs: 1_000, maxDelayMs: 8_000 },
        leaseMs: 2_000,
        verifiers: createSignatureVerifierRegistry({
          syntheticSecret: SIMULATOR_SECRET,
          syntheticToleranceSeconds: 300,
        }),
        clock: fixedClock(instant(SIMULATOR_NOW)),
        ping: () => store.ping(),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "unknown database error";
      throw new Error(
        `HOOKX incident e2e tests require PostgreSQL. Cause: ${message}`,
        { cause: error },
      );
    }
  }, 30_000);

  afterAll(async () => {
    if (store !== undefined) {
      await store.close();
    }
  });

  async function timelineFor(
    exceptionCode: string,
    payment: string,
  ): Promise<TimelineBody> {
    const rows = await store.exceptions.listByPayment(paymentId(payment));
    const match = rows.find((row) => row.exceptionCode === exceptionCode);
    expect(match).toBeDefined();
    const response = await app.request(
      `/incidents/${match!.exceptionId}/timeline`,
    );
    expect(response.status).toBe(200);
    return (await response.json()) as TimelineBody;
  }

  it("does not create an incident for a normal successful webhook sequence", async () => {
    const scenario = getScenario(SCENARIO_ID.NORMAL_FLOW);
    await runScenario(store, getScenario(SCENARIO_ID.NORMAL_FLOW));
    const listed = await app.request(
      `/incidents?paymentId=${encodeURIComponent(scenario.paymentIds[0] ?? "")}`,
    );
    expect(listed.status).toBe(200);
    expect(
      ((await listed.json()) as { incidents: unknown[] }).incidents,
    ).toEqual([]);
  });

  it("builds a coherent duplicate timeline", async () => {
    const scenario = getScenario(SCENARIO_ID.DUPLICATE_DELIVERY);
    await runScenario(store, getScenario(SCENARIO_ID.DUPLICATE_DELIVERY));
    const body = await timelineFor(
      "DUPLICATE_EVENT",
      scenario.paymentIds[0] ?? "",
    );
    expect(body.incident.synthetic).toBe(true);
    const types = body.timeline.map((row) => row.lifecycle);
    expect(types).toContain("WEBHOOK_RECEIVED");
    expect(types).toContain("DUPLICATE_DETECTED");
    expect(types).toContain("EXCEPTION_CREATED");
    expect(JSON.stringify(body)).not.toContain(SIMULATOR_SECRET);
  });

  it("builds a coherent conflict timeline", async () => {
    const scenario = getScenario(SCENARIO_ID.CONFLICT);
    await runScenario(store, getScenario(SCENARIO_ID.CONFLICT));
    const body = await timelineFor(
      "CONFLICTING_EVENT",
      scenario.paymentIds[0] ?? "",
    );
    const types = body.timeline.map((row) => row.lifecycle);
    expect(types).toContain("WEBHOOK_RECEIVED");
    expect(types).toContain("SIGNATURE_VERIFIED");
    expect(types).toContain("CONFLICT_DETECTED");
    expect(types).toContain("EXCEPTION_CREATED");
    expect(body.incident.paymentId).toBe(scenario.paymentIds[0]);
    expect(body.incident.correlationId.length).toBeGreaterThan(0);
  });

  it("preserves received vs event time on out-of-order replay", async () => {
    const scenario = getScenario(SCENARIO_ID.OUT_OF_ORDER);
    await runScenario(store, getScenario(SCENARIO_ID.OUT_OF_ORDER));
    const body = await timelineFor(
      "OUT_OF_ORDER_EVENT",
      scenario.paymentIds[0] ?? "",
    );
    const types = body.timeline.map((row) => row.lifecycle);
    expect(types).toContain("REPLAY_STARTED");
    expect(types).toContain("REPLAY_COMPLETED");
    const delayed = body.timeline.find((row) => row.lifecycle === "REPLAY_STARTED");
    expect(delayed?.eventTime).not.toBeNull();
    expect(delayed?.receivedTime).not.toBeNull();
    expect(delayed?.replay?.replayId).toBeTruthy();
    const clocks = body.timeline.map((row) => row.clock);
    expect([...clocks].sort()).toEqual(clocks);
  });

  it("exposes retry attempt timing from the scheduler", async () => {
    const scenario = getScenario(SCENARIO_ID.RETRY_FAILURE);
    await runScenario(store, getScenario(SCENARIO_ID.RETRY_FAILURE));
    const body = await timelineFor(
      "PROCESSING_FAILURE",
      scenario.paymentIds[0] ?? "",
    );
    const types = body.timeline.map((row) => row.lifecycle);
    expect(types).toContain("RETRY_SCHEDULED");
    expect(types).toContain("RETRY_ATTEMPTED");
    expect(types).toContain("RETRY_SUCCEEDED");
    const attempted = body.timeline.find((row) => row.lifecycle === "RETRY_ATTEMPTED");
    expect(attempted?.retry?.attempt).toBeGreaterThanOrEqual(1);
  });

  it("links dead-letter exhaustion on the timeline", async () => {
    const scenario = getScenario(SCENARIO_ID.PERMANENT_FAILURE);
    await runScenario(store, getScenario(SCENARIO_ID.PERMANENT_FAILURE));
    const body = await timelineFor(
      "RETRY_EXHAUSTED",
      scenario.paymentIds[0] ?? "",
    );
    const types = body.timeline.map((row) => row.lifecycle);
    expect(types).toContain("RETRY_EXHAUSTED");
    expect(types).toContain("EXCEPTION_CREATED");
    expect(body.incident.eventId).toBeTruthy();
  });

  it("pings readiness separately from liveness", async () => {
    const health = await app.request("/health");
    expect(await health.json()).toEqual({ status: "ok" });
    const ready = await app.request("/ready");
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: "ready" });
  });
});
