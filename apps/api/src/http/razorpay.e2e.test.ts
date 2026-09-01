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
  RAZORPAY_EVENT_ID_HEADER,
  RAZORPAY_SIGNATURE_HEADER,
  razorpayMalformedPayload,
  razorpayMissingPaymentIdPayload,
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
        investigations: store.investigations,
        investigator: new StubInvestigator(),
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

  it("ten sequential identical Razorpay deliveries produce one stored event", async () => {
    const eventId = `evt_${randomUUID()}`;
    const payId = `pay_${randomUUID()}`;
    const payload = razorpayPaymentAuthorizedPayload({ id: payId });
    const statuses: string[] = [];
    for (let index = 0; index < 10; index += 1) {
      const response = await postRazorpay({ payload, eventId });
      expect(response.status).toBe(200);
      statuses.push(String((await readJson(response)).status));
    }
    expect(statuses.filter((status) => status === "accepted")).toHaveLength(1);
    expect(statuses.filter((status) => status === "duplicate")).toHaveLength(9);
    expect(
      await store.repository.listByPayment(PROVIDER, paymentId(payId)),
    ).toHaveLength(1);
    expect(
      (await store.audit.listByPayment(paymentId(payId))).filter(
        (row) => row.eventType === "PAYMENT_STATE_CHANGED",
      ),
    ).toHaveLength(0);
  });

  it("concurrent identical Razorpay deliveries produce one stored event", async () => {
    const eventId = `evt_${randomUUID()}`;
    const payId = `pay_${randomUUID()}`;
    const payload = razorpayPaymentAuthorizedPayload({ id: payId });
    const rawBody = JSON.stringify(payload);
    const signature = signRazorpayWebhook({ secret: RAZORPAY_SECRET, rawBody });
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        postRazorpay({ payload, eventId, rawBody, signature }),
      ),
    );
    expect(responses.map((row) => row.status)).toEqual(Array(8).fill(200));
    const bodies = await Promise.all(responses.map((row) => readJson(row)));
    const outcomes = bodies.map((row) => row.status);
    expect(outcomes.filter((status) => status === "accepted")).toHaveLength(1);
    expect(outcomes.filter((status) => status === "duplicate")).toHaveLength(7);
    expect(
      await store.repository.listByPayment(PROVIDER, paymentId(payId)),
    ).toHaveLength(1);
    expect(JSON.stringify(bodies)).not.toContain(RAZORPAY_SECRET);
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

  it("rejects a missing Razorpay event id after a valid signature", async () => {
    const payload = razorpayPaymentAuthorizedPayload();
    const rawBody = JSON.stringify(payload);
    const response = await app.request("/webhooks/razorpay", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [RAZORPAY_SIGNATURE_HEADER]: signRazorpayWebhook({
          secret: RAZORPAY_SECRET,
          rawBody,
        }),
      },
      body: rawBody,
    });
    expect(response.status).toBe(400);
    expect((await readJson(response)).code).toBe("MISSING_EXTERNAL_ID");
  });

  it("rejects a missing payment reference", async () => {
    const response = await postRazorpay({
      payload: razorpayMissingPaymentIdPayload(),
      eventId: `evt_${randomUUID()}`,
    });
    expect(response.status).toBe(400);
    expect((await readJson(response)).code).toBe("MISSING_PAYMENT_ID");
  });

  it("rejects an invalid amount", async () => {
    const response = await postRazorpay({
      payload: razorpayPaymentAuthorizedPayload({ amount: 10.5 }),
      eventId: `evt_${randomUUID()}`,
    });
    expect(response.status).toBe(400);
    expect((await readJson(response)).code).toBe("INVALID_AMOUNT");
  });

  it("stores zero and smallest-unit Razorpay amounts as bigint minor units", async () => {
    const zeroId = `evt_${randomUUID()}`;
    const zeroPay = `pay_${randomUUID()}`;
    const zero = await postRazorpay({
      payload: razorpayPaymentAuthorizedPayload({ id: zeroPay, amount: 0 }),
      eventId: zeroId,
    });
    expect(zero.status).toBe(200);
    expect(
      (await store.repository.findByIdentity(
        createWebhookIdentity("razorpay", zeroId),
      ))?.event.amountMinor,
    ).toBe(0n);

    const unitId = `evt_${randomUUID()}`;
    const unitPay = `pay_${randomUUID()}`;
    const unit = await postRazorpay({
      payload: razorpayPaymentAuthorizedPayload({ id: unitPay, amount: 1 }),
      eventId: unitId,
    });
    expect(unit.status).toBe(200);
    expect(
      (await store.repository.findByIdentity(
        createWebhookIdentity("razorpay", unitId),
      ))?.event.amountMinor,
    ).toBe(1n);
  });

  it("stores a large safe-integer Razorpay amount as bigint", async () => {
    const eventId = `evt_${randomUUID()}`;
    const payId = `pay_${randomUUID()}`;
    const amount = Number.MAX_SAFE_INTEGER;
    const response = await postRazorpay({
      payload: razorpayPaymentAuthorizedPayload({ id: payId, amount }),
      eventId,
    });
    expect(response.status).toBe(200);
    expect(
      (await store.repository.findByIdentity(
        createWebhookIdentity("razorpay", eventId),
      ))?.event.amountMinor,
    ).toBe(BigInt(amount));
  });

  it("rejects a negative Razorpay amount", async () => {
    const response = await postRazorpay({
      payload: razorpayPaymentAuthorizedPayload({ amount: -1 }),
      eventId: `evt_${randomUUID()}`,
    });
    expect(response.status).toBe(400);
    expect((await readJson(response)).code).toBe("INVALID_AMOUNT");
  });

  it("rejects an invalid currency", async () => {
    const response = await postRazorpay({
      payload: razorpayPaymentAuthorizedPayload({ currency: "IN" }),
      eventId: `evt_${randomUUID()}`,
    });
    expect(response.status).toBe(400);
    expect((await readJson(response)).code).toBe("INVALID_CURRENCY");
  });

  it("rejects malformed JSON after signature verification", async () => {
    const rawBody = "{not-json";
    const eventId = `evt_${randomUUID()}`;
    const response = await postRazorpay({
      payload: {},
      eventId,
      rawBody,
      signature: signRazorpayWebhook({ secret: RAZORPAY_SECRET, rawBody }),
    });
    expect(response.status).toBe(400);
    expect((await readJson(response)).code).toBe("INVALID_PAYLOAD");
    expect(
      await store.repository.findByIdentity(
        createWebhookIdentity("razorpay", eventId),
      ),
    ).toBeNull();
  });

  it("accepts an integer amount string as minor units", async () => {
    const eventId = `evt_${randomUUID()}`;
    const payId = `pay_${randomUUID()}`;
    const response = await postRazorpay({
      payload: razorpayPaymentAuthorizedPayload({
        id: payId,
        amount: "10000",
      }),
      eventId,
    });
    expect(response.status).toBe(200);
    const stored = await store.repository.findByIdentity(
      createWebhookIdentity("razorpay", eventId),
    );
    expect(stored?.event.amountMinor).toBe(10000n);
    expect(stored?.event.occurredAt).not.toBe(stored?.event.receivedAt);
    expect(stored?.event.receivedAt).toBe(NOW);
  });

  it("preserves provider timestamps on an out-of-order Razorpay pair", async () => {
    const payId = `pay_${randomUUID()}`;
    const capturedId = `evt_${randomUUID()}`;
    const authorizedId = `evt_${randomUUID()}`;
    await postRazorpay({
      payload: razorpayPaymentCapturedPayload({ id: payId }),
      eventId: capturedId,
    });
    await postRazorpay({
      payload: razorpayPaymentAuthorizedPayload({ id: payId }),
      eventId: authorizedId,
    });
    const listed = await store.repository.listByPayment(
      PROVIDER,
      paymentId(payId),
    );
    const captured = listed.find(
      (row) => row.event.externalEventId === capturedId,
    );
    const authorized = listed.find(
      (row) => row.event.externalEventId === authorizedId,
    );
    expect(captured?.event.occurredAt).toBe("2023-11-14T22:13:22.000Z");
    expect(authorized?.event.occurredAt).toBe("2023-11-14T22:13:20.000Z");
    expect(captured?.event.receivedAt).toBe(NOW);
    expect(authorized?.event.receivedAt).toBe(NOW);
    expect(await store.payments.get(PROVIDER, paymentId(payId))).toBeNull();
  });

  it("runs conflict through exception, timeline, and stub investigation without raw Razorpay payloads", async () => {
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
    expect((await postRazorpay({ payload: original, eventId })).status).toBe(
      200,
    );
    expect(
      (await postRazorpay({ payload: conflicting, eventId })).status,
    ).toBe(409);
    const exceptions = await store.exceptions.listByPayment(paymentId(payId));
    const conflict = exceptions.find(
      (row) => row.exceptionCode === "CONFLICTING_EVENT",
    );
    expect(conflict).toBeDefined();
    const id = conflict!.exceptionId;
    const timeline = await app.request(`/incidents/${id}/timeline`);
    expect(timeline.status).toBe(200);
    const timelineBody = JSON.stringify(await timeline.json());
    expect(timelineBody).not.toContain(RAZORPAY_SECRET);
    expect(timelineBody).not.toContain("payload.payment");
    const investigated = await app.request(`/incidents/${id}/investigate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(investigated.status).toBe(200);
    const body = JSON.stringify(await investigated.json());
    expect(body).not.toContain(RAZORPAY_SECRET);
    expect(body).not.toContain("payload.payment");
    expect(body).not.toMatch(/x-razorpay-signature/i);
    expect(body).not.toContain("payloadHash");
    expect(body).toContain("CONFLICT");
  });
});
