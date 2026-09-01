import { describe, expect, it } from "vitest";
import { instant } from "@hookx/domain";
import { collectingLogger, type StructuredLogRecord } from "@hookx/observability";
import {
  MemoryAuditRepository,
  MemoryExceptionRepository,
  MemoryPaymentRepository,
  MemoryRetryRepository,
  createSequentialOutcomeWriter,
} from "@hookx/storage";
import {
  createSignatureVerifierRegistry,
  signSyntheticWebhook,
  SYNTHETIC_SIGNATURE_HEADER,
  syntheticOpenedPayload,
  unixSecondsFromInstant,
} from "@hookx/webhook";
import { processIncomingWebhook } from "../pipeline/process-incoming-webhook.js";
import { MemoryWebhookEventRepository } from "../test-support/memory-webhook-repository.js";

const SECRET = "dev-only-synthetic-webhook-secret";
const NOW = instant("2026-01-15T10:00:01.000Z");
const NOW_UNIX = unixSecondsFromInstant(NOW);

function rawBodyOf(payload: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
}

function signedHeaders(rawBody: Uint8Array): Map<string, string> {
  return new Map([
    [
      SYNTHETIC_SIGNATURE_HEADER,
      signSyntheticWebhook({
        secret: SECRET,
        rawBody,
        timestampSeconds: NOW_UNIX,
      }),
    ],
  ]);
}

function deps(logs: StructuredLogRecord[]) {
  const repository = new MemoryWebhookEventRepository();
  const retry = new MemoryRetryRepository();
  const audit = new MemoryAuditRepository();
  const payments = new MemoryPaymentRepository();
  const exceptions = new MemoryExceptionRepository();
  return {
    repository,
    retry,
    audit,
    payments,
    exceptions,
    persistOutcome: createSequentialOutcomeWriter(repository, audit, payments),
    verifiers: createSignatureVerifierRegistry({
      syntheticSecret: SECRET,
      syntheticToleranceSeconds: 300,
    }),
    retryPolicy: { maxAttempts: 5, baseDelayMs: 1_000, maxDelayMs: 8_000 },
    leaseMs: 5_000,
    logger: collectingLogger(logs),
  };
}

describe("pipeline observability", () => {
  it("propagates one correlation id across logs and audit", async () => {
    const logs: StructuredLogRecord[] = [];
    const dependencies = deps(logs);
    const payload = syntheticOpenedPayload({
      event_ref: "SYNTHETIC:evt:obs-corr",
      payment_ref: "SYNTHETIC:pay:obs-corr",
    });
    const rawBody = rawBodyOf(payload);
    await processIncomingWebhook(dependencies, {
      provider: "SYNTHETIC",
      rawBody,
      headers: signedHeaders(rawBody),
      requestId: "corr-shared-1",
      now: NOW,
    });
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((row) => row.correlationId === "corr-shared-1")).toBe(true);
    expect(
      logs.some((row) => row.lifecycle === "WEBHOOK_RECEIVED"),
    ).toBe(true);
    expect(
      logs.some((row) => row.lifecycle === "SIGNATURE_VERIFIED"),
    ).toBe(true);
    expect(logs.some((row) => row.lifecycle === "EVENT_PERSISTED")).toBe(true);
    expect(
      dependencies.audit.records.every((row) => row.correlationId === "corr-shared-1"),
    ).toBe(true);
  });

  it("redacts secrets from structured logs", async () => {
    const logs: StructuredLogRecord[] = [];
    const dependencies = deps(logs);
    const rawBody = rawBodyOf(syntheticOpenedPayload());
    const headers = signedHeaders(rawBody);
    headers.set("authorization", "Bearer super-secret-token");
    headers.set("x-hookx-signature", "should-not-log");
    await processIncomingWebhook(dependencies, {
      provider: "SYNTHETIC",
      rawBody,
      headers,
      requestId: "corr-redact",
      now: NOW,
    });
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain("super-secret-token");
    expect(serialized).not.toContain("should-not-log");
  });

  it("keeps concurrent requests on distinct correlation ids", async () => {
    const logs: StructuredLogRecord[] = [];
    const dependencies = deps(logs);
    const first = syntheticOpenedPayload({
      event_ref: "SYNTHETIC:evt:obs-a",
      payment_ref: "SYNTHETIC:pay:obs-a",
    });
    const second = syntheticOpenedPayload({
      event_ref: "SYNTHETIC:evt:obs-b",
      payment_ref: "SYNTHETIC:pay:obs-b",
    });
    const rawA = rawBodyOf(first);
    const rawB = rawBodyOf(second);
    await Promise.all([
      processIncomingWebhook(dependencies, {
        provider: "SYNTHETIC",
        rawBody: rawA,
        headers: signedHeaders(rawA),
        requestId: "corr-concurrent-a",
        now: NOW,
      }),
      processIncomingWebhook(dependencies, {
        provider: "SYNTHETIC",
        rawBody: rawB,
        headers: signedHeaders(rawB),
        requestId: "corr-concurrent-b",
        now: NOW,
      }),
    ]);
    const a = logs.filter((row) => row.correlationId === "corr-concurrent-a");
    const b = logs.filter((row) => row.correlationId === "corr-concurrent-b");
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    expect(a.some((row) => row.correlationId === "corr-concurrent-b")).toBe(false);
    expect(b.some((row) => row.correlationId === "corr-concurrent-a")).toBe(false);
  });
});
