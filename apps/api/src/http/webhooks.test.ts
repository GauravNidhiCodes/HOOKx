import { describe, expect, it } from "vitest";
import { instant } from "@hookx/domain";
import {
  createSignatureVerifierRegistry,
  RAZORPAY_EVENT_ID_HEADER,
  RAZORPAY_FIXTURE_EVENT_ID,
  RAZORPAY_SIGNATURE_HEADER,
  razorpayPaymentAuthorizedPayload,
  signRazorpayWebhook,
  invalidAmountSyntheticPayload,
  invalidCurrencySyntheticPayload,
  malformedSyntheticPayload,
  signSyntheticWebhook,
  SYNTHETIC_SIGNATURE_HEADER,
  syntheticOpenedPayload,
  unixSecondsFromInstant,
  unknownSyntheticEventPayload,
} from "@hookx/webhook";
import {
  createSequentialOutcomeWriter,
  MemoryAuditRepository,
  MemoryPaymentRepository,
  MemoryRetryRepository,
} from "@hookx/storage";
import { createApp } from "../app.js";
import { fixedClock } from "../clock.js";
import { MemoryWebhookEventRepository } from "../test-support/memory-webhook-repository.js";

const SECRET = "dev-only-synthetic-webhook-secret";
const NOW = instant("2026-01-15T10:00:01.000Z");
const NOW_UNIX = unixSecondsFromInstant(NOW);

function createTestApp(repository = new MemoryWebhookEventRepository()) {
  const retry = new MemoryRetryRepository();
  const audit = new MemoryAuditRepository();
  const payments = new MemoryPaymentRepository();
  const app = createApp({
    repository,
    retry,
    audit,
    payments,
    persistOutcome: createSequentialOutcomeWriter(repository, audit, payments),
    verifiers: createSignatureVerifierRegistry({
      syntheticSecret: SECRET,
      syntheticToleranceSeconds: 300,
    }),
    clock: fixedClock(NOW),
  });
  return { app, repository, retry, audit, payments };
}

