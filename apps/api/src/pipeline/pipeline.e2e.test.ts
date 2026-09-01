import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { instant, paymentId, providerId } from "@hookx/domain";
import {
  addMilliseconds,
  applyWebhookEventMigrations,
  defaultTestDatabaseUrl,
  openWebhookEventStore,
  processPaymentEvents,
  recreateDatabase,
  RetryableProcessingError,
  runRetryTick,
  type WebhookEventStore,
} from "@hookx/storage";
import {
  createSignatureVerifierRegistry,
  createWebhookIdentity,
  signSyntheticWebhook,
  SYNTHETIC_SIGNATURE_HEADER,
  syntheticHoldPayload,
  syntheticOpenedPayload,
  syntheticSettledPayload,
  unixSecondsFromInstant,
  unknownSyntheticEventPayload,
} from "@hookx/webhook";
import { createApp } from "../app.js";
import { fixedClock } from "../clock.js";

const SECRET = "dev-only-synthetic-webhook-secret";
const NOW = instant("2026-01-15T10:00:01.000Z");
const NOW_UNIX = unixSecondsFromInstant(NOW);
const PROVIDER = providerId("SYNTHETIC");
const POLICY = { maxAttempts: 5, baseDelayMs: 1_000, maxDelayMs: 8_000 };
const LEASE_MS = 2_000;

function pipelineTestDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const parsed = new URL(defaultTestDatabaseUrl(env));
  parsed.pathname = "/hookx_pipeline_test";
  return parsed.toString();
}

const TEST_URL = pipelineTestDatabaseUrl(process.env);

function verifierRegistry() {
  return createSignatureVerifierRegistry({
    syntheticSecret: SECRET,
    syntheticToleranceSeconds: 300,
  });
}

function signRaw(rawBody: string): string {
  return signSyntheticWebhook({
    secret: SECRET,
    rawBody,
    timestampSeconds: NOW_UNIX,
  });
}

