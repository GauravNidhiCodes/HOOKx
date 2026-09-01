import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { paymentId, providerId } from "@hookx/domain";
import {
  syntheticPaymentAuthorized,
  syntheticPaymentCaptured,
  syntheticPaymentCreated,
} from "@hookx/testkit";
import {
  createWebhookIdentity,
  type NormalizedWebhookEvent,
} from "@hookx/webhook";
import { StorageError } from "./errors.js";
import { processPaymentEvents } from "./process-payment-events.js";
import {
  applyWebhookEventMigrations,
  openWebhookEventStore,
  recreateDatabase,
  type WebhookEventStore,
} from "./store.js";
import { defaultTestDatabaseUrl } from "./config.js";

const TEST_URL = defaultTestDatabaseUrl(process.env);

function uniqueCreated(
  overrides: Parameters<typeof syntheticPaymentCreated>[0] = {},
): NormalizedWebhookEvent {
  const token = randomUUID();
  return syntheticPaymentCreated({
    externalEventId: `SYNTHETIC:evt:${token}`,
    payloadHash: `SYNTHETIC:hash:${token}`,
    ...overrides,
  });
}

function uniqueEvent(
  factory:
    | typeof syntheticPaymentCreated
    | typeof syntheticPaymentAuthorized
    | typeof syntheticPaymentCaptured,
  overrides: Parameters<typeof syntheticPaymentCreated>[0] = {},
): NormalizedWebhookEvent {
  const token = randomUUID();
  return factory({
    externalEventId: `SYNTHETIC:evt:${token}`,
    payloadHash: `SYNTHETIC:hash:${token}`,
    ...overrides,
  });
}

