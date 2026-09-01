import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { instant } from "@hookx/domain";
import { syntheticPaymentCreated } from "@hookx/testkit";
import { defaultTestDatabaseUrl } from "../config.js";
import { processPaymentEvents } from "../process-payment-events.js";
import {
  applyWebhookEventMigrations,
  openWebhookEventStore,
  recreateDatabase,
  type WebhookEventStore,
} from "../store.js";
import { RetryableProcessingError } from "./classify.js";
import { processWebhookAttempt } from "./process-attempt.js";
import { addMilliseconds } from "./time.js";
import { processFreshEvent, runRetryTick } from "./worker.js";

const NOW = instant("2026-01-15T10:00:01.000Z");
const POLICY = { maxAttempts: 5, baseDelayMs: 1_000, maxDelayMs: 8_000 };
const LEASE_MS = 2_000;

function retryTestDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const parsed = new URL(defaultTestDatabaseUrl(env));
  parsed.pathname = "/hookx_retry_test";
  return parsed.toString();
}

const TEST_URL = retryTestDatabaseUrl(process.env);

function uniqueCreated() {
  const token = randomUUID();
  return syntheticPaymentCreated({
    externalEventId: `SYNTHETIC:evt:${token}`,
    payloadHash: `SYNTHETIC:hash:${token}`,
    paymentId: `SYNTHETIC:pay:${token}`,
  });
}

