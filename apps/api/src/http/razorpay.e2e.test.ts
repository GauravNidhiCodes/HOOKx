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
  createWebhookIdentity,
  RAZORPAY_EVENT_ID_HEADER,
  RAZORPAY_SIGNATURE_HEADER,
  razorpayMalformedPayload,
  razorpayPaymentAuthorizedPayload,
  razorpayPaymentCapturedPayload,
  razorpayUnsupportedEventPayload,
  signRazorpayWebhook,
} from "@hookx/webhook";
import { createApp } from "../app.js";
import { fixedClock } from "../clock.js";

const SYNTHETIC_SECRET = "dev-only-synthetic-webhook-secret";
const RAZORPAY_SECRET = "dev-only-razorpay-webhook-secret";
const NOW = instant("2026-01-15T10:00:01.000Z");
const PROVIDER = providerId("razorpay");
const POLICY = { maxAttempts: 5, baseDelayMs: 1_000, maxDelayMs: 8_000 };
const LEASE_MS = 2_000;

function razorpayTestDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const parsed = new URL(defaultTestDatabaseUrl(env));
  parsed.pathname = "/hookx_razorpay_test";
  return parsed.toString();
}

const TEST_URL = razorpayTestDatabaseUrl(process.env);

describe("Razorpay webhook ingest through the real pipeline", () => {
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
        persistOutcome: store.persistOutcome,
        payments: store.payments,
        exceptions: store.exceptions,
        retryPolicy: POLICY,
        leaseMs: LEASE_MS,
        verifiers: createSignatureVerifierRegistry({
          syntheticSecret: SYNTHETIC_SECRET,
          syntheticToleranceSeconds: 300,
          razorpayWebhookSecret: RAZORPAY_SECRET,
        }),
        clock: fixedClock(NOW),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "unknown database error";
      throw new Error(
        `HOOKX Razorpay e2e tests require PostgreSQL. Cause: ${message}`,
        { cause: error },
      );
    }
  }, 30_000);

  afterAll(async () => {
    if (store !== undefined) {
      await store.close();
    }
  });

  async function postRazorpay(input: {
    readonly payload: unknown;
    readonly eventId: string;
    readonly requestId?: string;
    readonly signature?: string | null;
    readonly rawBody?: string;
  }): Promise<Response> {
    const rawBody = input.rawBody ?? JSON.stringify(input.payload);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      [RAZORPAY_EVENT_ID_HEADER]: input.eventId,
    };
    if (input.requestId !== undefined) {
      headers["x-request-id"] = input.requestId;
    }
    if (input.signature !== null) {
      headers[RAZORPAY_SIGNATURE_HEADER] =
        input.signature ??
        signRazorpayWebhook({ secret: RAZORPAY_SECRET, rawBody });
    }
    return app.request("/webhooks/razorpay", {
      method: "POST",
      headers,
      body: rawBody,
    });
  }

  async function readJson(response: Response): Promise<Record<string, unknown>> {
    return (await response.json()) as Record<string, unknown>;
  }

  it("accepts a valid signed Razorpay payment.authorized through the pipeline", async () => {
    const eventId = `evt_${randomUUID()}`;
    const payId = `pay_${randomUUID()}`;
    const requestId = `corr-${randomUUID()}`;
    const payload = razorpayPaymentAuthorizedPayload({ id: payId });
    const response = await postRazorpay({ payload, eventId, requestId });
    const body = await readJson(response);
    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: "accepted",
      requestId,
    });
    expect(JSON.stringify(body)).not.toContain(RAZORPAY_SECRET);
    const stored = await store.repository.findByIdentity(
      createWebhookIdentity("razorpay", eventId),
    );
    expect(stored?.processingStatus).toBe("PROCESSED");
    expect(stored?.event.eventType).toBe("payment.authorized");
    expect(stored?.event.paymentId).toBe(payId);
    expect(stored?.event.amountMinor).toBe(10000n);
    expect(stored?.event.currency).toBe("INR");
    const audit = await store.audit.listByCorrelationId(requestId);
    expect(audit.map((row) => row.eventType)).toContain("WEBHOOK_RECEIVED");
    expect(JSON.stringify(audit)).not.toContain(RAZORPAY_SECRET);
  });

  it("rejects an invalid signature before normalization or persist", async () => {
    const eventId = `evt_${randomUUID()}`;
    const rawBody = JSON.stringify(razorpayPaymentAuthorizedPayload());
    const valid = signRazorpayWebhook({ secret: RAZORPAY_SECRET, rawBody });
    const invalid = `${valid.slice(0, -1)}${valid.endsWith("a") ? "b" : "a"}`;
    const response = await postRazorpay({
      payload: razorpayPaymentAuthorizedPayload(),
      eventId,
      rawBody,
      signature: invalid,
    });
    expect(response.status).toBe(401);
    expect((await readJson(response)).code).toBe("INVALID_SIGNATURE");
    expect(
      await store.repository.findByIdentity(
        createWebhookIdentity("razorpay", eventId),
      ),
    ).toBeNull();
  });

  it("treats a second identical signed delivery as a duplicate", async () => {
    const eventId = `evt_${randomUUID()}`;
    const payId = `pay_${randomUUID()}`;
    const payload = razorpayPaymentAuthorizedPayload({ id: payId });
    const first = await postRazorpay({ payload, eventId });
    const second = await postRazorpay({ payload, eventId });
    expect(first.status).toBe(200);
    expect((await readJson(first)).status).toBe("accepted");
    expect(second.status).toBe(200);
    expect((await readJson(second)).status).toBe("duplicate");
    const listed = await store.repository.listByPayment(
      PROVIDER,
      paymentId(payId),
    );
    expect(listed).toHaveLength(1);
  });

  it("keeps the original row on a same-identity payload-hash conflict", async () => {
    const eventId = `evt_${randomUUID()}`;
    const payId = `pay_${randomUUID()}`;
    const original = razorpayPaymentAuthorizedPayload({
      id: payId,
      amount: 10000,
    });
    const conflicting = razorpayPaymentAuthorizedPayload({
      id: payId,
      amount: 25000,
    });
    expect((await postRazorpay({ payload: original, eventId })).status).toBe(200);
    const response = await postRazorpay({ payload: conflicting, eventId });
    expect(response.status).toBe(409);
    expect((await readJson(response)).code).toBe("CONFLICT");
    const stored = await store.repository.findByIdentity(
      createWebhookIdentity("razorpay", eventId),
    );
    expect(stored?.event.amountMinor).toBe(10000n);
    const exceptions = await store.exceptions.listByPayment(paymentId(payId));
    expect(exceptions.some((row) => row.exceptionCode === "CONFLICTING_EVENT")).toBe(
      true,
    );
  });

  it("does not persist a malformed Razorpay payload after verification", async () => {
    const eventId = `evt_${randomUUID()}`;
    const response = await postRazorpay({
      payload: razorpayMalformedPayload(),
      eventId,
    });
    expect(response.status).toBe(400);
    expect((await readJson(response)).code).toBe("INVALID_PAYLOAD");
    expect(
      await store.repository.findByIdentity(
        createWebhookIdentity("razorpay", eventId),
      ),
    ).toBeNull();
  });

  it("does not persist an unsupported Razorpay event", async () => {
    const eventId = `evt_${randomUUID()}`;
    const response = await postRazorpay({
      payload: razorpayUnsupportedEventPayload(),
      eventId,
    });
    expect(response.status).toBe(400);
    expect((await readJson(response)).code).toBe("UNSUPPORTED_EVENT");
    expect(
      await store.repository.findByIdentity(
        createWebhookIdentity("razorpay", eventId),
      ),
    ).toBeNull();
  });

  it("does not invent a payment.created event when capture arrives first", async () => {
    const payId = `pay_${randomUUID()}`;
    const capturedId = `evt_${randomUUID()}`;
    const authorizedId = `evt_${randomUUID()}`;
    const captured = await postRazorpay({
      payload: razorpayPaymentCapturedPayload({ id: payId }),
      eventId: capturedId,
    });
    const authorized = await postRazorpay({
      payload: razorpayPaymentAuthorizedPayload({ id: payId }),
      eventId: authorizedId,
    });
    expect(captured.status).toBe(200);
    expect(authorized.status).toBe(200);
    const listed = await store.repository.listByPayment(PROVIDER, paymentId(payId));
    expect(listed.map((row) => row.event.eventType).sort()).toEqual([
      "payment.authorized",
      "payment.captured",
    ]);
    expect(await store.payments.get(PROVIDER, paymentId(payId))).toBeNull();
  });
});
