import { describe, expect, it } from "vitest";
import { instant, isoCurrencyCode, paymentId, providerId } from "@hookx/domain";
import {
  MemoryAuditRepository,
  MemoryExceptionRepository,
  MemoryPaymentRepository,
  MemoryRetryRepository,
} from "@hookx/storage";
import { createExceptionDraft } from "@hookx/exceptions";
import { createSignatureVerifierRegistry } from "@hookx/webhook";
import { syntheticPaymentCreated } from "@hookx/testkit";
import { createApp } from "../app.js";
import { fixedClock } from "../clock.js";
import { MemoryWebhookEventRepository } from "../test-support/memory-webhook-repository.js";

const NOW = instant("2026-01-15T10:00:01.000Z");
const EARLIER = instant("2026-01-15T09:00:00.000Z");
const SECRET = "dev-only-synthetic-webhook-secret";
const PAYMENT = paymentId("SYNTHETIC:pay:list-http");

describe("GET /payments", () => {
  it("lists persisted payments with exception counts", async () => {
    const repository = new MemoryWebhookEventRepository();
    const payments = new MemoryPaymentRepository();
    const exceptions = new MemoryExceptionRepository();
    await payments.upsert({
      provider: providerId("SYNTHETIC"),
      paymentId: PAYMENT,
      state: "CREATED",
      amountMinor: 10000n,
      currency: isoCurrencyCode("INR"),
      lastOccurredAt: NOW,
      updatedAt: NOW,
    });
    await repository.store(
      syntheticPaymentCreated({
        paymentId: PAYMENT,
        externalEventId: "SYNTHETIC:evt:list-http",
        occurredAt: EARLIER,
        receivedAt: NOW,
      }),
    );
    await exceptions.create(
      createExceptionDraft({
        exceptionCode: "CONFLICTING_EVENT",
        paymentId: PAYMENT,
        webhookEventId: null,
        provider: providerId("SYNTHETIC"),
        reason: "CONFLICTING_EVENT",
        detectedAt: NOW,
        correlationId: "corr-list-pay",
      }),
    );
    const app = createApp({
      repository,
      retry: new MemoryRetryRepository(),
      audit: new MemoryAuditRepository(),
      payments,
      exceptions,
      verifiers: createSignatureVerifierRegistry({
        syntheticSecret: SECRET,
        syntheticToleranceSeconds: 300,
      }),
      clock: fixedClock(NOW),
    });
    const listed = await app.request("/payments");
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as {
      payments: Array<{
        paymentId: string;
        exceptionCount: number;
        createdAt: string;
        amountMinor: string;
      }>;
    };
    expect(body.payments).toHaveLength(1);
    expect(body.payments[0]?.paymentId).toBe(PAYMENT);
    expect(body.payments[0]?.exceptionCount).toBe(1);
    expect(body.payments[0]?.createdAt).toBe(EARLIER);
    expect(body.payments[0]?.amountMinor).toBe("10000");

    const found = await app.request("/payments?q=list-http");
    expect(found.status).toBe(200);
    const foundBody = (await found.json()) as { payments: unknown[] };
    expect(foundBody.payments).toHaveLength(1);

    const missing = await app.request("/payments?q=no-such-payment");
    expect(((await missing.json()) as { payments: unknown[] }).payments).toHaveLength(
      0,
    );
  });

  it("does not leak SQL or stack traces when a handler throws", async () => {
    class ThrowingPaymentRepository extends MemoryPaymentRepository {
      public override async list(
        _filter?: Parameters<MemoryPaymentRepository["list"]>[0],
      ): Promise<never> {
        throw new Error(
          'insert into "payments" password=supersecret at Object.query',
        );
      }
    }
    const app = createApp({
      repository: new MemoryWebhookEventRepository(),
      retry: new MemoryRetryRepository(),
      audit: new MemoryAuditRepository(),
      payments: new ThrowingPaymentRepository(),
      exceptions: new MemoryExceptionRepository(),
      verifiers: createSignatureVerifierRegistry({
        syntheticSecret: SECRET,
        syntheticToleranceSeconds: 300,
      }),
      clock: fixedClock(NOW),
    });
    const response = await app.request("/payments");
    expect(response.status).toBe(500);
    const body = (await response.json()) as {
      status: string;
      code: string;
      stack?: string;
    };
    expect(body).toEqual({ status: "error", code: "INTERNAL_ERROR" });
    expect(body.stack).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/password|insert into|at Object/);
  });
});
