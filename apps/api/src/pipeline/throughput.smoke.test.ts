import { describe, expect, it } from "vitest";
import { instant } from "@hookx/domain";
import {
  createSequentialOutcomeWriter,
  MemoryAuditRepository,
  MemoryPaymentRepository,
  MemoryRetryRepository,
} from "@hookx/storage";
import {
  createSignatureVerifierRegistry,
  signSyntheticWebhook,
  SYNTHETIC_SIGNATURE_HEADER,
  syntheticOpenedPayload,
  unixSecondsFromInstant,
} from "@hookx/webhook";
import { createApp } from "../app.js";
import { fixedClock } from "../clock.js";
import { MemoryWebhookEventRepository } from "../test-support/memory-webhook-repository.js";

/**
 * LOCAL SYNTHETIC BENCHMARK — in-process memory repositories, not production.
 * Counts and elapsed time are for this machine and this test runner only.
 */
const SECRET = "dev-only-synthetic-webhook-secret";
const NOW = instant("2026-01-15T10:00:01.000Z");
const NOW_UNIX = unixSecondsFromInstant(NOW);
const SIZES = [100, 500, 1000] as const;

function createSmokeApp() {
  const repository = new MemoryWebhookEventRepository();
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
  return { app, repository, payments, audit };
}

async function postSigned(
  app: ReturnType<typeof createApp>,
  payload: unknown,
): Promise<Record<string, unknown>> {
  const rawBody = JSON.stringify(payload);
  const response = await app.request("/webhooks/SYNTHETIC", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [SYNTHETIC_SIGNATURE_HEADER]: signSyntheticWebhook({
        secret: SECRET,
        rawBody,
        timestampSeconds: NOW_UNIX,
      }),
    },
    body: rawBody,
  });
  return {
    httpStatus: response.status,
    ...(await response.json()) as Record<string, unknown>,
  };
}

describe("local synthetic throughput smoke", () => {
  it.each(SIZES)(
    "ingests %s unique events with one economic effect each",
    async (size) => {
      const { app, repository, payments, audit } = createSmokeApp();
      const started = Date.now();
      let accepted = 0;
      let failed = 0;
      for (let index = 0; index < size; index += 1) {
        const body = await postSigned(
          app,
          syntheticOpenedPayload({
            event_ref: `SYNTHETIC:evt:smoke-${size}-${index}`,
            payment_ref: `SYNTHETIC:pay:smoke-${size}-${index}`,
          }),
        );
        if (body.httpStatus === 200 && body.status === "accepted") {
          accepted += 1;
        } else {
          failed += 1;
        }
      }
      const elapsedMs = Date.now() - started;
      expect(accepted).toBe(size);
      expect(failed).toBe(0);
      expect(repository.records).toHaveLength(size);
      expect(payments.records).toHaveLength(size);
      expect(
        audit.records.filter((row) => row.eventType === "PAYMENT_STATE_CHANGED"),
      ).toHaveLength(size);
      expect(elapsedMs).toBeGreaterThanOrEqual(0);
    },
  );

  it("treats 1000 identical redeliveries as one event", async () => {
    const { app, repository, payments, audit } = createSmokeApp();
    const payload = syntheticOpenedPayload({
      event_ref: "SYNTHETIC:evt:smoke-dup-1000",
      payment_ref: "SYNTHETIC:pay:smoke-dup-1000",
    });
    const started = Date.now();
    let accepted = 0;
    let duplicate = 0;
    for (let index = 0; index < 1000; index += 1) {
      const body = await postSigned(app, payload);
      if (body.status === "accepted") {
        accepted += 1;
      } else if (body.status === "duplicate") {
        duplicate += 1;
      }
    }
    const elapsedMs = Date.now() - started;
    expect(accepted).toBe(1);
    expect(duplicate).toBe(999);
    expect(repository.records).toHaveLength(1);
    expect(payments.records).toHaveLength(1);
    expect(
      audit.records.filter((row) => row.eventType === "PAYMENT_STATE_CHANGED"),
    ).toHaveLength(1);
    expect(elapsedMs).toBeGreaterThanOrEqual(0);
  });
});
