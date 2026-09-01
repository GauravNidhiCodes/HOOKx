import { describe, expect, it } from "vitest";
import { instant, paymentId, providerId } from "@hookx/domain";
import { createExceptionDraft } from "@hookx/exceptions";
import {
  MemoryAuditRepository,
  MemoryExceptionRepository,
  MemoryRetryRepository,
} from "@hookx/storage";
import { createSignatureVerifierRegistry } from "@hookx/webhook";
import { createApp } from "../app.js";
import { fixedClock } from "../clock.js";
import { MemoryWebhookEventRepository } from "../test-support/memory-webhook-repository.js";

const NOW = instant("2026-01-15T10:00:01.000Z");
const SECRET = "dev-only-synthetic-webhook-secret";

describe("GET exception routes", () => {
  it("lists, filters, and hides sensitive metadata", async () => {
    const exceptions = new MemoryExceptionRepository();
    const created = await exceptions.create(
      createExceptionDraft({
        exceptionCode: "CONFLICTING_EVENT",
        paymentId: paymentId("SYNTHETIC:pay:http-ex"),
        webhookEventId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        provider: providerId("SYNTHETIC"),
        reason: "CONFLICTING_EVENT",
        detectedAt: NOW,
        correlationId: "corr-ex-1",
        metadata: {
          secret: "dev-only-not-a-real-secret",
          originalAuthoritative: true,
        },
      }),
    );
    const app = createApp({
      repository: new MemoryWebhookEventRepository(),
      retry: new MemoryRetryRepository(),
      audit: new MemoryAuditRepository(),
      exceptions,
      verifiers: createSignatureVerifierRegistry({
        syntheticSecret: SECRET,
        syntheticToleranceSeconds: 300,
      }),
      clock: fixedClock(NOW),
    });

    const listed = await app.request("/exceptions?status=OPEN&severity=ERROR");
    expect(listed.status).toBe(200);
    const listedBody = (await listed.json()) as {
      exceptions: Array<{ exceptionCode: string; metadata: Record<string, unknown> }>;
    };
    expect(listedBody.exceptions).toHaveLength(1);
    expect(listedBody.exceptions[0]?.exceptionCode).toBe("CONFLICTING_EVENT");
    expect(listedBody.exceptions[0]?.metadata["secret"]).toBeUndefined();
    expect(listedBody.exceptions[0]?.metadata["originalAuthoritative"]).toBe(true);

    const one = await app.request(`/exceptions/${created.record.exceptionId}`);
    expect(one.status).toBe(200);
    const oneBody = (await one.json()) as { exception: { exceptionId: string } };
    expect(oneBody.exception.exceptionId).toBe(created.record.exceptionId);

    const byPayment = await app.request(
      "/payments/SYNTHETIC:pay:http-ex/exceptions",
    );
    expect(byPayment.status).toBe(200);
    const paymentBody = (await byPayment.json()) as { exceptions: unknown[] };
    expect(paymentBody.exceptions).toHaveLength(1);

    const badFilter = await app.request("/exceptions?status=NOPE");
    expect(badFilter.status).toBe(400);

    const missing = await app.request(
      "/exceptions/ffffffff-ffff-4fff-8fff-ffffffffffff",
    );
    expect(missing.status).toBe(404);

    const byQ = await app.request(
      `/exceptions?q=${created.record.exceptionId}`,
    );
    expect(byQ.status).toBe(200);
    const qBody = (await byQ.json()) as { exceptions: unknown[] };
    expect(qBody.exceptions).toHaveLength(1);

    const byPaymentQuery = await app.request(
      "/exceptions?paymentId=SYNTHETIC:pay:http-ex",
    );
    expect(byPaymentQuery.status).toBe(200);
    expect(
      ((await byPaymentQuery.json()) as { exceptions: unknown[] }).exceptions,
    ).toHaveLength(1);
  });

  it("caps the exception list instead of returning an unbounded set", async () => {
    const exceptions = new MemoryExceptionRepository();
    for (let index = 0; index < 201; index += 1) {
      await exceptions.create(
        createExceptionDraft({
          exceptionCode: "PROCESSING_FAILURE",
          paymentId: paymentId(`SYNTHETIC:pay:http-ex-cap-${index}`),
          webhookEventId: null,
          provider: providerId("SYNTHETIC"),
          reason: "PROCESSING_FAILURE",
          detectedAt: NOW,
          correlationId: `corr-ex-cap-${index}`,
        }),
      );
    }
    const app = createApp({
      repository: new MemoryWebhookEventRepository(),
      retry: new MemoryRetryRepository(),
      audit: new MemoryAuditRepository(),
      exceptions,
      verifiers: createSignatureVerifierRegistry({
        syntheticSecret: SECRET,
        syntheticToleranceSeconds: 300,
      }),
      clock: fixedClock(NOW),
    });
    const listed = await app.request("/exceptions");
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { exceptions: unknown[] };
    expect(body.exceptions).toHaveLength(200);
  });
});