describe("end-to-end webhook processing pipeline", () => {
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
        retryPolicy: POLICY,
        leaseMs: LEASE_MS,
        verifiers: verifierRegistry(),
        clock: fixedClock(NOW),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "unknown database error";
      throw new Error(
        `HOOKX pipeline e2e tests require PostgreSQL. Cause: ${message}`,
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
    const headers: Record<string, string> = {
      "content-type": "application/json",
      [SYNTHETIC_SIGNATURE_HEADER]: signRaw(rawBody),
    };
    if (options.requestId !== undefined) {
      headers["x-request-id"] = options.requestId;
    }
    return app.request("/webhooks/SYNTHETIC", {
      method: "POST",
      headers,
      body: rawBody,
    });
  }

  async function readJson(response: Response): Promise<Record<string, unknown>> {
    return (await response.json()) as Record<string, unknown>;
  }

  it("1/5/14/15 valid first delivery persists, processes, audits, and correlates", async () => {
    const eventRef = `SYNTHETIC:evt:${randomUUID()}`;
    const paymentRef = `SYNTHETIC:pay:${randomUUID()}`;
    const requestId = `corr-${randomUUID()}`;
    const response = await postSigned(
      syntheticOpenedPayload({ event_ref: eventRef, payment_ref: paymentRef }),
      { requestId },
    );
    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({
      status: "accepted",
      requestId,
    });
    expect(response.headers.get("x-request-id")).toBe(requestId);

    const stored = await store.repository.findByIdentity(
      createWebhookIdentity("SYNTHETIC", eventRef),
    );
    expect(stored?.processingStatus).toBe("PROCESSED");
    expect(
      await store.payments.get(PROVIDER, paymentId(paymentRef)),
    ).toMatchObject({ state: "CREATED" });

    const audit = await store.audit.listByCorrelationId(requestId);
    expect(audit.map((row) => row.eventType)).toEqual([
      "WEBHOOK_RECEIVED",
      "PAYMENT_STATE_CHANGED",
    ]);
    expect(audit.every((row) => row.correlationId === requestId)).toBe(true);
    expect(JSON.stringify(audit)).not.toContain(SECRET);
  });

  it("2/failure path: invalid signature rejects without persist or payment mutation", async () => {
    const eventRef = `SYNTHETIC:evt:${randomUUID()}`;
    const paymentRef = `SYNTHETIC:pay:${randomUUID()}`;
    const rawBody = JSON.stringify(
      syntheticOpenedPayload({ event_ref: eventRef, payment_ref: paymentRef }),
    );
    const valid = signRaw(rawBody);
    const invalid = `${valid.slice(0, -1)}${valid.endsWith("a") ? "b" : "a"}`;
    const requestId = `corr-${randomUUID()}`;
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
    const body = await readJson(response);
    expect(body).toEqual({
      status: "unauthorized",
      requestId,
      code: "INVALID_SIGNATURE",
    });
    expect(body).not.toHaveProperty("stack");
    expect(
      await store.repository.findByIdentity(
        createWebhookIdentity("SYNTHETIC", eventRef),
      ),
    ).toBeNull();
    expect(await store.payments.get(PROVIDER, paymentId(paymentRef))).toBeNull();
    expect(
      (await store.audit.listByCorrelationId(requestId)).map(
        (row) => row.eventType,
      ),
    ).toEqual(["WEBHOOK_REJECTED"]);
  });

  it("3 malformed payload after a valid signature is a bad request", async () => {
    const rawBody = "{not-json";
    const response = await postSigned({}, { rawBody });
    expect(response.status).toBe(400);
    expect((await readJson(response)).code).toBe("INVALID_PAYLOAD");
  });

  it("4 unsupported event is rejected before persistence", async () => {
    const payload = unknownSyntheticEventPayload();
    const response = await postSigned(payload);
    expect(response.status).toBe(400);
    expect((await readJson(response)).code).toBe("UNSUPPORTED_EVENT");
    const eventRef = (payload as { event_ref: string }).event_ref;
    expect(
      await store.repository.findByIdentity(
        createWebhookIdentity("SYNTHETIC", eventRef),
      ),
    ).toBeNull();
  });

  it("6/21 duplicate path: one event, one transition, duplicate audit", async () => {
    const eventRef = `SYNTHETIC:evt:${randomUUID()}`;
    const paymentRef = `SYNTHETIC:pay:${randomUUID()}`;
    const payload = syntheticOpenedPayload({
      event_ref: eventRef,
      payment_ref: paymentRef,
    });
    const firstId = `corr-${randomUUID()}`;
    const secondId = `corr-${randomUUID()}`;
    const first = await postSigned(payload, { requestId: firstId });
    const second = await postSigned(payload, { requestId: secondId });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await readJson(second)).status).toBe("duplicate");

    const listed = await store.repository.listByPayment(
      PROVIDER,
      paymentId(paymentRef),
    );
    expect(listed).toHaveLength(1);
    expect(await store.payments.get(PROVIDER, paymentId(paymentRef))).toMatchObject(
      { state: "CREATED" },
    );
    expect(
      (await store.audit.listByPayment(paymentId(paymentRef))).filter(
        (row) => row.eventType === "PAYMENT_STATE_CHANGED",
      ),
    ).toHaveLength(1);
    expect(
      (await store.audit.listByCorrelationId(secondId)).map(
        (row) => row.eventType,
      ),
    ).toEqual(["WEBHOOK_DUPLICATE"]);
  });

  it("7/22 conflict path: original event and payment stay unchanged", async () => {
    const eventRef = `SYNTHETIC:evt:${randomUUID()}`;
    const paymentRef = `SYNTHETIC:pay:${randomUUID()}`;
    await postSigned(
      syntheticOpenedPayload({
        event_ref: eventRef,
        payment_ref: paymentRef,
        minor_units: "10000",
      }),
    );
    const requestId = `corr-${randomUUID()}`;
    const conflict = await postSigned(
      syntheticOpenedPayload({
        event_ref: eventRef,
        payment_ref: paymentRef,
        minor_units: "25000",
      }),
      { requestId },
    );
    expect(conflict.status).toBe(409);
    expect((await readJson(conflict)).code).toBe("CONFLICT");

    const stored = await store.repository.findByIdentity(
      createWebhookIdentity("SYNTHETIC", eventRef),
    );
    expect(stored?.event.amountMinor).toBe(10000n);
    expect(await store.payments.get(PROVIDER, paymentId(paymentRef))).toMatchObject(
      { state: "CREATED", amountMinor: 10000n },
    );
    expect(
      (await store.audit.listByCorrelationId(requestId)).map(
        (row) => row.eventType,
      ),
    ).toEqual(["WEBHOOK_CONFLICT"]);
  });

  it("8/9 out-of-order capture stays delayed until authorization arrives", async () => {
    const paymentRef = `SYNTHETIC:pay:${randomUUID()}`;
    const createdRef = `SYNTHETIC:evt:${randomUUID()}`;
    const capturedRef = `SYNTHETIC:evt:${randomUUID()}`;
    const authorizedRef = `SYNTHETIC:evt:${randomUUID()}`;

    expect(
      (
        await postSigned(
          syntheticOpenedPayload({
            event_ref: createdRef,
            payment_ref: paymentRef,
            booked_at: "2026-01-15T10:00:00.000Z",
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      await store.payments.get(PROVIDER, paymentId(paymentRef)),
    ).toMatchObject({ state: "CREATED" });

    const delayedId = `corr-${randomUUID()}`;
    const captured = await postSigned(
      syntheticSettledPayload({
        event_ref: capturedRef,
        payment_ref: paymentRef,
        booked_at: "2026-01-15T10:00:02.000Z",
      }),
      { requestId: delayedId },
    );
    expect(captured.status).toBe(200);
    expect(
      await store.payments.get(PROVIDER, paymentId(paymentRef)),
    ).toMatchObject({ state: "CREATED" });
    const capturedStored = await store.repository.findByIdentity(
      createWebhookIdentity("SYNTHETIC", capturedRef),
    );
    expect(capturedStored?.processingStatus).toBe("PROCESSED");
    expect(
      (await store.audit.listByCorrelationId(delayedId)).map(
        (row) => row.eventType,
      ),
    ).toEqual(["WEBHOOK_RECEIVED", "WEBHOOK_DELAYED"]);

    const authorized = await postSigned(
      syntheticHoldPayload({
        event_ref: authorizedRef,
        payment_ref: paymentRef,
        booked_at: "2026-01-15T10:00:01.000Z",
      }),
    );
    expect(authorized.status).toBe(200);
    expect(
      await store.payments.get(PROVIDER, paymentId(paymentRef)),
    ).toMatchObject({ state: "CAPTURED" });

    const replay = await processPaymentEvents(
      store.repository,
      PROVIDER,
      paymentId(paymentRef),
    );
    expect(replay.payment?.state).toBe("CAPTURED");
    expect(replay.delayed).toHaveLength(0);
    expect(
      replay.decisions.map((row) => `${row.eventId}:${row.decision}`),
    ).toEqual(
      expect.arrayContaining([
        `${createdRef}:ACCEPTED`,
        `${authorizedRef}:ACCEPTED`,
        `${capturedRef}:ACCEPTED`,
      ]),
    );
  });

  it("10 invalid later created event does not mutate payment state", async () => {
    const paymentRef = `SYNTHETIC:pay:${randomUUID()}`;
    const firstRef = `SYNTHETIC:evt:created-a-${randomUUID()}`;
    const secondRef = `SYNTHETIC:evt:created-b-${randomUUID()}`;
    expect(
      (
        await postSigned(
          syntheticOpenedPayload({
            event_ref: firstRef,
            payment_ref: paymentRef,
            booked_at: "2026-01-15T10:00:00.000Z",
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      await store.repository.listByPayment(PROVIDER, paymentId(paymentRef)),
    ).toHaveLength(1);

    const second = await postSigned(
      syntheticOpenedPayload({
        event_ref: secondRef,
        payment_ref: paymentRef,
        booked_at: "2026-01-15T10:00:01.000Z",
      }),
    );
    expect(second.status).toBe(200);
    expect(await store.payments.get(PROVIDER, paymentId(paymentRef))).toMatchObject(
      { state: "CREATED" },
    );
    const events = await store.repository.listByPayment(
      PROVIDER,
      paymentId(paymentRef),
    );
    expect(events).toHaveLength(2);
    const secondStored = events.find(
      (row) => row.event.externalEventId === secondRef,
    );
    expect(secondStored?.processingStatus).toBe("CONFLICT");
    expect(
      (await store.retry.getByWebhookEventId(secondStored!.id))?.status,
    ).toBe("DEAD_LETTERED");
    expect(
      (await store.audit.listByPayment(paymentId(paymentRef))).filter(
        (row) => row.eventType === "PAYMENT_STATE_CHANGED",
      ),
    ).toHaveLength(1);
  });

  it("11 retryable processing failure returns 500, keeps the event, then recovers", async () => {
    const eventRef = `SYNTHETIC:evt:${randomUUID()}`;
    const paymentRef = `SYNTHETIC:pay:${randomUUID()}`;
    const payload = syntheticOpenedPayload({
      event_ref: eventRef,
      payment_ref: paymentRef,
    });
    const rawBody = JSON.stringify(payload);
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
      audit: store.audit,
      payments: store.payments,
      persistOutcome: store.persistOutcome,
      retryPolicy: POLICY,
      leaseMs: LEASE_MS,
      processPaymentEvents: processFn,
      verifiers: verifierRegistry(),
      clock: fixedClock(NOW),
    });
    const requestId = `corr-${randomUUID()}`;
    const response = await retryApp.request("/webhooks/SYNTHETIC", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": requestId,
        [SYNTHETIC_SIGNATURE_HEADER]: signRaw(rawBody),
      },
      body: rawBody,
    });
    expect(response.status).toBe(500);
    expect(await readJson(response)).toEqual({
      status: "error",
      requestId,
      code: "TEMPORARY_PROCESSING_FAILURE",
    });
    const stored = await store.repository.findByIdentity(
      createWebhookIdentity("SYNTHETIC", eventRef),
    );
    expect(stored).not.toBeNull();
    expect(await store.payments.get(PROVIDER, paymentId(paymentRef))).toBeNull();
    expect(
      (await store.retry.getByWebhookEventId(stored!.id))?.status,
    ).toBe("RETRY_SCHEDULED");
    expect(
      (await store.audit.listByCorrelationId(requestId)).map(
        (row) => row.eventType,
      ),
    ).toEqual(["WEBHOOK_RECEIVED", "RETRY_SCHEDULED"]);

    const tick = await runRetryTick(
      {
        retry: store.retry,
        events: store.repository,
        policy: POLICY,
        leaseMs: LEASE_MS,
        processPaymentEvents: processFn,
        audit: store.audit,
        persistOutcome: store.persistOutcome,
        actor: "RETRY_WORKER",
      },
      addMilliseconds(NOW, 1_000),
    );
    expect(tick.succeeded).toBe(1);
    expect(await store.payments.get(PROVIDER, paymentId(paymentRef))).toMatchObject(
      { state: "CREATED" },
    );
  });

  it("12 permanent processing failure is dead-lettered without extra retries", async () => {
    const eventRef = `SYNTHETIC:evt:${randomUUID()}`;
    const paymentRef = `SYNTHETIC:pay:${randomUUID()}`;
    const rawBody = JSON.stringify(
      syntheticOpenedPayload({ event_ref: eventRef, payment_ref: paymentRef }),
    );
    const failApp = createApp({
      repository: store.repository,
      retry: store.retry,
      audit: store.audit,
      payments: store.payments,
      persistOutcome: store.persistOutcome,
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
        [SYNTHETIC_SIGNATURE_HEADER]: signRaw(rawBody),
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
    expect(await store.payments.get(PROVIDER, paymentId(paymentRef))).toBeNull();
    const later = await runRetryTick(
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
    expect(later.claimed).toBe(0);
  });

  it("13 concurrent identical deliveries produce one event and one transition", async () => {
    const eventRef = `SYNTHETIC:evt:${randomUUID()}`;
    const paymentRef = `SYNTHETIC:pay:${randomUUID()}`;
    const payload = syntheticOpenedPayload({
      event_ref: eventRef,
      payment_ref: paymentRef,
    });
    const rawBody = JSON.stringify(payload);
    const signature = signRaw(rawBody);
    const [first, second] = await Promise.all([
      app.request("/webhooks/SYNTHETIC", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [SYNTHETIC_SIGNATURE_HEADER]: signature,
        },
        body: rawBody,
      }),
      app.request("/webhooks/SYNTHETIC", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [SYNTHETIC_SIGNATURE_HEADER]: signature,
        },
        body: rawBody,
      }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 200]);
    const bodies = [await readJson(first), await readJson(second)];
    const outcomes = bodies.map((row) => row.status).sort();
    expect(outcomes).toEqual(["accepted", "duplicate"]);
    expect(
      await store.repository.listByPayment(PROVIDER, paymentId(paymentRef)),
    ).toHaveLength(1);
    expect(await store.payments.get(PROVIDER, paymentId(paymentRef))).toMatchObject(
      { state: "CREATED" },
    );
    expect(
      (await store.audit.listByPayment(paymentId(paymentRef))).filter(
        (row) => row.eventType === "PAYMENT_STATE_CHANGED",
      ),
    ).toHaveLength(1);
  });

  it("19 happy path: created → authorized → captured with durable state and audit", async () => {
    const paymentRef = `SYNTHETIC:pay:${randomUUID()}`;
    const created = await postSigned(
      syntheticOpenedPayload({
        event_ref: `SYNTHETIC:evt:${randomUUID()}`,
        payment_ref: paymentRef,
        booked_at: "2026-01-15T10:00:00.000Z",
      }),
    );
    expect(created.status).toBe(200);
    expect(
      (
        await readJson(
          await app.request(`/payments/${encodeURIComponent(paymentRef)}`),
        )
      ).payment,
    ).toMatchObject({ state: "CREATED" });

    const authorized = await postSigned(
      syntheticHoldPayload({
        event_ref: `SYNTHETIC:evt:${randomUUID()}`,
        payment_ref: paymentRef,
        booked_at: "2026-01-15T10:00:01.000Z",
      }),
    );
    expect(authorized.status).toBe(200);
    expect(
      await store.payments.get(PROVIDER, paymentId(paymentRef)),
    ).toMatchObject({ state: "AUTHORIZED" });

    const captured = await postSigned(
      syntheticSettledPayload({
        event_ref: `SYNTHETIC:evt:${randomUUID()}`,
        payment_ref: paymentRef,
        booked_at: "2026-01-15T10:00:02.000Z",
      }),
    );
    expect(captured.status).toBe(200);
    expect(
      await store.payments.get(PROVIDER, paymentId(paymentRef)),
    ).toMatchObject({ state: "CAPTURED" });

    const transitions = (
      await store.audit.listByPayment(paymentId(paymentRef))
    )
      .filter((row) => row.eventType === "PAYMENT_STATE_CHANGED")
      .map((row) => `${row.previousState ?? "NONE"}->${row.resultingState}`);
    expect(transitions).toEqual([
      "NONE->CREATED",
      "CREATED->AUTHORIZED",
      "AUTHORIZED->CAPTURED",
    ]);
  });
});
