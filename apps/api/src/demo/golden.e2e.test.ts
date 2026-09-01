import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { instant, paymentId, providerId } from "@hookx/domain";
import { StubInvestigator } from "@hookx/investigation";
import {
  applyWebhookEventMigrations,
  defaultTestDatabaseUrl,
  isFailureLabPaymentId,
  openWebhookEventStore,
  recreateDatabase,
  type WebhookEventStore,
} from "@hookx/storage";
import { SIMULATOR_SECRET } from "@hookx/simulator";
import { createSignatureVerifierRegistry } from "@hookx/webhook";
import { createApp } from "../app.js";
import { fixedClock } from "../clock.js";
import { GOLDEN_DEMO_SCENARIO } from "../failure-lab/catalog.js";
import type { GoldenDemoRun } from "./http.js";

function goldenDemoDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const parsed = new URL(defaultTestDatabaseUrl(env));
  parsed.pathname = "/hookx_golden_demo_test";
  return parsed.toString();
}

const TEST_URL = goldenDemoDatabaseUrl(process.env);
const NOW = instant("2026-01-15T10:00:01.000Z");
const RAZORPAY_LAB_SECRET = "dev-only-razorpay-webhook-secret";
const PROVIDER = providerId("SYNTHETIC");

const REQUIRED_LIFECYCLE = [
  "WEBHOOK_RECEIVED",
  "SIGNATURE_VERIFIED",
  "WEBHOOK_NORMALIZED",
  "EVENT_PERSISTED",
  "PROCESSING_STARTED",
  "RETRY_SCHEDULED",
  "RETRY_ATTEMPTED",
  "RETRY_SUCCEEDED",
] as const;

function asDemo(body: unknown): GoldenDemoRun {
  if (typeof body !== "object" || body === null || !("demo" in body)) {
    throw new Error("Golden Demo response missing demo");
  }
  return (body as { demo: GoldenDemoRun }).demo;
}