async function postSigned(
  app: ReturnType<typeof createApp>,
  options: {
    readonly provider?: string;
    readonly payload?: unknown;
    readonly rawBody?: string;
    readonly secret?: string;
    readonly signature?: string | null;
    readonly requestId?: string;
  },
): Promise<Response> {
  const rawBody =
    options.rawBody ?? JSON.stringify(options.payload ?? syntheticOpenedPayload());
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (options.requestId !== undefined) {
    headers["x-request-id"] = options.requestId;
  }
  if (options.signature !== null) {
    headers[SYNTHETIC_SIGNATURE_HEADER] =
      options.signature ??
      signSyntheticWebhook({
        secret: options.secret ?? SECRET,
        rawBody,
        timestampSeconds: NOW_UNIX,
      });
  }
  return app.request(`/webhooks/${options.provider ?? "SYNTHETIC"}`, {
    method: "POST",
    headers,
    body: rawBody,
  });
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("POST /webhooks/:provider", () => {
  it("accepts a valid signed webhook", async () => {
    const { app } = createTestApp();
    const response = await postSigned(app, {
      payload: syntheticOpenedPayload({ event_ref: "SYNTHETIC:evt:http-valid" }),
      requestId: "http-valid",
    });
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body).toEqual({ status: "accepted", requestId: "http-valid" });
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(response.headers.get("x-request-id")).toBe("http-valid");
  });

  it("returns unauthorized for an invalid signature", async () => {
    const { app, repository } = createTestApp();
    const payload = syntheticOpenedPayload({ event_ref: "SYNTHETIC:evt:http-bad-sig" });
    const rawBody = JSON.stringify(payload);
    const signature = signSyntheticWebhook({
      secret: SECRET,
      rawBody,
      timestampSeconds: NOW_UNIX,
    });
    const response = await postSigned(app, {
      rawBody,
      signature: `${signature.slice(0, -1)}0`,
    });
    expect(response.status).toBe(401);
    const body = await readJson(response);
    expect(body.code).toBe("INVALID_SIGNATURE");
    expect(body).not.toHaveProperty("stack");
    expect(repository.records).toHaveLength(0);
  });

  it("returns unauthorized when the signature is missing", async () => {
    const { app } = createTestApp();
    const response = await postSigned(app, { signature: null });
    expect(response.status).toBe(401);
    expect((await readJson(response)).code).toBe("MISSING_SIGNATURE");
  });

  it("returns bad request for a malformed signature", async () => {
    const { app } = createTestApp();
    const response = await postSigned(app, { signature: "t=1,v1=nope" });
    expect(response.status).toBe(400);
    expect((await readJson(response)).code).toBe("MALFORMED_SIGNATURE");
  });

  it("returns duplicate for a second identical valid delivery", async () => {
    const { app } = createTestApp();
    const payload = syntheticOpenedPayload({ event_ref: "SYNTHETIC:evt:http-dup" });
    const first = await postSigned(app, { payload });
    const second = await postSigned(app, { payload });
    expect(first.status).toBe(200);
    expect((await readJson(first)).status).toBe("accepted");
    expect(second.status).toBe(200);
    expect((await readJson(second)).status).toBe("duplicate");
  });

  it("returns conflict for a valid signature with a changed payload", async () => {
    const { app, repository } = createTestApp();
    const eventRef = "SYNTHETIC:evt:http-conflict";
    await postSigned(app, {
      payload: syntheticOpenedPayload({ event_ref: eventRef, minor_units: "10000" }),
    });
    const response = await postSigned(app, {
      payload: syntheticOpenedPayload({ event_ref: eventRef, minor_units: "25000" }),
    });
    expect(response.status).toBe(409);
    expect(repository.records[0]?.event.amountMinor).toBe(10000n);
  });

  it("isolates providers: unknown provider is not ingested", async () => {
    const { app, repository } = createTestApp();
    const response = await postSigned(app, { provider: "stripe" });
    expect(response.status).toBe(404);
    expect(repository.storeCalls).toBe(0);
  });

  it("does not treat Razorpay as unknown when the signature is missing", async () => {
    const { app, repository } = createTestApp();
    const response = await postSigned(app, {
      provider: "razorpay",
      signature: null,
    });
    expect(response.status).toBe(401);
    expect((await readJson(response)).code).toBe("MISSING_SIGNATURE");
    expect(repository.storeCalls).toBe(0);
  });

  it("rejects Razorpay when the webhook secret is not configured", async () => {
    const { app, repository } = createTestApp();
    const rawBody = JSON.stringify(razorpayPaymentAuthorizedPayload());
    const response = await app.request("/webhooks/razorpay", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [RAZORPAY_SIGNATURE_HEADER]: signRazorpayWebhook({
          secret: "dev-only-razorpay-webhook-secret",
          rawBody,
        }),
        [RAZORPAY_EVENT_ID_HEADER]: RAZORPAY_FIXTURE_EVENT_ID.AUTHORIZED,
      },
      body: rawBody,
    });
    expect(response.status).toBe(401);
    expect((await readJson(response)).code).toBe("INVALID_SIGNATURE");
    expect(repository.storeCalls).toBe(0);
  });

  it("does not leak stack traces on failure", async () => {
    const { app } = createTestApp();
    const response = await postSigned(app, { signature: "garbage" });
    const body = await readJson(response);
    expect(body).not.toHaveProperty("stack");
    expect(JSON.stringify(body)).not.toMatch(/at /);
  });

  it("rejects a non-JSON content type before verification", async () => {
    const { app, repository } = createTestApp();
    const response = await app.request("/webhooks/SYNTHETIC", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });
    expect(response.status).toBe(415);
    const body = await readJson(response);
    expect(body.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(body).not.toHaveProperty("stack");
    expect(repository.storeCalls).toBe(0);
  });

  it("accepts application/json with a charset parameter", async () => {
    const { app } = createTestApp();
    const payload = syntheticOpenedPayload({
      event_ref: "SYNTHETIC:evt:http-charset",
    });
    const rawBody = JSON.stringify(payload);
    const response = await app.request("/webhooks/SYNTHETIC", {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        [SYNTHETIC_SIGNATURE_HEADER]: signSyntheticWebhook({
          secret: SECRET,
          rawBody,
          timestampSeconds: NOW_UNIX,
        }),
      },
      body: rawBody,
    });
    expect(response.status).toBe(200);
    expect((await readJson(response)).status).toBe("accepted");
  });

  it("rejects an oversized body", async () => {
    const { app, repository } = createTestApp();
    const rawBody = "x".repeat(256 * 1024 + 1);
    const response = await app.request("/webhooks/SYNTHETIC", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: rawBody,
    });
    expect(response.status).toBe(413);
    expect((await readJson(response)).code).toBe("PAYLOAD_TOO_LARGE");
    expect(repository.storeCalls).toBe(0);
  });

  it("rejects an empty body after a valid signature", async () => {
    const { app, repository, payments } = createTestApp();
    const rawBody = "";
    const response = await postSigned(app, { rawBody });
    expect(response.status).toBe(400);
    expect((await readJson(response)).code).toBe("INVALID_PAYLOAD");
    expect(repository.records).toHaveLength(0);
    expect(payments.records).toHaveLength(0);
  });

  it("rejects invalid JSON after a valid signature", async () => {
    const { app, repository } = createTestApp();
    const response = await postSigned(app, { rawBody: "{not-json" });
    expect(response.status).toBe(400);
    expect((await readJson(response)).code).toBe("INVALID_PAYLOAD");
    expect(repository.records).toHaveLength(0);
  });

  it("rejects a malformed envelope after a valid signature", async () => {
    const { app, repository } = createTestApp();
    const response = await postSigned(app, {
      payload: malformedSyntheticPayload(),
    });
    expect(response.status).toBe(400);
    expect((await readJson(response)).code).toBe("INVALID_PAYLOAD");
    expect(repository.records).toHaveLength(0);
  });

  it("rejects missing identifiers, amount, and currency without persisting", async () => {
    const { app, repository, payments } = createTestApp();
    const cases: Array<{ payload: unknown; code: string }> = [
      {
        payload: syntheticOpenedPayload({ event_ref: "" }),
        code: "MISSING_EXTERNAL_ID",
      },
      {
        payload: {
          ...syntheticOpenedPayload({ event_ref: "SYNTHETIC:evt:http-no-pay" }),
          entity: {
            ...syntheticOpenedPayload().entity,
            payment_ref: "",
          },
        },
        code: "MISSING_PAYMENT_ID",
      },
      {
        payload: {
          ...syntheticOpenedPayload({ event_ref: "SYNTHETIC:evt:http-no-amt" }),
          entity: {
            ...syntheticOpenedPayload().entity,
            money: { ccy: "INR" },
          },
        },
        code: "INVALID_AMOUNT",
      },
      {
        payload: invalidAmountSyntheticPayload(),
        code: "INVALID_AMOUNT",
      },
      {
        payload: syntheticOpenedPayload({
          event_ref: "SYNTHETIC:evt:http-neg",
          minor_units: "-1",
        }),
        code: "INVALID_AMOUNT",
      },
      {
        payload: invalidCurrencySyntheticPayload(),
        code: "INVALID_CURRENCY",
      },
      {
        payload: unknownSyntheticEventPayload(),
        code: "UNSUPPORTED_EVENT",
      },
    ];
    for (const row of cases) {
      const response = await postSigned(app, { payload: row.payload });
      expect(response.status).toBe(400);
      expect((await readJson(response)).code).toBe(row.code);
    }
    expect(repository.records).toHaveLength(0);
    expect(payments.records).toHaveLength(0);
  });

  it("keeps occurredAt, receivedAt, and processing time distinct", async () => {
    const { app, repository, payments, audit } = createTestApp();
    const occurredAt = "2020-06-01T00:00:00.000Z";
    const payload = syntheticOpenedPayload({
      event_ref: "SYNTHETIC:evt:http-old-clock",
      payment_ref: "SYNTHETIC:pay:http-old-clock",
      booked_at: occurredAt,
    });
    const response = await postSigned(app, { payload });
    expect(response.status).toBe(200);
    const stored = repository.records[0];
    expect(stored?.event.occurredAt).toBe(occurredAt);
    expect(stored?.event.receivedAt).toBe(NOW);
    expect(stored?.event.occurredAt).not.toBe(stored?.event.receivedAt);
    const payment = payments.records[0];
    expect(payment?.lastOccurredAt).toBe(occurredAt);
    expect(payment?.updatedAt).toBe(NOW);
    expect(payment?.updatedAt).not.toBe(payment?.lastOccurredAt);
    const changed = audit.records.find(
      (row) => row.eventType === "PAYMENT_STATE_CHANGED",
    );
    expect(changed?.occurredAt).toBe(occurredAt);
    expect(changed?.recordedAt).toBe(NOW);
    expect(changed?.occurredAt).not.toBe(changed?.recordedAt);
  });

  it("stores a future occurredAt without substituting the receive clock", async () => {
    const { app, repository } = createTestApp();
    const occurredAt = "2099-01-01T00:00:00.000Z";
    const payload = syntheticOpenedPayload({
      event_ref: "SYNTHETIC:evt:http-future-clock",
      booked_at: occurredAt,
    });
    const response = await postSigned(app, { payload });
    expect(response.status).toBe(200);
    expect(repository.records[0]?.event.occurredAt).toBe(occurredAt);
    expect(repository.records[0]?.event.receivedAt).toBe(NOW);
  });

  it("accepts zero, unit, and large minor amounts as bigint", async () => {
    const { app, repository } = createTestApp();
    const cases: Array<{ event_ref: string; minor_units: string; amount: bigint }> = [
      {
        event_ref: "SYNTHETIC:evt:http-amt-0",
        minor_units: "0",
        amount: 0n,
      },
      {
        event_ref: "SYNTHETIC:evt:http-amt-1",
        minor_units: "1",
        amount: 1n,
      },
      {
        event_ref: "SYNTHETIC:evt:http-amt-large",
        minor_units: "1000000000000000000",
        amount: 10n ** 18n,
      },
    ];
    for (const row of cases) {
      const response = await postSigned(app, {
        payload: syntheticOpenedPayload({
          event_ref: row.event_ref,
          payment_ref: `SYNTHETIC:pay:${row.event_ref.slice(-8)}`,
          minor_units: row.minor_units,
        }),
      });
      expect(response.status).toBe(200);
      expect(
        repository.records.find((item) => item.event.externalEventId === row.event_ref)
          ?.event.amountMinor,
      ).toBe(row.amount);
    }
  });

  it("preserves the original amount and currency on a conflicting redelivery", async () => {
    const { app, repository, payments } = createTestApp();
    const eventRef = "SYNTHETIC:evt:http-ccy-conflict";
    const first = await postSigned(app, {
      payload: syntheticOpenedPayload({
        event_ref: eventRef,
        payment_ref: "SYNTHETIC:pay:http-ccy-conflict",
        minor_units: "10000",
        ccy: "INR",
      }),
    });
    const second = await postSigned(app, {
      payload: syntheticOpenedPayload({
        event_ref: eventRef,
        payment_ref: "SYNTHETIC:pay:http-ccy-conflict",
        minor_units: "10000",
        ccy: "USD",
      }),
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(repository.records).toHaveLength(1);
    expect(repository.records[0]?.event.currency).toBe("INR");
    expect(repository.records[0]?.event.amountMinor).toBe(10000n);
    expect(payments.records).toHaveLength(1);
    expect(payments.records[0]?.currency).toBe("INR");
  });

  it("100 identical deliveries produce one stored event and one economic effect", async () => {
    const { app, repository, payments, audit } = createTestApp();
    const payload = syntheticOpenedPayload({
      event_ref: "SYNTHETIC:evt:http-dup-100",
      payment_ref: "SYNTHETIC:pay:http-dup-100",
    });
    const statuses: string[] = [];
    for (let index = 0; index < 100; index += 1) {
      const response = await postSigned(app, { payload });
      expect(response.status).toBe(200);
      statuses.push(String((await readJson(response)).status));
    }
    expect(statuses.filter((status) => status === "accepted")).toHaveLength(1);
    expect(statuses.filter((status) => status === "duplicate")).toHaveLength(99);
    expect(repository.records).toHaveLength(1);
    expect(payments.records).toHaveLength(1);
    expect(payments.records[0]?.state).toBe("CREATED");
    expect(
      audit.records.filter((row) => row.eventType === "PAYMENT_STATE_CHANGED"),
    ).toHaveLength(1);
  });
});

describe("GET /", () => {
  it("describes the webhook ingest route", async () => {
    const { app } = createTestApp();
    const response = await app.request("/");
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body.ingest).toBe("/webhooks/:provider");
    expect(body.retries).toBe("/retries");
    expect(body.deadLetters).toBe("/dead-letters");
    expect(body.demo).toBe("/demo");
    expect(body.demoRun).toBe("/demo/run");
    expect(body.payment).toBe("/payments/:paymentId");
    expect(body.payments).toBe("/payments");
    expect(body.webhooks).toBe("/webhooks");
    expect(body.paymentAudit).toBe("/payments/:paymentId/audit");
  });
});
