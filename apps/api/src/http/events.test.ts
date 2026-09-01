import { describe, expect, it } from "vitest";
import { instant, isoCurrencyCode, paymentId, providerId } from "@hookx/domain";
import {
  MemoryAuditRepository,
  MemoryPaymentRepository,
  MemoryRetryRepository,
} from "@hookx/storage";
import { createSignatureVerifierRegistry } from "@hookx/webhook";
import { syntheticPaymentCreated } from "@hookx/testkit";
import { createApp } from "../app.js";
import { fixedClock } from "../clock.js";
import { MemoryWebhookEventRepository } from "../test-support/memory-webhook-repository.js";

const NOW = instant("2026-01-15T10:00:01.000Z");
const SECRET = "dev-only-synthetic-webhook-secret";

describe("GET webhook event routes", () => {
  it("returns a stored webhook without payload hashes", async () => {
    const repository = new MemoryWebhookEventRepository();
    const payments = new MemoryPaymentRepository();
    const stored = await repository.store(
      syntheticPaymentCreated({
        paymentId: paymentId("SYNTHETIC:pay:evt-http"),
        externalEventId: "SYNTHETIC:evt:evt-http",
      }),
    );
    expect(stored.outcome).toBe("STORED");
    if (stored.outcome !== "STORED") {
      return;
    }
    await payments.upsert({
      provider: providerId("SYNTHETIC"),
      paymentId: paymentId("SYNTHETIC:pay:evt-http"),
      state: "CREATED",
      amountMinor: 10000n,
      currency: isoCurrencyCode("INR"),
      lastOccurredAt: NOW,
      updatedAt: NOW,
    });
    const app = createApp({
      repository,
      retry: new MemoryRetryRepository(),
      audit: new MemoryAuditRepository(),
      payments,
      verifiers: createSignatureVerifierRegistry({
        syntheticSecret: SECRET,
        syntheticToleranceSeconds: 300,
      }),
      clock: fixedClock(NOW),
    });
    const one = await app.request(`/webhooks/${stored.record.id}`);
    expect(one.status).toBe(200);
    const body = (await one.json()) as {
      webhook: { webhookEventId: string; amountMinor: string; eventType: string };
    };
    expect(body.webhook.webhookEventId).toBe(stored.record.id);
    expect(body.webhook.amountMinor).toBe("10000");
    expect(body.webhook.eventType).toBe("payment.created");
    expect(JSON.stringify(body)).not.toContain("payloadHash");

    const listed = await app.request(
      "/payments/SYNTHETIC:pay:evt-http/webhooks",
    );
    expect(listed.status).toBe(200);
    const listedBody = (await listed.json()) as { webhooks: unknown[] };
    expect(listedBody.webhooks).toHaveLength(1);
  });
});