describe("golden demo end-to-end", () => {
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
        investigator: new StubInvestigator(),
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
        `HOOKX golden demo tests require PostgreSQL. Cause: ${message}`,
        { cause: error },
      );
    }
  }, 30_000);

  afterAll(async () => {
    if (store !== undefined) {
      await store.close();
    }
  });

  it("describes the synthetic demonstration", async () => {
    const response = await app.request("/demo");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      kind: string;
      synthetic: boolean;
      scenario: string;
    };
    expect(body.kind).toBe("SYNTHETIC DEMONSTRATION");
    expect(body.synthetic).toBe(true);
    expect(body.scenario).toBe(GOLDEN_DEMO_SCENARIO);
  });

  it("runs a unique synthetic demo through ingest, retry, audit, and investigation", async () => {
    const runResponse = await app.request("/demo/run", { method: "POST" });
    expect(runResponse.status).toBe(200);
    const demo = asDemo(await runResponse.json());
    const serialized = JSON.stringify(demo);
    expect(serialized).not.toContain(SIMULATOR_SECRET);
    expect(serialized).not.toContain(RAZORPAY_LAB_SECRET);
    expect(serialized).not.toMatch(/x-razorpay-signature/i);
    expect(serialized).not.toMatch(/x-hookx-signature/i);
    expect(demo.synthetic).toBe(true);
    expect(demo.run.scenario).toBe(GOLDEN_DEMO_SCENARIO);
    expect(demo.run.demoRun).toBe(true);
    expect(demo.run.labels).toEqual(["SYNTHETIC", "DEMO RUN"]);
    expect(demo.demoRunId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(demo.correlationId).toBe(`demo-${demo.demoRunId}`);
    expect(isFailureLabPaymentId(demo.run.payment.paymentId)).toBe(true);
    expect(demo.run.payment.paymentId).toBe(`SYNTHETIC:pay:lab-${demo.demoRunId}`);
    expect(demo.run.payment.provider).toBe("SYNTHETIC");
    expect(demo.run.result.error).toBe(1);
    expect(demo.run.result.duplicate).toBe(1);
    expect(demo.run.retry?.status).toBe("SUCCEEDED");
    expect(demo.run.retry?.attemptCount).toBeGreaterThanOrEqual(2);
    expect(demo.run.eventType).toBe("payment.created");
    expect(demo.run.eventProcessingStatus).toBe("PROCESSED");
    expect(demo.run.payment.state).toBe("CREATED");
    expect(demo.run.storedEventCount).toBe(1);
    expect(demo.run.stateChange).toBe(1);
    expect(demo.invariant.noDuplicateEconomicEffect).toBe(true);
    expect(demo.run.exception?.exceptionCode).toBe("PROCESSING_FAILURE");
    expect(demo.run.incidentId).not.toBeNull();
    expect(demo.run.auditCount).toBeGreaterThan(0);
    expect(demo.run.deadLetter).toBeNull();

    const events = await store.repository.listByPayment(
      PROVIDER,
      paymentId(demo.run.payment.paymentId),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.event.eventType).toBe("payment.created");
    expect(events[0]?.event.provider).toBe("SYNTHETIC");

    const lifecycle = new Set(demo.run.log.map((entry) => entry.lifecycle));
    for (const name of REQUIRED_LIFECYCLE) {
      expect(lifecycle.has(name)).toBe(true);
    }

    const incidentId = demo.run.incidentId!;
    const timelineResponse = await app.request(
      `/incidents/${incidentId}/timeline`,
    );
    expect(timelineResponse.status).toBe(200);
    const timelineBody = (await timelineResponse.json()) as {
      incident: { incidentId: string; synthetic: boolean };
      timeline: Array<{ lifecycle: string }>;
    };
    expect(timelineBody.incident.incidentId).toBe(incidentId);
    expect(timelineBody.incident.synthetic).toBe(true);
    expect(timelineBody.timeline.length).toBeGreaterThan(0);

    const paymentBefore = await store.payments.get(
      PROVIDER,
      paymentId(demo.run.payment.paymentId),
    );
    const investigated = await app.request(
      `/incidents/${incidentId}/investigate`,
      { method: "POST" },
    );
    expect(investigated.status).toBe(200);
    const investigationBody = (await investigated.json()) as {
      investigation: {
        investigationId: string;
        investigator: string;
        result: {
          summary: string;
          rootCause: string;
          evidence: unknown[];
          impact: string;
          recommendedAction: { executable: boolean };
          confidence: string;
          limitations: unknown[];
        };
      };
    };
    const investigationJson = JSON.stringify(investigationBody);
    expect(investigationJson).not.toContain(SIMULATOR_SECRET);
    expect(investigationJson).not.toContain(RAZORPAY_LAB_SECRET);
    expect(investigationJson).not.toMatch(/x-razorpay-signature/i);
    expect(investigationBody.investigation.investigator).toBe("stub");
    expect(investigationBody.investigation.result.summary.length).toBeGreaterThan(
      0,
    );
    expect(
      investigationBody.investigation.result.recommendedAction.executable,
    ).toBe(false);

    expect(
      await store.payments.get(PROVIDER, paymentId(demo.run.payment.paymentId)),
    ).toEqual(paymentBefore);

    const listed = await app.request("/demo/runs");
    expect(listed.status).toBe(200);
    const listedBody = (await listed.json()) as { runs: GoldenDemoRun[] };
    expect(listedBody.runs.some((row) => row.demoRunId === demo.demoRunId)).toBe(
      true,
    );

    const fetched = await app.request(`/demo/runs/${demo.demoRunId}`);
    expect(fetched.status).toBe(200);
    expect(asDemo(await fetched.json()).demoRunId).toBe(demo.demoRunId);
  });

  it("isolates three consecutive runs with new identifiers", async () => {
    const runs = [];
    for (let index = 0; index < 3; index += 1) {
      const response = await app.request("/demo/run", { method: "POST" });
      expect(response.status).toBe(200);
      runs.push(asDemo(await response.json()));
    }
    const ids = runs.map((row) => row.demoRunId);
    const payments = runs.map((row) => row.run.payment.paymentId);
    const correlations = runs.map((row) => row.correlationId);
    expect(new Set(ids).size).toBe(3);
    expect(new Set(payments).size).toBe(3);
    expect(new Set(correlations).size).toBe(3);
    for (const row of runs) {
      expect(row.run.storedEventCount).toBe(1);
      expect(row.invariant.noDuplicateEconomicEffect).toBe(true);
      expect(
        await store.repository.listByPayment(
          PROVIDER,
          paymentId(row.run.payment.paymentId),
        ),
      ).toHaveLength(1);
    }
  });

  it("does not treat Failure Lab memory of other scenarios as a demo run", async () => {
    const missing = await app.request(
      "/demo/runs/00000000-0000-4000-8000-000000000000",
    );
    expect(missing.status).toBe(404);
  });
});
