import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { instant, paymentId, providerId } from "@hookx/domain";
import {
  explanatoryIncidentTypeFor,
  StubInvestigator,
  type InvestigationIncidentType,
} from "@hookx/investigation";
import { isExceptionCode } from "@hookx/exceptions";
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
import type { FailureLabRunReport } from "./report.js";

function investigatorLabTestDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const parsed = new URL(defaultTestDatabaseUrl(env));
  parsed.pathname = "/hookx_ai_investigator_lab_test";
  return parsed.toString();
}

const TEST_URL = investigatorLabTestDatabaseUrl(process.env);
const NOW = instant("2026-01-15T10:00:01.000Z");
const PROVIDER = providerId("SYNTHETIC");
const RAZORPAY_LAB_SECRET = "dev-only-razorpay-webhook-secret";

const SCENARIOS = [
  "DUPLICATE_DELIVERY",
  "CONFLICTING_EVENT",
  "OUT_OF_ORDER",
  "TRANSIENT_FAILURE",
  "RETRY_EXHAUSTION",
  "REPLAY_RECOVERY",
] as const;

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

describe("Failure Lab → AI investigator", () => {
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
          razorpayWebhookSecret: RAZORPAY_LAB_SECRET,
        }),
        clock: fixedClock(NOW),
        ping: () => store.ping(),
        syntheticWebhookSecret: SIMULATOR_SECRET,
        razorpayWebhookSecret: RAZORPAY_LAB_SECRET,
        purgeFailureLab: () => store.purgeFailureLab(),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "unknown database error";
      throw new Error(
        `HOOKX AI investigator Failure Lab tests require PostgreSQL. Cause: ${message}`,
        { cause: error },
      );
    }
  }, 30_000);

  afterAll(async () => {
    if (store !== undefined) {
      await store.close();
    }
  });

  it.each(SCENARIOS)(
    "%s: investigate the generated incident from persisted evidence",
    async (scenario) => {
      const report = await runLab(app, scenario);
      let incidentId = report.incidentId;
      if (incidentId === null) {
        const listed = await store.exceptions.listByPayment(
          paymentId(report.payment.paymentId),
        );
        incidentId = listed[0]?.exceptionId ?? null;
      }
      expect(incidentId).not.toBeNull();
      const id = incidentId!;
      const exception = await store.exceptions.findById(id);
      expect(exception).not.toBeNull();
      const paymentBefore = await store.payments.get(
        PROVIDER,
        paymentId(report.payment.paymentId),
      );

      const investigated = await app.request(`/incidents/${id}/investigate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      expect(investigated.status).toBe(200);
      const body = (await investigated.json()) as {
        investigation: {
          investigationId: string;
          incidentId: string;
          investigator: string;
          evidenceHash: string;
          result: {
            summary: string;
            incidentType: InvestigationIncidentType;
            rootCause: string;
            impact: string;
            confidence: string;
            confidenceReason: string;
            limitations: string[];
            evidence: Array<{ sourceId: string }>;
            recommendedAction: { executable: boolean };
          };
        };
      };
      expect(body.investigation.investigator).toBe("stub");
      expect(body.investigation.incidentId).toBe(id);
      expect(body.investigation.evidenceHash.startsWith("sha256:")).toBe(true);
      expect(body.investigation.result.recommendedAction.executable).toBe(false);
      expect(body.investigation.result.summary.toLowerCase()).not.toContain(
        "customer lost money",
      );
      expect(JSON.stringify(body)).not.toMatch(/webhook secret/i);
      expect(JSON.stringify(body)).not.toMatch(/sk-[A-Za-z0-9]{8,}/);
      if (isExceptionCode(exception!.exceptionCode)) {
        expect(body.investigation.result.incidentType).toBe(
          explanatoryIncidentTypeFor(exception!.exceptionCode),
        );
      }
      expect(body.investigation.result.evidence.length).toBeGreaterThan(0);

      const audit = await store.audit.listByPayment(
        paymentId(report.payment.paymentId),
        PROVIDER,
      );
      expect(
        audit.some(
          (row) =>
            row.eventType === "INVESTIGATION_RECORDED" &&
            row.metadata["investigationId"] === body.investigation.investigationId,
        ),
      ).toBe(true);

      expect(
        await store.exceptions.findById(id),
      ).toEqual(exception);
      expect(
        await store.payments.get(PROVIDER, paymentId(report.payment.paymentId)),
      ).toEqual(paymentBefore);

      const again = await app.request(`/incidents/${id}/investigate`, {
        method: "POST",
      });
      expect(again.status).toBe(200);
      const history = await app.request(`/incidents/${id}/investigations`);
      const historyBody = (await history.json()) as {
        investigations: Array<{ investigationId: string }>;
      };
      expect(historyBody.investigations.length).toBeGreaterThanOrEqual(2);
    },
  );

  it("RAZORPAY_SHAPED_DUPLICATE: investigates normalized evidence, not raw Razorpay payloads", async () => {
    const report = await runLab(app, "RAZORPAY_SHAPED_DUPLICATE");
    expect(report.payment.provider).toBe("razorpay");
    const incidentId = report.incidentId;
    expect(incidentId).not.toBeNull();
    const id = incidentId!;
    const razorpay = providerId("razorpay");
    const paymentBefore = await store.payments.get(
      razorpay,
      paymentId(report.payment.paymentId),
    );
    const investigated = await app.request(`/incidents/${id}/investigate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(investigated.status).toBe(200);
    const body = JSON.stringify(await investigated.json());
    expect(body).not.toContain("payload.payment");
    expect(body).not.toContain(RAZORPAY_LAB_SECRET);
    expect(body).not.toMatch(/x-razorpay-signature/i);
    expect(body).not.toContain("payloadHash");
    expect(body).toContain("DUPLICATE");
    expect(
      await store.payments.get(razorpay, paymentId(report.payment.paymentId)),
    ).toEqual(paymentBefore);
  });
});
