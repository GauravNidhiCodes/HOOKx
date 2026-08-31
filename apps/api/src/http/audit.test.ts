import { describe, expect, it } from "vitest";
import { instant } from "@hookx/domain";
import {
  MemoryAuditRepository,
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

const SECRET = "dev-only-synthetic-webhook-secret";
const NOW = instant("2026-01-15T10:00:01.000Z");
const NOW_UNIX = unixSecondsFromInstant(NOW);

describe("GET audit routes", () => {
  it("returns chronological payment and webhook audit without secrets", async () => {
    const repository = new MemoryWebhookEventRepository();
    const audit = new MemoryAuditRepository();
    const app = createApp({
      repository,
      retry: new MemoryRetryRepository(),
      audit,
      verifiers: createSignatureVerifierRegistry({
        syntheticSecret: SECRET,
        syntheticToleranceSeconds: 300,
      }),
      clock: fixedClock(NOW),
    });
    const payload = syntheticOpenedPayload({
      event_ref: "SYNTHETIC:evt:http-audit",
    });
    const rawBody = JSON.stringify(payload);
    await app.request("/webhooks/SYNTHETIC", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "http-audit-1",
        [SYNTHETIC_SIGNATURE_HEADER]: signSyntheticWebhook({
          secret: SECRET,
          rawBody,
          timestampSeconds: NOW_UNIX,
        }),
      },
      body: rawBody,
    });
    const paymentId = repository.records[0]!.event.paymentId;
    const webhookId = repository.records[0]!.id;
    const payment = await app.request(
      `/payments/${encodeURIComponent(paymentId)}/audit`,
    );
    expect(payment.status).toBe(200);
    const paymentBody = (await payment.json()) as {
      audit: Array<{ eventType: string; metadata: Record<string, unknown> }>;
    };
    expect(paymentBody.audit.map((row) => row.eventType)).toEqual([
      "WEBHOOK_RECEIVED",
      "PAYMENT_STATE_CHANGED",
    ]);
    expect(JSON.stringify(paymentBody)).not.toContain(SECRET);
    expect(JSON.stringify(paymentBody)).not.toContain("signature");

    const webhook = await app.request(`/webhooks/${webhookId}/audit`);
    expect(webhook.status).toBe(200);
    const correlated = await app.request("/audit?correlationId=http-audit-1");
    expect(correlated.status).toBe(200);
    const correlatedBody = (await correlated.json()) as {
      audit: Array<{ correlationId: string }>;
    };
    expect(correlatedBody.audit.every((row) => row.correlationId === "http-audit-1")).toBe(
      true,
    );
  });
});
