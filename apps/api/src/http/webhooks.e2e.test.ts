import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { instant, paymentId, providerId } from "@hookx/domain";
import {
  applyWebhookEventMigrations,
  defaultTestDatabaseUrl,
  openWebhookEventStore,
  processPaymentEvents,
  recreateDatabase,
  RetryableProcessingError,
  addMilliseconds,
  runRetryTick,
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

function apiTestDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const parsed = new URL(defaultTestDatabaseUrl(env));
  parsed.pathname = "/hookx_api_test";
  return parsed.toString();
}

const TEST_URL = apiTestDatabaseUrl(process.env);
const POLICY = { maxAttempts: 5, baseDelayMs: 1_000, maxDelayMs: 8_000 };
const LEASE_MS = 2_000;

function verifierRegistry() {
  return createSignatureVerifierRegistry({
    syntheticSecret: SECRET,
    syntheticToleranceSeconds: 300,
  });
}

describe("webhook ingest end-to-end", () => {
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
        retryPolicy: POLICY,
        leaseMs: LEASE_MS,
        verifiers: verifierRegistry(),
        clock: fixedClock(NOW),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "unknown database error";
      throw new Error(
        `HOOKX webhook e2e tests require PostgreSQL. Create a dedicated test database and set HOOKX_TEST_DATABASE_URL. See packages/storage/README.md. Cause: ${message}`,
        { cause: error },
      );
    }
  }, 30_000);

  afterAll(async () => {
    if (store !== undefined) {
      await store.close();
    }
  });

  async function postRaw(rawBody: string, signature: string): Promise<Response> {
    return app.request("/webhooks/SYNTHETIC", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [SYNTHETIC_SIGNATURE_HEADER]: signature,
      },
      body: rawBody,
    });
  }

  it("persists and processes a valid signed payload", async () => {
    const eventRef = `SYNTHETIC:evt:${randomUUID()}`;
    const payload = syntheticOpenedPayload({
      event_ref: eventRef,
      payment_ref: `SYNTHETIC:pay:${randomUUID()}`,
    });
    const rawBody = JSON.stringify(payload);
    const signature = signSyntheticWebhook({
      secret: SECRET,
      rawBody,
      timestampSeconds: NOW_UNIX,
    });

    const response = await postRaw(rawBody, signature);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "accepted" });

    const stored = await store.repository.findByIdentity(
      createWebhookIdentity("SYNTHETIC", eventRef),
    );
    expect(stored).not.toBeNull();
    expect(stored?.event.eventType).toBe("payment.created");
    expect(stored?.processingStatus).toBe("PROCESSED");
    expect(
      (await store.retry.getByWebhookEventId(stored!.id))?.status,
    ).toBe("SUCCEEDED");

    const replay = await processPaymentEvents(
      store.repository,
      stored!.event.provider,
      stored!.event.paymentId,
    );
    expect(replay.payment?.state).toBe("CREATED");
  });

  it("rejects an invalid signature, persists nothing, and leaves payment state unchanged", async () => {
    const eventRef = `SYNTHETIC:evt:${randomUUID()}`;
    const paymentRef = `SYNTHETIC:pay:${randomUUID()}`;
    const payload = syntheticOpenedPayload({
      event_ref: eventRef,
      payment_ref: paymentRef,
    });
    const rawBody = JSON.stringify(payload);
    const validSignature = signSyntheticWebhook({
      secret: SECRET,
      rawBody,
      timestampSeconds: NOW_UNIX,
    });
    const invalidSignature = `${validSignature.slice(0, -1)}${validSignature.endsWith("a") ? "b" : "a"}`;

    const before = await processPaymentEvents(
      store.repository,
      providerId("SYNTHETIC"),
      paymentId(paymentRef),
    );
    expect(before.payment).toBeNull();

    const response = await postRaw(rawBody, invalidSignature);
    expect(response.status).toBe(401);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe("INVALID_SIGNATURE");

    const stored = await store.repository.findByIdentity(
      createWebhookIdentity("SYNTHETIC", eventRef),
    );
    expect(stored).toBeNull();

    const after = await processPaymentEvents(
      store.repository,
      providerId("SYNTHETIC"),
      paymentId(paymentRef),
    );
    expect(after.payment).toBeNull();
    expect(after.decisions).toHaveLength(0);
  });

  it("retries a valid webhook after a temporary processing failure", async () => {
    const eventRef = `SYNTHETIC:evt:${randomUUID()}`;
    const payload = syntheticOpenedPayload({
      event_ref: eventRef,
      payment_ref: `SYNTHETIC:pay:${randomUUID()}`,
    });
    const rawBody = JSON.stringify(payload);
    const signature = signSyntheticWebhook({
      secret: SECRET,
      rawBody,
      timestampSeconds: NOW_UNIX,
    });
    let calls = 0;
    const processFn = async (
      ...args: Parameters<typeof processPaymentEvents>
    ) => {
      calls += 1;
      if (calls === 1) {
        throw new RetryableProcessingError();
      }
      return processPaymentEvents(...args);
    };
    const retryApp = createApp({
      repository: store.repository,
      retry: store.retry,
      retryPolicy: POLICY,
      leaseMs: LEASE_MS,
      processPaymentEvents: processFn,
      verifiers: verifierRegistry(),
      clock: fixedClock(NOW),
    });
    const response = await retryApp.request("/webhooks/SYNTHETIC", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [SYNTHETIC_SIGNATURE_HEADER]: signature,
      },
      body: rawBody,
    });
    expect(response.status).toBe(200);
    const stored = await store.repository.findByIdentity(
      createWebhookIdentity("SYNTHETIC", eventRef),
    );
    expect(stored).not.toBeNull();
    expect(
      (await store.retry.getByWebhookEventId(stored!.id))?.status,
    ).toBe("RETRY_SCHEDULED");

    const tick = await runRetryTick(
      {
        retry: store.retry,
        events: store.repository,
        policy: POLICY,
        leaseMs: LEASE_MS,
        processPaymentEvents: processFn,
      },
      addMilliseconds(NOW, 1_000),
    );
    expect(tick.succeeded).toBe(1);
    expect(
      (await store.repository.findById(stored!.id))?.processingStatus,
    ).toBe("PROCESSED");
  });

  it("dead-letters a permanent processing failure without retrying", async () => {
    const eventRef = `SYNTHETIC:evt:${randomUUID()}`;
    const payload = syntheticOpenedPayload({
      event_ref: eventRef,
      payment_ref: `SYNTHETIC:pay:${randomUUID()}`,
    });
    const rawBody = JSON.stringify(payload);
    const signature = signSyntheticWebhook({
      secret: SECRET,
      rawBody,
      timestampSeconds: NOW_UNIX,
    });
    const failApp = createApp({
      repository: store.repository,
      retry: store.retry,
      retryPolicy: POLICY,
      leaseMs: LEASE_MS,
      processPaymentEvents: async () => {
        throw Object.assign(new Error("invalid"), {
          code: "INVALID_TRANSITION",
        });
      },
      verifiers: verifierRegistry(),
      clock: fixedClock(NOW),
    });
    const response = await failApp.request("/webhooks/SYNTHETIC", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [SYNTHETIC_SIGNATURE_HEADER]: signature,
      },
      body: rawBody,
    });
    expect(response.status).toBe(200);
    const stored = await store.repository.findByIdentity(
      createWebhookIdentity("SYNTHETIC", eventRef),
    );
    expect(
      (await store.retry.getByWebhookEventId(stored!.id))?.status,
    ).toBe("DEAD_LETTERED");
    const dead = await store.retry.getDeadLetterByWebhookEventId(stored!.id);
    expect(dead?.failureCode).toBe("INVALID_TRANSITION");
    await runRetryTick(
      {
        retry: store.retry,
        events: store.repository,
        policy: POLICY,
        leaseMs: LEASE_MS,
        processPaymentEvents: async () => {
          throw new Error("should not run");
        },
      },
      addMilliseconds(NOW, 60_000),
    );
    expect(
      (await store.retry.getByWebhookEventId(stored!.id))?.status,
    ).toBe("DEAD_LETTERED");
    expect(dead?.attemptCount).toBe(1);
  });
});
