import { describe, expect, it } from "vitest";
import { instant } from "@hookx/domain";
import {
  createSignatureVerifierRegistry,
  signSyntheticWebhook,
  SYNTHETIC_SIGNATURE_HEADER,
  syntheticOpenedPayload,
  unixSecondsFromInstant,
} from "@hookx/webhook";
import { MemoryAuditRepository, MemoryRetryRepository } from "@hookx/storage";
import { createApp } from "../app.js";
import { fixedClock } from "../clock.js";
import { MemoryWebhookEventRepository } from "../test-support/memory-webhook-repository.js";

const SECRET = "dev-only-synthetic-webhook-secret";
const NOW = instant("2026-01-15T10:00:01.000Z");
const NOW_UNIX = unixSecondsFromInstant(NOW);

function createTestApp(repository = new MemoryWebhookEventRepository()) {
  const retry = new MemoryRetryRepository();
  const audit = new MemoryAuditRepository();
  const app = createApp({
    repository,
    retry,
    audit,
    verifiers: createSignatureVerifierRegistry({
      syntheticSecret: SECRET,
      syntheticToleranceSeconds: 300,
    }),
    clock: fixedClock(NOW),
  });
  return { app, repository, retry, audit };
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
    const response = await postSigned(app, { provider: "razorpay" });
    expect(response.status).toBe(404);
    expect(repository.storeCalls).toBe(0);
  });

  it("does not leak stack traces on failure", async () => {
    const { app } = createTestApp();
    const response = await postSigned(app, { signature: "garbage" });
    const body = await readJson(response);
    expect(body).not.toHaveProperty("stack");
    expect(JSON.stringify(body)).not.toMatch(/at /);
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
    expect(body.paymentAudit).toBe("/payments/:paymentId/audit");
  });
});