describe("retry persistence and worker", () => {
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
        `HOOKX retry integration tests require PostgreSQL. Cause: ${message}`,
        { cause: error },
      );
    }
  }, 30_000);

  afterAll(async () => {
    if (store !== undefined) {
      await store.close();
    }
  });

  it("recovers a valid webhook after a temporary processing failure", async () => {
    const stored = await store.repository.store(uniqueCreated());
    expect(stored.outcome).toBe("STORED");
    if (stored.outcome !== "STORED") {
      return;
    }
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
    const deps = {
      retry: store.retry,
      events: store.repository,
      policy: POLICY,
      leaseMs: LEASE_MS,
      processPaymentEvents: processFn,
    };
    const scheduled = await processFreshEvent(deps, stored.record.id, NOW);
    expect(scheduled.status).toBe("RETRY_SCHEDULED");
    expect(scheduled.attemptCount).toBeGreaterThanOrEqual(1);
    const tick = await runRetryTick(
      {
        ...deps,
        audit: store.audit,
        persistOutcome: store.persistOutcome,
        actor: "RETRY_WORKER",
      },
      addMilliseconds(NOW, 1_000),
    );
    expect(tick.succeeded).toBe(1);
    const event = await store.repository.findById(stored.record.id);
    expect(event?.processingStatus).toBe("PROCESSED");
    const retry = await store.retry.getByWebhookEventId(stored.record.id);
    expect(retry?.status).toBe("SUCCEEDED");
    expect(retry?.attemptCount).toBeGreaterThanOrEqual(2);
    const audit = await store.audit.listByWebhook(stored.record.id);
    expect(audit.map((row) => row.eventType)).toEqual(
      expect.arrayContaining([
        "RETRY_ATTEMPTED",
        "RETRY_SUCCEEDED",
        "PAYMENT_STATE_CHANGED",
      ]),
    );
    expect(
      audit.filter((row) => row.eventType === "PAYMENT_STATE_CHANGED"),
    ).toHaveLength(1);
  });

  it("dead-letters a permanent failure without pointless retries", async () => {
    const stored = await store.repository.store(uniqueCreated());
    expect(stored.outcome).toBe("STORED");
    if (stored.outcome !== "STORED") {
      return;
    }
    const deps = {
      retry: store.retry,
      events: store.repository,
      policy: POLICY,
      leaseMs: LEASE_MS,
      processPaymentEvents: async () => {
        throw Object.assign(new Error("invalid"), {
          code: "INVALID_TRANSITION",
        });
      },
    };
    const result = await processFreshEvent(deps, stored.record.id, NOW);
    expect(result.status).toBe("DEAD_LETTERED");
    const dead = await store.retry.getDeadLetterByWebhookEventId(
      stored.record.id,
    );
    expect(dead?.failureCode).toBe("INVALID_TRANSITION");
    expect(dead?.attemptCount).toBe(1);
    const later = await runRetryTick(deps, addMilliseconds(NOW, 60_000));
    expect(later.claimed).toBe(0);
  });

  it("lets only one worker claim a due retry", async () => {
    const stored = await store.repository.store(uniqueCreated());
    expect(stored.outcome).toBe("STORED");
    if (stored.outcome !== "STORED") {
      return;
    }
    await store.retry.ensurePending(stored.record.id, NOW);
    const other = await openWebhookEventStore({ url: TEST_URL });
    try {
      const [left, right] = await Promise.all([
        store.retry.claimDue(NOW, 10, LEASE_MS),
        other.retry.claimDue(NOW, 10, LEASE_MS),
      ]);
      const claimedIds = [...left, ...right]
        .filter((row) => row.webhookEventId === stored.record.id)
        .map((row) => row.id);
      expect(claimedIds).toHaveLength(1);
      await store.retry.markSucceeded(claimedIds[0]!, NOW);
    } finally {
      await other.close();
    }
  });

  it("reclaims a stale PROCESSING lease with the injected clock", async () => {
    const stored = await store.repository.store(uniqueCreated());
    expect(stored.outcome).toBe("STORED");
    if (stored.outcome !== "STORED") {
      return;
    }
    await store.retry.ensurePending(stored.record.id, NOW);
    const pending = await store.retry.getByWebhookEventId(stored.record.id);
    const started = await store.retry.beginAttempt(pending!.id, NOW, LEASE_MS);
    expect(started?.status).toBe("PROCESSING");
    const deps = {
      retry: store.retry,
      events: store.repository,
      policy: POLICY,
      leaseMs: LEASE_MS,
    };
    await runRetryTick(deps, addMilliseconds(NOW, LEASE_MS - 1));
    expect(
      (await store.retry.getByWebhookEventId(stored.record.id))?.status,
    ).toBe("PROCESSING");
    await runRetryTick(deps, addMilliseconds(NOW, LEASE_MS));
    expect(
      (await store.retry.getByWebhookEventId(stored.record.id))?.status,
    ).toBe("SUCCEEDED");
    expect(
      (await store.repository.findById(stored.record.id))?.processingStatus,
    ).toBe("PROCESSED");
  });

  it("completes a retry when processing finished before the worker recorded success", async () => {
    const stored = await store.repository.store(uniqueCreated());
    expect(stored.outcome).toBe("STORED");
    if (stored.outcome !== "STORED") {
      return;
    }
    await store.retry.ensurePending(stored.record.id, NOW);
    const pending = await store.retry.getByWebhookEventId(stored.record.id);
    await store.retry.beginAttempt(pending!.id, NOW, LEASE_MS);
    const processed = await processWebhookAttempt(
      store.repository,
      stored.record.id,
    );
    expect(processed.outcome).toBe("SUCCEEDED");
    const tick = await runRetryTick(
      {
        retry: store.retry,
        events: store.repository,
        policy: POLICY,
        leaseMs: LEASE_MS,
      },
      addMilliseconds(NOW, LEASE_MS),
    );
    expect(tick.succeeded).toBe(1);
    expect(
      (await store.retry.getByWebhookEventId(stored.record.id))?.status,
    ).toBe("SUCCEEDED");
  });

  it("keeps a single event identity when a duplicate arrives during retry", async () => {
    const event = uniqueCreated();
    const stored = await store.repository.store(event);
    expect(stored.outcome).toBe("STORED");
    if (stored.outcome !== "STORED") {
      return;
    }
    const fail = async () => {
      throw new RetryableProcessingError();
    };
    const deps = {
      retry: store.retry,
      events: store.repository,
      policy: POLICY,
      leaseMs: LEASE_MS,
      processPaymentEvents: fail,
    };
    await processFreshEvent(deps, stored.record.id, NOW);
    const duplicate = await store.repository.store(event);
    expect(duplicate.outcome).toBe("DUPLICATE");
    const again = await processFreshEvent(deps, stored.record.id, NOW);
    expect(again.status).toBe("RETRY_SCHEDULED");
    expect(again.attemptCount).toBe(1);
  });

  it("cannot create two created transitions from retry plus duplicate plus retry", async () => {
    const event = uniqueCreated();
    const stored = await store.repository.store(event);
    expect(stored.outcome).toBe("STORED");
    if (stored.outcome !== "STORED") {
      return;
    }
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
    const deps = {
      retry: store.retry,
      events: store.repository,
      policy: POLICY,
      leaseMs: LEASE_MS,
      processPaymentEvents: processFn,
    };
    await processFreshEvent(deps, stored.record.id, NOW);
    expect((await store.repository.store(event)).outcome).toBe("DUPLICATE");
    await processFreshEvent(deps, stored.record.id, NOW);
    await runRetryTick(deps, addMilliseconds(NOW, 1_000));
    await processFreshEvent(deps, stored.record.id, addMilliseconds(NOW, 1_000));
    const listed = await store.repository.listByPayment(
      event.provider,
      event.paymentId,
    );
    expect(listed).toHaveLength(1);
    const replay = await processPaymentEvents(
      store.repository,
      event.provider,
      event.paymentId,
    );
    expect(replay.payment?.state).toBe("CREATED");
    expect(
      replay.decisions.filter((item) => item.decision === "ACCEPTED"),
    ).toHaveLength(1);
  });
});
