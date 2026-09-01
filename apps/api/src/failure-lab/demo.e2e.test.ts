import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { instant, paymentId, providerId } from "@hookx/domain";
import { StubInvestigator } from "@hookx/investigation";
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
import { ARCHITECTURE_DEMO_SCENARIO } from "./catalog.js";
import type { FailureLabRunReport } from "./report.js";

function architectureDemoDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const parsed = new URL(defaultTestDatabaseUrl(env));
  parsed.pathname = "/hookx_architecture_demo_test";
  return parsed.toString();
}

const TEST_URL = architectureDemoDatabaseUrl(process.env);
const NOW = instant("2026-01-15T10:00:01.000Z");
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
  "EXCEPTION_CREATED",
] as const;

describe("architecture demo end-to-end", () => {
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
        `HOOKX architecture demo tests require PostgreSQL. Cause: ${message}`,
        { cause: error },
      );
    }
  }, 30_000);

  afterAll(async () => {
    if (store !== undefined) {
      await store.close();
    }
  });

  it("runs TRANSIENT_FAILURE through ingest, recovery, incident, timeline, investigation, and audit", async () => {
    const catalog = await app.request("/failure-lab");
    expect(catalog.status).toBe(200);
    const catalogBody = (await catalog.json()) as {
      synthetic: boolean;
      scenarios: Array<{ id: string; architectureDemo?: boolean }>;
    };
    expect(catalogBody.synthetic).toBe(true);
    expect(
      catalogBody.scenarios.find((row) => row.id === ARCHITECTURE_DEMO_SCENARIO)
        ?.architectureDemo,
    ).toBe(true);

    const runResponse = await app.request("/failure-lab/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario: ARCHITECTURE_DEMO_SCENARIO }),
    });
    expect(runResponse.status).toBe(200);
    const runBody = (await runResponse.json()) as { run: FailureLabRunReport };
    const report = runBody.run;
    expect(report.synthetic).toBe(true);
    expect(report.demoRun).toBe(true);
    expect(report.labels).toEqual(["SYNTHETIC", "DEMO RUN"]);
    expect(report.runId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(report.payment.paymentId).toBe(`SYNTHETIC:pay:lab-${report.runId}`);
    expect(report.result.error).toBe(1);
    expect(report.retry?.status).toBe("SUCCEEDED");
    expect(report.payment.state).toBe("CREATED");
    expect(report.deadLetter).toBeNull();
    expect(report.exception?.exceptionCode).toBe("PROCESSING_FAILURE");
    expect(report.incidentId).not.toBeNull();
    expect(report.auditCount).toBeGreaterThan(0);

    const lifecycle = new Set(report.log.map((entry) => entry.lifecycle));
    for (const name of REQUIRED_LIFECYCLE) {
      expect(lifecycle.has(name)).toBe(true);
    }

    const incidentId = report.incidentId!;
    const timelineResponse = await app.request(`/incidents/${incidentId}/timeline`);
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
      paymentId(report.payment.paymentId),
    );
    const investigated = await app.request(`/incidents/${incidentId}/investigate`, {
      method: "POST",
    });
    expect(investigated.status).toBe(200);
    const investigationBody = (await investigated.json()) as {
      investigation: {
        investigationId: string;
        investigator: string;
        result: { recommendedAction: { executable: boolean } };
      };
    };
    expect(investigationBody.investigation.investigator).toBe("stub");
    expect(
      investigationBody.investigation.result.recommendedAction.executable,
    ).toBe(false);

    const audit = await store.audit.listByPayment(
      paymentId(report.payment.paymentId),
      PROVIDER,
    );
    expect(
      audit.some(
        (row) =>
          row.eventType === "INVESTIGATION_RECORDED" &&
          row.metadata["investigationId"] ===
            investigationBody.investigation.investigationId,
      ),
    ).toBe(true);
    expect(
      await store.payments.get(PROVIDER, paymentId(report.payment.paymentId)),
    ).toEqual(paymentBefore);

    const history = await app.request(`/incidents/${incidentId}/investigations`);
    expect(history.status).toBe(200);
  });
});
