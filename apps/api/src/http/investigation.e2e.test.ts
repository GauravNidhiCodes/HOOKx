import { randomUUID } from "node:crypto";
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
import {
  createSignatureVerifierRegistry,
  createWebhookIdentity,
  signSyntheticWebhook,
  SYNTHETIC_SIGNATURE_HEADER,
  syntheticOpenedPayload,
  unixSecondsFromInstant,
} from "@hookx/webhook";
import { createApp } from "../app.js";
import { fixedClock } from "../clock.js";

const SECRET = "dev-only-synthetic-webhook-secret";
const NOW = instant("2026-01-15T10:00:01.000Z");
const NOW_UNIX = unixSecondsFromInstant(NOW);
const PROVIDER = providerId("SYNTHETIC");

function investigationApiTestDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const parsed = new URL(defaultTestDatabaseUrl(env));
  parsed.pathname = "/hookx_investigation_api_test";
  return parsed.toString();
}

const TEST_URL = investigationApiTestDatabaseUrl(process.env);

describe("investigation end-to-end", () => {
  let store: WebhookEventStore;
  let app: ReturnType<typeof createApp>;
  let ingestOnly: ReturnType<typeof createApp>;

  beforeAll(async () => {
    try {
      await recreateDatabase({ url: TEST_URL });
      await applyWebhookEventMigrations({ url: TEST_URL });
      store = await openWebhookEventStore({ url: TEST_URL });
      const shared = {
        repository: store.repository,
        retry: store.retry,
        audit: store.audit,
        payments: store.payments,
        persistOutcome: store.persistOutcome,
        exceptions: store.exceptions,
        retryPolicy: { maxAttempts: 5, baseDelayMs: 1_000, maxDelayMs: 8_000 },
        leaseMs: 2_000,
        verifiers: createSignatureVerifierRegistry({
          syntheticSecret: SECRET,
          syntheticToleranceSeconds: 300,
        }),
        clock: fixedClock(NOW),
      };
      app = createApp({
        ...shared,
        investigations: store.investigations,
        investigator: new StubInvestigator(),
      });
      ingestOnly = createApp(shared);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "unknown database error";
      throw new Error(
        `HOOKX investigation e2e tests require PostgreSQL. Cause: ${message}`,
        { cause: error },
      );
    }
  }, 30_000);

  afterAll(async () => {
    if (store !== undefined) {
      await store.close();
    }
  });

  async function postSigned(
    target: ReturnType<typeof createApp>,
    payload: unknown,
    options: { readonly requestId?: string } = {},
  ): Promise<Response> {
    const rawBody = JSON.stringify(payload);
    return target.request("/webhooks/SYNTHETIC", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(options.requestId === undefined
          ? {}
          : { "x-request-id": options.requestId }),
        [SYNTHETIC_SIGNATURE_HEADER]: signSyntheticWebhook({
          secret: SECRET,
          rawBody,
          timestampSeconds: NOW_UNIX,
        }),
      },
      body: rawBody,
    });
  }

  it("ingests a webhook when no investigator is configured", async () => {
    const paymentRef = `SYNTHETIC:pay:${randomUUID()}`;
    const response = await postSigned(
      ingestOnly,
      syntheticOpenedPayload({
        event_ref: `SYNTHETIC:evt:${randomUUID()}`,
        payment_ref: paymentRef,
      }),
    );
    expect(response.status).toBe(200);
    expect(await store.payments.get(PROVIDER, paymentId(paymentRef))).toMatchObject(
      { state: "CREATED" },
    );
  });

  it("investigates a conflicting webhook without changing financial truth", async () => {
    const eventRef = `SYNTHETIC:evt:${randomUUID()}`;
    const paymentRef = `SYNTHETIC:pay:${randomUUID()}`;
    const first = await postSigned(
      app,
      syntheticOpenedPayload({
        event_ref: eventRef,
        payment_ref: paymentRef,
        minor_units: "10000",
      }),
    );
    expect(first.status).toBe(200);
    const conflictId = `corr-${randomUUID()}`;
    const conflict = await postSigned(
      app,
      syntheticOpenedPayload({
        event_ref: eventRef,
        payment_ref: paymentRef,
        minor_units: "25000",
      }),
      { requestId: conflictId },
    );
    expect(conflict.status).toBe(409);

    const stored = await store.repository.findByIdentity(
      createWebhookIdentity("SYNTHETIC", eventRef),
    );
    expect(stored?.event.amountMinor).toBe(10000n);
    const paymentBefore = await store.payments.get(PROVIDER, paymentId(paymentRef));
    expect(paymentBefore).toMatchObject({ state: "CREATED", amountMinor: 10000n });

    const exceptions = await store.exceptions.listByPayment(paymentId(paymentRef));
    const conflicting = exceptions.find(
      (row) => row.exceptionCode === "CONFLICTING_EVENT",
    );
    expect(conflicting).toBeDefined();
    const exceptionBefore = conflicting!;
    const auditBefore = await store.audit.listByPayment(paymentId(paymentRef));
    const stateChangesBefore = auditBefore.filter(
      (row) => row.eventType === "PAYMENT_STATE_CHANGED",
    ).length;

    const investigated = await app.request(
      `/exceptions/${exceptionBefore.exceptionId}/investigate`,
      { method: "POST", headers: { "x-request-id": `inv-${randomUUID()}` } },
    );
    expect(investigated.status).toBe(200);
    const body = (await investigated.json()) as {
      investigation: {
        investigator: string;
        promptVersion: string;
        result: {
          summary: string;
          evidence: Array<{ sourceType: string; sourceId: string; fact: string }>;
          recommendedAction: { code: string; executable: boolean };
          likelyCause: string;
          facts: string[];
        };
      };
    };
    expect(body.investigation.investigator).toBe("stub");
    expect(body.investigation.promptVersion).toBe("investigation-v1");
    expect(body.investigation.result.recommendedAction.executable).toBe(false);
    expect(body.investigation.result.recommendedAction.code).toBe(
      "INVESTIGATE_CONFLICTING_PAYLOAD",
    );
    const retryBefore =
      stored === null
        ? null
        : await store.retry.getByWebhookEventId(stored.id);
    const allowedEvidenceIds = new Set(
      [
        exceptionBefore.exceptionId,
        exceptionBefore.webhookEventId,
        stored?.id,
        retryBefore?.id,
        ...auditBefore.map((row) => row.auditEventId),
      ].filter((value): value is string => value !== null && value !== undefined),
    );
    expect(body.investigation.result.evidence.length).toBeGreaterThan(0);
    expect(
      body.investigation.result.evidence.every((item) =>
        allowedEvidenceIds.has(item.sourceId),
      ),
    ).toBe(true);
    expect(body.investigation.result.likelyCause.toLowerCase()).toMatch(/\bmay have\b/);

    const fetched = await app.request(
      `/exceptions/${exceptionBefore.exceptionId}/investigation`,
    );
    expect(fetched.status).toBe(200);

    expect(await store.exceptions.findById(exceptionBefore.exceptionId)).toEqual(
      exceptionBefore,
    );
    expect(await store.payments.get(PROVIDER, paymentId(paymentRef))).toEqual(
      paymentBefore,
    );
    const storedAfter = await store.repository.findByIdentity(
      createWebhookIdentity("SYNTHETIC", eventRef),
    );
    expect(storedAfter?.event.amountMinor).toBe(10000n);
    const stateChangesAfter = (
      await store.audit.listByPayment(paymentId(paymentRef))
    ).filter((row) => row.eventType === "PAYMENT_STATE_CHANGED").length;
    expect(stateChangesAfter).toBe(stateChangesBefore);
  });
});
