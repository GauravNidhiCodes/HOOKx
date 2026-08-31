import { describe, expect, it } from "vitest";
import { instant } from "@hookx/domain";
import {
  MemoryRetryRepository,
  RetryableProcessingError,
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

function createTestApp() {
  const repository = new MemoryWebhookEventRepository();
  const retry = new MemoryRetryRepository();
  const app = createApp({
    repository,
    retry,
    verifiers: createSignatureVerifierRegistry({
      syntheticSecret: SECRET,
      syntheticToleranceSeconds: 300,
    }),
    clock: fixedClock(NOW),
  });
  return { app, repository, retry };
}

async function postOpened(
  app: ReturnType<typeof createApp>,
  eventRef: string,
): Promise<Response> {
  const payload = syntheticOpenedPayload({ event_ref: eventRef });
  const rawBody = JSON.stringify(payload);
  return app.request("/webhooks/SYNTHETIC", {
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
}

describe("operator retry inspection", () => {
  it("lists active retries after a temporary processing failure", async () => {
    const repository = new MemoryWebhookEventRepository();
    const retry = new MemoryRetryRepository();
    const app = createApp({
      repository,
      retry,
      processPaymentEvents: async () => {
        throw new RetryableProcessingError();
      },
      verifiers: createSignatureVerifierRegistry({
        syntheticSecret: SECRET,
        syntheticToleranceSeconds: 300,
      }),
      clock: fixedClock(NOW),
    });
    await postOpened(app, "SYNTHETIC:evt:retry-inspect");
    const list = await app.request("/retries");
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      retries: Array<{ status: string; lastErrorCode: string | null }>;
    };
    expect(body.retries).toHaveLength(1);
    expect(body.retries[0]?.status).toBe("RETRY_SCHEDULED");
    expect(body.retries[0]?.lastErrorCode).toBe("TEMPORARY_UNAVAILABLE");
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(JSON.stringify(body)).not.toMatch(/at /);

    const eventId = repository.records[0]!.id;
    const one = await app.request(`/retries/${eventId}`);
    expect(one.status).toBe(200);
    const oneBody = (await one.json()) as { retry: { webhookEventId: string } };
    expect(oneBody.retry.webhookEventId).toBe(eventId);
    expect(JSON.stringify(oneBody)).not.toContain("payload");
  });

  it("lists dead-lettered events after a permanent failure", async () => {
    const repository = new MemoryWebhookEventRepository();
    const retry = new MemoryRetryRepository();
    const app = createApp({
      repository,
      retry,
      processPaymentEvents: async () => {
        throw Object.assign(new Error("invalid"), {
          code: "INVALID_TRANSITION",
        });
      },
      verifiers: createSignatureVerifierRegistry({
        syntheticSecret: SECRET,
        syntheticToleranceSeconds: 300,
      }),
      clock: fixedClock(NOW),
    });
    await postOpened(app, "SYNTHETIC:evt:dead-inspect");
    const eventId = repository.records[0]!.id;
    const list = await app.request("/dead-letters");
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      deadLetters: Array<{ failureCode: string; webhookEventId: string }>;
    };
    expect(body.deadLetters).toHaveLength(1);
    expect(body.deadLetters[0]?.failureCode).toBe("INVALID_TRANSITION");
    expect(body.deadLetters[0]?.webhookEventId).toBe(eventId);
    expect(JSON.stringify(body)).not.toContain("stack");
    const one = await app.request(`/dead-letters/${eventId}`);
    expect(one.status).toBe(200);
  });

  it("returns not found for an unknown retry", async () => {
    const { app } = createTestApp();
    const response = await app.request(
      "/retries/00000000-0000-0000-0000-000000000000",
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as { stack?: string };
    expect(body.stack).toBeUndefined();
  });
});

describe("operator retry inspection does not reprocess", () => {
  it("does not expose a retry mutation endpoint", async () => {
    const { app } = createTestApp();
    const response = await app.request("/retries", { method: "POST" });
    expect(response.status).toBe(404);
  });
});
