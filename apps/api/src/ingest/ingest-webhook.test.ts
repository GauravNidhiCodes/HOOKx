import { describe, expect, it } from "vitest";
import { instant } from "@hookx/domain";
import {
  MemoryAuditRepository,
  MemoryPaymentRepository,
  MemoryRetryRepository,
  RetryableProcessingError,
  addMilliseconds,
  createSequentialOutcomeWriter,
  processPaymentEvents,
  runRetryTick,
} from "@hookx/storage";
import {
  createSignatureVerifierRegistry,
  signSyntheticWebhook,
  SYNTHETIC_SIGNATURE_HEADER,
  syntheticOpenedPayload,
  unixSecondsFromInstant,
} from "@hookx/webhook";
import {
  processIncomingWebhook,
  type ProcessIncomingWebhookDependencies,
} from "../pipeline/process-incoming-webhook.js";
import { MemoryWebhookEventRepository } from "../test-support/memory-webhook-repository.js";

const SECRET = "dev-only-synthetic-webhook-secret";
const NOW = instant("2026-01-15T10:00:01.000Z");
const NOW_UNIX = unixSecondsFromInstant(NOW);
const POLICY = { maxAttempts: 5, baseDelayMs: 1_000, maxDelayMs: 8_000 };
const LEASE_MS = 5_000;

function rawBodyOf(payload: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
}

function signedHeaders(rawBody: Uint8Array, secret = SECRET): Map<string, string> {
  const signature = signSyntheticWebhook({
    secret,
    rawBody,
    timestampSeconds: NOW_UNIX,
  });
  return new Map([[SYNTHETIC_SIGNATURE_HEADER, signature]]);
}

function createDeps(
  repository = new MemoryWebhookEventRepository(),
  extras: Partial<ProcessIncomingWebhookDependencies> = {},
): ProcessIncomingWebhookDependencies {
  const retry = extras.retry ?? new MemoryRetryRepository();
  const audit = extras.audit ?? new MemoryAuditRepository();
  const payments = extras.payments ?? new MemoryPaymentRepository();
  const persistOutcome =
    extras.persistOutcome ??
    createSequentialOutcomeWriter(repository, audit, payments);
  return {
    verifiers: createSignatureVerifierRegistry({
      syntheticSecret: SECRET,
      syntheticToleranceSeconds: 300,
    }),
    retryPolicy: POLICY,
    leaseMs: LEASE_MS,
    ...extras,
    repository,
    retry,
    audit,
    payments,
    persistOutcome,
  };
}

