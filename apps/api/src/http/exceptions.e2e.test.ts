import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { instant, paymentId, providerId } from "@hookx/domain";
import {
  applyWebhookEventMigrations,
  defaultTestDatabaseUrl,
  openWebhookEventStore,
  recreateDatabase,
  type WebhookEventStore,
} from "@hookx/storage";
import {
  createSignatureVerifierRegistry,
  signSyntheticWebhook,
  SYNTHETIC_SIGNATURE_HEADER,
  syntheticOpenedPayload,
  unixSecondsFromInstant,
  unknownSyntheticEventPayload,
} from "@hookx/webhook";
import { createApp } from "../app.js";
import { fixedClock } from "../clock.js";

const SECRET = "dev-only-synthetic-webhook-secret";
const NOW = instant("2026-01-15T10:00:01.000Z");
const NOW_UNIX = unixSecondsFromInstant(NOW);

function exceptionApiTestDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const parsed = new URL(defaultTestDatabaseUrl(env));
  parsed.pathname = "/hookx_exception_api_test";
  return parsed.toString();
}

const TEST_URL = exceptionApiTestDatabaseUrl(process.env);

describe("exception detection end-to-end", () => {
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
        retryPolicy: { maxAttempts: 5, baseDelayMs: 1_000, maxDelayMs: 8_000 },
        leaseMs: 2_000,
        verifiers: createSignatureVerifierRegistry({
          syntheticSecret: SECRET,
          syntheticToleranceSeconds: 300,
        }),
        clock: fixedClock(NOW),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "unknown database error";
      throw new Error(
        `HOOKX exception e2e tests require PostgreSQL. Cause: ${message}`,
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
    payload: unknown,
    options: { readonly requestId?: string; readonly rawBody?: string } = {},
  ): Promise<Response> {
    const rawBody = options.rawBody ?? JSON.stringify(payload);
    return app.request("/webhooks/SYNTHETIC", {
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

  it("persists INVALID_SIGNATURE without a webhook row", async () => {
    const requestId = `corr-${randomUUID()}`;
    const rawBody = JSON.stringify(syntheticOpenedPayload());
    const valid = signSyntheticWebhook({
      secret: SECRET,
      rawBody,
      timestampSeconds: NOW_UNIX,
    });
    const invalid = `${valid.slice(0, -1)}${valid.endsWith("a") ? "b" : "a"}`;
    const response = await app.request("/webhooks/SYNTHETIC", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": requestId,
        [SYNTHETIC_SIGNATURE_HEADER]: invalid,
      },
      body: rawBody,
    });
    expect(response.status).toBe(401);
    const listed = await store.exceptions.list({
      exceptionCode: "INVALID_SIGNATURE",
    });
    const match = listed.find((row) => row.correlationId === requestId);
    expect(match?.webhookEventId).toBeNull();
    expect(match?.status).toBe("OPEN");
    expect(match?.severity).toBe("ERROR");
  });

  it("persists MALFORMED_WEBHOOK for invalid JSON", async () => {
    const requestId = `corr-${randomUUID()}`;
    const response = await postSigned({}, { requestId, rawBody: "{not-json" });
    expect(response.status).toBe(400);
    const listed = await store.exceptions.list({
      exceptionCode: "MALFORMED_WEBHOOK",
    });
    expect(listed.some((row) => row.correlationId === requestId)).toBe(true);
  });

  it("persists UNSUPPORTED_EVENT before storage", async () => {
    const requestId = `corr-${randomUUID()}`;
    const payload = unknownSyntheticEventPayload();
    const response = await postSigned(payload, { requestId });
    expect(response.status).toBe(400);
    const listed = await store.exceptions.list({
      exceptionCode: "UNSUPPORTED_EVENT",
    });
    expect(listed.some((row) => row.correlationId === requestId)).toBe(true);
  });

  it("persists INVALID_STATE_TRANSITION for a second payment.created", async () => {
    const paymentRef = `SYNTHETIC:pay:${randomUUID()}`;
    const first = await postSigned(
      syntheticOpenedPayload({
        event_ref: `SYNTHETIC:evt:${randomUUID()}`,
        payment_ref: paymentRef,
        booked_at: "2026-01-15T10:00:00.000Z",
      }),
    );
    expect(first.status).toBe(200);
    const secondRef = `SYNTHETIC:evt:${randomUUID()}`;
    const second = await postSigned(
      syntheticOpenedPayload({
        event_ref: secondRef,
        payment_ref: paymentRef,
        booked_at: "2026-01-15T10:00:01.000Z",
      }),
    );
    expect(second.status).toBe(200);
    const listed = await store.exceptions.listByPayment(paymentId(paymentRef));
    const invalid = listed.find(
      (row) => row.exceptionCode === "INVALID_STATE_TRANSITION",
    );
    expect(invalid).toBeDefined();
    expect(invalid?.paymentId).toBe(paymentRef);
    expect(invalid?.webhookEventId).toBeTruthy();
    expect(invalid?.status).toBe("OPEN");

    const http = await app.request(
      `/payments/${encodeURIComponent(paymentRef)}/exceptions`,
    );
    expect(http.status).toBe(200);
    const body = (await http.json()) as {
      exceptions: Array<{ exceptionCode: string }>;
    };
    expect(body.exceptions.map((row) => row.exceptionCode)).toContain(
      "INVALID_STATE_TRANSITION",
    );

    const one = await app.request(`/exceptions/${invalid!.exceptionId}`);
    expect(one.status).toBe(200);
  });

  it("does not expose secrets on exception HTTP responses", async () => {
    const listed = await app.request("/exceptions?provider=SYNTHETIC");
    expect(listed.status).toBe(200);
    const body = await listed.text();
    expect(body).not.toContain(SECRET);
    expect(body).not.toMatch(/"payload"/);
  });

  it("scopes exceptions to the payment provider isolation", async () => {
    const listed = await store.exceptions.list({
      provider: providerId("SYNTHETIC"),
      exceptionCode: "INVALID_STATE_TRANSITION",
    });
    expect(listed.length).toBeGreaterThan(0);
  });
});