describe("webhook event repository", () => {
  let store: WebhookEventStore;

  beforeAll(async () => {
    try {
      await recreateDatabase({ url: TEST_URL });
      await applyWebhookEventMigrations({ url: TEST_URL });
      store = await openWebhookEventStore({ url: TEST_URL });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "unknown database error";
      throw new Error(
        `HOOKX storage integration tests require PostgreSQL. Create a dedicated test database and set HOOKX_TEST_DATABASE_URL. See packages/storage/README.md. Cause: ${message}`,
        { cause: error },
      );
    }
  }, 30_000);

  afterAll(async () => {
    if (store !== undefined) {
      await store.close();
    }
  });

  it("stores the first event", async () => {
    const event = uniqueCreated();
    const result = await store.repository.store(event);
    expect(result.outcome).toBe("STORED");
    if (result.outcome !== "STORED") {
      return;
    }
    expect(result.record.processingStatus).toBe("RECEIVED");
    expect(result.record.event.paymentId).toBe(event.paymentId);
    expect(result.record.event.amountMinor).toBe(event.amountMinor);
    expect(typeof result.record.event.amountMinor).toBe("bigint");
  });

  it("detects an identical duplicate without inserting a second row", async () => {
    const event = uniqueCreated();
    const first = await store.repository.store(event);
    const second = await store.repository.store(event);
    expect(first.outcome).toBe("STORED");
    expect(second.outcome).toBe("DUPLICATE");
    if (first.outcome !== "STORED" || second.outcome !== "DUPLICATE") {
      return;
    }
    expect(second.record.id).toBe(first.record.id);
    const found = await store.repository.findByIdentity(
      createWebhookIdentity(event.provider, event.externalEventId),
    );
    expect(found?.id).toBe(first.record.id);
  });

  it("detects a conflicting duplicate and does not overwrite the original", async () => {
    const original = uniqueCreated({ amountMinor: 10000n });
    const first = await store.repository.store(original);
    expect(first.outcome).toBe("STORED");

    const conflicting = uniqueCreated({
      externalEventId: original.externalEventId,
      amountMinor: 25000n,
      payloadHash: "SYNTHETIC:hash:conflicted",
    });
    const second = await store.repository.store(conflicting);
    expect(second.outcome).toBe("CONFLICT");
    if (first.outcome !== "STORED" || second.outcome !== "CONFLICT") {
      return;
    }
    expect(second.existing.id).toBe(first.record.id);
    expect(second.existing.event.amountMinor).toBe(10000n);
    expect(second.existing.event.payloadHash).toBe(original.payloadHash);
    expect(second.incoming.payloadHash).toBe(conflicting.payloadHash);

    const found = await store.repository.findById(first.record.id);
    expect(found?.event.amountMinor).toBe(10000n);
    expect(found?.event.payloadHash).toBe(original.payloadHash);
  });

  it("allows different providers to share an external event ID", async () => {
    const externalEventId = `SYNTHETIC:evt:${randomUUID()}`;
    const first = uniqueCreated({ externalEventId, provider: "SYNTHETIC" });
    const second = uniqueCreated({
      externalEventId,
      provider: "OTHER-PROVIDER",
      payloadHash: "SYNTHETIC:hash:other-provider",
    });
    const left = await store.repository.store(first);
    const right = await store.repository.store(second);
    expect(left.outcome).toBe("STORED");
    expect(right.outcome).toBe("STORED");
  });

  it("treats different event IDs as independent", async () => {
    const first = uniqueCreated();
    const second = uniqueCreated();
    expect(first.externalEventId).not.toBe(second.externalEventId);
    expect((await store.repository.store(first)).outcome).toBe("STORED");
    expect((await store.repository.store(second)).outcome).toBe("STORED");
  });

  it("persists payment ID, currency, occurredAt, and bigint amount", async () => {
    const event = uniqueCreated({
      paymentId: "SYNTHETIC:pay:round-trip",
      amountMinor: 9007199254740993n,
      currency: "INR",
      occurredAt: "2024-03-01T00:00:00.000Z",
    });
    const stored = await store.repository.store(event);
    expect(stored.outcome).toBe("STORED");
    if (stored.outcome !== "STORED") {
      return;
    }
    const found = await store.repository.findById(stored.record.id);
    expect(found?.event.paymentId).toBe("SYNTHETIC:pay:round-trip");
    expect(found?.event.currency).toBe("INR");
    expect(found?.event.occurredAt).toBe("2024-03-01T00:00:00.000Z");
    expect(found?.event.amountMinor).toBe(9007199254740993n);
    expect(typeof found?.event.amountMinor).toBe("bigint");
  });

  it("changes processing status without mutating event identity", async () => {
    const event = uniqueCreated();
    const stored = await store.repository.store(event);
    expect(stored.outcome).toBe("STORED");
    if (stored.outcome !== "STORED") {
      return;
    }
    const processing = await store.repository.markProcessing(stored.record.id);
    expect(processing.processingStatus).toBe("PROCESSING");
    const processed = await store.repository.markProcessed(stored.record.id);
    expect(processed.processingStatus).toBe("PROCESSED");
    expect(processed.event.externalEventId).toBe(event.externalEventId);
    await expect(
      store.repository.markRejected(stored.record.id),
    ).rejects.toBeInstanceOf(StorageError);
  });

  it("marks conflict on the stored row without changing payload fields", async () => {
    const event = uniqueCreated();
    const stored = await store.repository.store(event);
    expect(stored.outcome).toBe("STORED");
    if (stored.outcome !== "STORED") {
      return;
    }
    const conflicted = await store.repository.markConflict(stored.record.id);
    expect(conflicted.processingStatus).toBe("CONFLICT");
    expect(conflicted.event.payloadHash).toBe(event.payloadHash);
  });

  it("keeps concurrent identical inserts idempotent", async () => {
    const event = uniqueCreated();
    const other = await openWebhookEventStore({ url: TEST_URL });
    try {
      const [left, right] = await Promise.all([
        store.repository.store(event),
        other.repository.store(event),
      ]);
      const outcomes = [left.outcome, right.outcome].sort();
      expect(outcomes).toEqual(["DUPLICATE", "STORED"]);

      const ids = [left, right].map((result) => {
        if (result.outcome === "STORED" || result.outcome === "DUPLICATE") {
          return result.record.id;
        }
        throw new Error("concurrent insert returned CONFLICT");
      });
      expect(ids[0]).toBe(ids[1]);

      const found = await store.repository.findByIdentity(
        createWebhookIdentity(event.provider, event.externalEventId),
      );
      expect(found?.id).toBe(ids[0]);
    } finally {
      await other.close();
    }
  });

  it("delays out-of-order capture, then replays to CAPTURED after authorize", async () => {
    const payment = paymentId(`SYNTHETIC:pay:${randomUUID()}`);
    const provider = providerId("SYNTHETIC");
    const created = uniqueEvent(syntheticPaymentCreated, {
      paymentId: payment,
      occurredAt: "2026-01-15T10:00:00.000Z",
    });
    const captured = uniqueEvent(syntheticPaymentCaptured, {
      paymentId: payment,
      occurredAt: "2026-01-15T10:00:02.000Z",
    });

    expect((await store.repository.store(created)).outcome).toBe("STORED");
    const storedCaptured = await store.repository.store(captured);
    expect(storedCaptured.outcome).toBe("STORED");
    if (storedCaptured.outcome !== "STORED") {
      return;
    }

    const early = await processPaymentEvents(
      store.repository,
      provider,
      payment,
    );
    expect(early.payment?.state).toBe("CREATED");
    expect(early.delayed.map((event) => event.eventType)).toEqual([
      "payment.captured",
    ]);

    const retained = await store.repository.findByIdentity(
      createWebhookIdentity(captured.provider, captured.externalEventId),
    );
    expect(retained?.id).toBe(storedCaptured.record.id);
    expect(retained?.event.payloadHash).toBe(captured.payloadHash);
    expect(retained?.processingStatus).toBe("RECEIVED");

    const authorized = uniqueEvent(syntheticPaymentAuthorized, {
      paymentId: payment,
      occurredAt: "2026-01-15T10:00:01.000Z",
    });
    expect((await store.repository.store(authorized)).outcome).toBe("STORED");

    const resolved = await processPaymentEvents(
      store.repository,
      provider,
      payment,
    );
    expect(resolved.payment?.state).toBe("CAPTURED");
    expect(resolved.delayed).toHaveLength(0);

    const stillThere = await store.repository.findById(storedCaptured.record.id);
    expect(stillThere?.event.payloadHash).toBe(captured.payloadHash);
    expect(stillThere?.processingStatus).toBe("RECEIVED");
  });

  it("lists and replays only one payment's events", async () => {
    const payA = paymentId(`SYNTHETIC:pay:${randomUUID()}`);
    const payB = paymentId(`SYNTHETIC:pay:${randomUUID()}`);
    const provider = providerId("SYNTHETIC");

    const createdA = uniqueEvent(syntheticPaymentCreated, { paymentId: payA });
    const capturedB = uniqueEvent(syntheticPaymentCaptured, {
      paymentId: payB,
      occurredAt: "2026-01-15T10:00:02.000Z",
    });
    expect((await store.repository.store(createdA)).outcome).toBe("STORED");
    expect((await store.repository.store(capturedB)).outcome).toBe("STORED");

    const listedA = await store.repository.listByPayment(provider, payA);
    expect(listedA.map((row) => row.event.paymentId)).toEqual([payA]);

    const listedType = await store.repository.list({
      eventType: "payment.captured",
      paymentId: payB,
    });
    expect(listedType.map((row) => row.event.paymentId)).toEqual([payB]);

    const replayA = await processPaymentEvents(store.repository, provider, payA);
    expect(replayA.payment?.state).toBe("CREATED");
    expect(replayA.decisions).toHaveLength(1);

    const replayB = await processPaymentEvents(store.repository, provider, payB);
    expect(replayB.payment).toBeNull();
    expect(replayB.delayed.map((event) => event.eventType)).toEqual([
      "payment.captured",
    ]);
  });

  it("lists and replays only one provider's events for the same payment id", async () => {
    const payment = paymentId(`SYNTHETIC:pay:${randomUUID()}`);
    const created = uniqueEvent(syntheticPaymentCreated, {
      provider: "SYNTHETIC",
      paymentId: payment,
    });
    const otherCaptured = uniqueEvent(syntheticPaymentCaptured, {
      provider: "OTHER-PROVIDER",
      paymentId: payment,
      occurredAt: "2026-01-15T10:00:02.000Z",
    });
    expect((await store.repository.store(created)).outcome).toBe("STORED");
    expect((await store.repository.store(otherCaptured)).outcome).toBe("STORED");

    const syntheticReplay = await processPaymentEvents(
      store.repository,
      providerId("SYNTHETIC"),
      payment,
    );
    expect(syntheticReplay.payment?.state).toBe("CREATED");
    expect(syntheticReplay.decisions).toHaveLength(1);

    const otherReplay = await processPaymentEvents(
      store.repository,
      providerId("OTHER-PROVIDER"),
      payment,
    );
    expect(otherReplay.payment).toBeNull();
    expect(otherReplay.delayed).toHaveLength(1);
  });

  it("returns the same projection when processPaymentEvents runs twice", async () => {
    const payment = paymentId(`SYNTHETIC:pay:${randomUUID()}`);
    const created = uniqueEvent(syntheticPaymentCreated, { paymentId: payment });
    const captured = uniqueEvent(syntheticPaymentCaptured, {
      paymentId: payment,
      occurredAt: "2026-01-15T10:00:02.000Z",
    });
    expect((await store.repository.store(created)).outcome).toBe("STORED");
    expect((await store.repository.store(captured)).outcome).toBe("STORED");

    const first = await processPaymentEvents(
      store.repository,
      providerId("SYNTHETIC"),
      payment,
    );
    const second = await processPaymentEvents(
      store.repository,
      providerId("SYNTHETIC"),
      payment,
    );
    expect(
      JSON.stringify(first, (_key, value: unknown) =>
        typeof value === "bigint" ? `${value.toString()}n` : value,
      ),
    ).toBe(
      JSON.stringify(second, (_key, value: unknown) =>
        typeof value === "bigint" ? `${value.toString()}n` : value,
      ),
    );
  });
});