describe("processIncomingWebhook", () => {
  it("persists and processes a valid signed payload", async () => {
    const repository = new MemoryWebhookEventRepository();
    const retry = new MemoryRetryRepository();
    const payments = new MemoryPaymentRepository();
    const payload = syntheticOpenedPayload({
      event_ref: "SYNTHETIC:evt:ingest-valid",
    });
    const rawBody = rawBodyOf(payload);
    const result = await processIncomingWebhook(
      createDeps(repository, { retry, payments }),
      {
      provider: "SYNTHETIC",
      rawBody,
      headers: signedHeaders(rawBody),
      requestId: "req-valid",
      now: NOW,
    });

    expect(result.httpStatus).toBe(200);
    expect(result.body.status).toBe("accepted");
    expect(result.observation.verification).toBe("VERIFIED");
    expect(result.observation.externalEventId).toBe(payload.event_ref);
    expect(result.observation.retryStatus).toBe("SUCCEEDED");
    expect(result.observation.decision).toBe("ACCEPTED");
    expect(result.observation.paymentId).toBe(payload.entity.payment_ref);
    expect(result.observation.durationMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(repository.records).toHaveLength(1);
    expect(repository.records[0]?.processingStatus).toBe("PROCESSED");

    const replay = await processPaymentEvents(
      repository,
      repository.records[0]!.event.provider,
      repository.records[0]!.event.paymentId,
    );
    expect(replay.payment?.state).toBe("CREATED");
    expect(
      await payments.get(
        repository.records[0]!.event.provider,
        repository.records[0]!.event.paymentId,
      ),
    ).toMatchObject({ state: "CREATED", amountMinor: 10000n });
  });

  it("rejects an invalid signature before storage", async () => {
    const repository = new MemoryWebhookEventRepository();
    const retry = new MemoryRetryRepository();
    const payload = syntheticOpenedPayload({
      event_ref: "SYNTHETIC:evt:ingest-invalid",
    });
    const rawBody = rawBodyOf(payload);
    const headers = signedHeaders(rawBody);
    const signature = headers.get(SYNTHETIC_SIGNATURE_HEADER)!;
    headers.set(
      SYNTHETIC_SIGNATURE_HEADER,
      `${signature.slice(0, -1)}${signature.endsWith("a") ? "b" : "a"}`,
    );

    const result = await processIncomingWebhook(createDeps(repository, { retry }), {
      provider: "SYNTHETIC",
      rawBody,
      headers,
      requestId: "req-invalid",
      now: NOW,
    });

    expect(result.httpStatus).toBe(401);
    expect(result.body.code).toBe("INVALID_SIGNATURE");
    expect(repository.storeCalls).toBe(0);
    expect(repository.records).toHaveLength(0);
    expect(retry.records).toHaveLength(0);
  });

  it("does not parse JSON before signature verification", async () => {
    const repository = new MemoryWebhookEventRepository();
    const result = await processIncomingWebhook(createDeps(repository), {
      provider: "SYNTHETIC",
      rawBody: new TextEncoder().encode("{not-json"),
      headers: new Map(),
      requestId: "req-order",
      now: NOW,
    });
    expect(result.httpStatus).toBe(401);
    expect(result.body.code).toBe("MISSING_SIGNATURE");
    expect(result.body.code).not.toBe("INVALID_PAYLOAD");
    expect(repository.storeCalls).toBe(0);
  });

  it("returns duplicate for a second identical valid webhook", async () => {
    const repository = new MemoryWebhookEventRepository();
    const payload = syntheticOpenedPayload({
      event_ref: "SYNTHETIC:evt:ingest-dup",
    });
    const rawBody = rawBodyOf(payload);
    const input = {
      provider: "SYNTHETIC",
      rawBody,
      headers: signedHeaders(rawBody),
      requestId: "req-dup",
      now: NOW,
    };
    const deps = createDeps(repository);
    const first = await processIncomingWebhook(deps, input);
    const second = await processIncomingWebhook(deps, {
      ...input,
      requestId: "req-dup-2",
    });
    expect(first.body.status).toBe("accepted");
    expect(second.httpStatus).toBe(200);
    expect(second.body.status).toBe("duplicate");
    expect(repository.records).toHaveLength(1);
  });

  it("keeps one stored event and one transition after five identical deliveries", async () => {
    const repository = new MemoryWebhookEventRepository();
    const audit = new MemoryAuditRepository();
    const payments = new MemoryPaymentRepository();
    const payload = syntheticOpenedPayload({
      event_ref: "SYNTHETIC:evt:ingest-five",
    });
    const rawBody = rawBodyOf(payload);
    const input = {
      provider: "SYNTHETIC",
      rawBody,
      headers: signedHeaders(rawBody),
      now: NOW,
    };
    const deps = createDeps(repository, { audit, payments });
    const statuses: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const result = await processIncomingWebhook(deps, {
        ...input,
        requestId: `req-five-${String(i)}`,
      });
      statuses.push(result.body.status);
    }
    expect(statuses[0]).toBe("accepted");
    expect(statuses.slice(1)).toEqual([
      "duplicate",
      "duplicate",
      "duplicate",
      "duplicate",
    ]);
    expect(repository.records).toHaveLength(1);
    expect(payments.records).toHaveLength(1);
    expect(payments.records[0]?.state).toBe("CREATED");
    expect(
      audit.records.filter((row) => row.eventType === "PAYMENT_STATE_CHANGED"),
    ).toHaveLength(1);
  });

  it("rejects a verified conflicting duplicate without overwriting", async () => {
    const repository = new MemoryWebhookEventRepository();
    const original = syntheticOpenedPayload({
      event_ref: "SYNTHETIC:evt:ingest-conflict",
      minor_units: "10000",
    });
    const conflicting = syntheticOpenedPayload({
      event_ref: "SYNTHETIC:evt:ingest-conflict",
      minor_units: "25000",
    });
    const originalBody = rawBodyOf(original);
    const conflictBody = rawBodyOf(conflicting);
    const deps = createDeps(repository);

    await processIncomingWebhook(deps, {
      provider: "SYNTHETIC",
      rawBody: originalBody,
      headers: signedHeaders(originalBody),
      requestId: "req-c1",
      now: NOW,
    });
    const result = await processIncomingWebhook(deps, {
      provider: "SYNTHETIC",
      rawBody: conflictBody,
      headers: signedHeaders(conflictBody),
      requestId: "req-c2",
      now: NOW,
    });

    expect(result.httpStatus).toBe(409);
    expect(result.body.code).toBe("CONFLICT");
    expect(repository.records).toHaveLength(1);
    expect(repository.records[0]?.event.amountMinor).toBe(10000n);
  });

  it("does not ingest another provider through the synthetic verifier", async () => {
    const repository = new MemoryWebhookEventRepository();
    const payload = syntheticOpenedPayload();
    const rawBody = rawBodyOf(payload);
    const result = await processIncomingWebhook(createDeps(repository), {
      provider: "stripe",
      rawBody,
      headers: signedHeaders(rawBody),
      requestId: "req-iso",
      now: NOW,
    });
    expect(result.httpStatus).toBe(404);
    expect(repository.storeCalls).toBe(0);
  });

  it("schedules a retry when processing fails temporarily", async () => {
    const repository = new MemoryWebhookEventRepository();
    const retry = new MemoryRetryRepository();
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
    const payload = syntheticOpenedPayload({
      event_ref: "SYNTHETIC:evt:ingest-retry",
    });
    const rawBody = rawBodyOf(payload);
    const deps = createDeps(repository, {
      retry,
      processPaymentEvents: processFn,
    });
    const result = await processIncomingWebhook(deps, {
      provider: "SYNTHETIC",
      rawBody,
      headers: signedHeaders(rawBody),
      requestId: "req-retry",
      now: NOW,
    });
    expect(result.httpStatus).toBe(500);
    expect(result.body.status).toBe("error");
    expect(result.body.code).toBe("TEMPORARY_PROCESSING_FAILURE");
    expect(result.observation.retryStatus).toBe("RETRY_SCHEDULED");
    expect(repository.records).toHaveLength(1);

    const tick = await runRetryTick(
      {
        retry,
        events: repository,
        policy: POLICY,
        leaseMs: LEASE_MS,
        processPaymentEvents: processFn,
      },
      addMilliseconds(NOW, 1_000),
    );
    expect(tick.succeeded).toBe(1);
    expect(repository.records[0]?.processingStatus).toBe("PROCESSED");
  });

  it("dead-letters a permanent processing failure without retrying", async () => {
    const repository = new MemoryWebhookEventRepository();
    const retry = new MemoryRetryRepository();
    const payload = syntheticOpenedPayload({
      event_ref: "SYNTHETIC:evt:ingest-dead",
    });
    const rawBody = rawBodyOf(payload);
    const deps = createDeps(repository, {
      retry,
      processPaymentEvents: async () => {
        throw Object.assign(new Error("invalid"), {
          code: "INVALID_TRANSITION",
        });
      },
    });
    const result = await processIncomingWebhook(deps, {
      provider: "SYNTHETIC",
      rawBody,
      headers: signedHeaders(rawBody),
      requestId: "req-dead",
      now: NOW,
    });
    expect(result.httpStatus).toBe(200);
    expect(result.observation.retryStatus).toBe("DEAD_LETTERED");
    expect(retry.deadLetters).toHaveLength(1);
    const later = await runRetryTick(
      {
        retry,
        events: repository,
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

  it("audits ingest, duplicate, and signature rejection", async () => {
    const repository = new MemoryWebhookEventRepository();
    const audit = new MemoryAuditRepository();
    const payload = syntheticOpenedPayload({
      event_ref: "SYNTHETIC:evt:ingest-audit",
    });
    const rawBody = rawBodyOf(payload);
    const deps = createDeps(repository, { audit });
    await processIncomingWebhook(deps, {
      provider: "SYNTHETIC",
      rawBody,
      headers: signedHeaders(rawBody),
      requestId: "req-audit-1",
      now: NOW,
    });
    await processIncomingWebhook(deps, {
      provider: "SYNTHETIC",
      rawBody,
      headers: signedHeaders(rawBody),
      requestId: "req-audit-2",
      now: NOW,
    });
    expect(
      (await audit.listByCorrelationId("req-audit-1")).map((row) => row.eventType),
    ).toEqual(["WEBHOOK_RECEIVED", "PAYMENT_STATE_CHANGED"]);
    expect(
      (await audit.listByCorrelationId("req-audit-2")).map((row) => row.eventType),
    ).toEqual(["WEBHOOK_DUPLICATE"]);
    expect(
      (await audit.listByPayment(repository.records[0]!.event.paymentId)).filter(
        (row) => row.eventType === "PAYMENT_STATE_CHANGED",
      ),
    ).toHaveLength(1);

    const rejected = await processIncomingWebhook(createDeps(repository, { audit }), {
      provider: "SYNTHETIC",
      rawBody,
      headers: new Map(),
      requestId: "req-audit-sig",
      now: NOW,
    });
    expect(rejected.httpStatus).toBe(401);
    const sigRows = await audit.listByCorrelationId("req-audit-sig");
    expect(sigRows.map((row) => row.eventType)).toEqual(["WEBHOOK_REJECTED"]);
    expect(sigRows[0]?.reason).toBe("MISSING_SIGNATURE");
    expect(JSON.stringify(sigRows)).not.toContain(SECRET);
  });
});
