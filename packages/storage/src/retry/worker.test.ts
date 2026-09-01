import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { instant, type PaymentId, type ProviderId } from "@hookx/domain";
import {
  syntheticPaymentCaptured,
  syntheticPaymentCreated,
} from "@hookx/testkit";
import { MemoryAuditRepository } from "../audit/memory-audit-repository.js";
import type { NormalizedWebhookEvent, WebhookIdentity } from "@hookx/webhook";
import type { WebhookProcessingStatus } from "../status.js";
import type { StoredWebhookEvent, StoreWebhookEventResult } from "../types.js";
import type { WebhookEventRepository, WebhookListFilter } from "../repository.js";
import { StorageError } from "../errors.js";
import { collectingRetryLifecycleSink } from "./lifecycle.js";
import { MemoryRetryRepository } from "./memory-retry-repository.js";
import { RetryableProcessingError } from "./classify.js";
import { addMilliseconds } from "./time.js";
import { processFreshEvent, runRetryTick } from "./worker.js";
import { processPaymentEvents } from "../process-payment-events.js";
import { selectWebhookList } from "../webhook-list.js";

const NOW = instant("2026-01-15T10:00:01.000Z");
const POLICY = { maxAttempts: 3, baseDelayMs: 1_000, maxDelayMs: 8_000 };
const LEASE_MS = 5_000;

class MemoryEvents implements WebhookEventRepository {
  public readonly records: StoredWebhookEvent[] = [];

  public async store(
    event: NormalizedWebhookEvent,
  ): Promise<StoreWebhookEventResult> {
    const existing = this.records.find(
      (row) =>
        row.event.provider === event.provider &&
        row.event.externalEventId === event.externalEventId,
    );
    if (existing !== undefined) {
      if (existing.event.payloadHash === event.payloadHash) {
        return { outcome: "DUPLICATE", record: existing };
      }
      return { outcome: "CONFLICT", existing, incoming: event };
    }
    const record: StoredWebhookEvent = Object.freeze({
      id: randomUUID(),
      event,
      processingStatus: "RECEIVED",
      createdAt: event.receivedAt,
    });
    this.records.push(record);
    return { outcome: "STORED", record };
  }

  public async findByIdentity(
    identity: WebhookIdentity,
  ): Promise<StoredWebhookEvent | null> {
    return (
      this.records.find(
        (row) =>
          row.event.provider === identity.provider &&
          row.event.externalEventId === identity.externalEventId,
      ) ?? null
    );
  }

  public async findById(id: string): Promise<StoredWebhookEvent | null> {
    return this.records.find((row) => row.id === id) ?? null;
  }

  public async list(
    filter?: WebhookListFilter,
  ): Promise<readonly StoredWebhookEvent[]> {
    return selectWebhookList(this.records, filter);
  }

  public async count(): Promise<number> {
    return this.records.length;
  }

  public async listByPayment(
    provider: ProviderId,
    paymentId: PaymentId,
  ): Promise<readonly StoredWebhookEvent[]> {
    return this.records.filter(
      (row) =>
        row.event.provider === provider && row.event.paymentId === paymentId,
    );
  }

  public async markProcessing(id: string): Promise<StoredWebhookEvent> {
    return this.transition(id, ["RECEIVED"], "PROCESSING");
  }

  public async markProcessed(id: string): Promise<StoredWebhookEvent> {
    return this.transition(id, ["PROCESSING"], "PROCESSED");
  }

  public async markRejected(id: string): Promise<StoredWebhookEvent> {
    return this.transition(id, ["PROCESSING"], "REJECTED");
  }

  public async markConflict(id: string): Promise<StoredWebhookEvent> {
    return this.transition(
      id,
      ["RECEIVED", "PROCESSING", "REJECTED", "CONFLICT"],
      "CONFLICT",
    );
  }

  private async transition(
    id: string,
    from: readonly WebhookProcessingStatus[],
    to: WebhookProcessingStatus,
  ): Promise<StoredWebhookEvent> {
    const index = this.records.findIndex((row) => row.id === id);
    const current = index === -1 ? undefined : this.records[index];
    if (current === undefined) {
      throw new StorageError("EVENT_NOT_FOUND", "not found");
    }
    if (current.processingStatus === to && from.includes(current.processingStatus)) {
      return current;
    }
    if (!from.includes(current.processingStatus)) {
      throw new StorageError(
        "INVALID_STATUS_TRANSITION",
        "illegal status transition",
      );
    }
    const next: StoredWebhookEvent = Object.freeze({
      ...current,
      processingStatus: to,
    });
    this.records[index] = next;
    return next;
  }
}

function workerDeps(
  events: MemoryEvents,
  retry: MemoryRetryRepository,
  processFn = processPaymentEvents,
) {
  return {
    retry,
    events,
    policy: POLICY,
    leaseMs: LEASE_MS,
    processPaymentEvents: processFn,
  };
}

describe("retry worker", () => {
  it("processes a stored event successfully", async () => {
    const events = new MemoryEvents();
    const retry = new MemoryRetryRepository();
    const stored = await events.store(syntheticPaymentCreated());
    if (stored.outcome !== "STORED") {
      throw new Error("expected store");
    }
    const result = await processFreshEvent(
      workerDeps(events, retry),
      stored.record.id,
      NOW,
    );
    expect(result.status).toBe("SUCCEEDED");
    expect((await events.findById(stored.record.id))?.processingStatus).toBe(
      "PROCESSED",
    );
  });

  it("schedules a retry after a retryable failure", async () => {
    const events = new MemoryEvents();
    const retry = new MemoryRetryRepository();
    const stored = await events.store(syntheticPaymentCreated());
    if (stored.outcome !== "STORED") {
      throw new Error("expected store");
    }
    const result = await processFreshEvent(
      workerDeps(events, retry, async () => {
        throw new RetryableProcessingError();
      }),
      stored.record.id,
      NOW,
    );
    expect(result.status).toBe("RETRY_SCHEDULED");
    expect(result.attemptCount).toBe(1);
    expect(result.nextAttemptAt).toBe(addMilliseconds(NOW, 1_000));
    expect(result.lastErrorCode).toBe("TEMPORARY_UNAVAILABLE");
  });

  it("dead-letters a non-retryable failure without further schedules", async () => {
    const events = new MemoryEvents();
    const retry = new MemoryRetryRepository();
    const stored = await events.store(syntheticPaymentCreated());
    if (stored.outcome !== "STORED") {
      throw new Error("expected store");
    }
    const result = await processFreshEvent(
      workerDeps(events, retry, async () => {
        throw Object.assign(new Error("conflict"), {
          code: "PERMANENT_CONFLICT",
        });
      }),
      stored.record.id,
      NOW,
    );
    expect(result.status).toBe("DEAD_LETTERED");
    expect(retry.deadLetters).toHaveLength(1);
    expect(retry.deadLetters[0]?.failureCode).toBe("PERMANENT_CONFLICT");
    const tick = await runRetryTick(
      workerDeps(events, retry, async () => {
        throw new Error("should not run");
      }),
      addMilliseconds(NOW, 60_000),
    );
    expect(tick.claimed).toBe(0);
  });

  it("retries after a temporary failure and then succeeds", async () => {
    const events = new MemoryEvents();
    const retry = new MemoryRetryRepository();
    const stored = await events.store(syntheticPaymentCreated());
    if (stored.outcome !== "STORED") {
      throw new Error("expected store");
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
    await processFreshEvent(
      workerDeps(events, retry, processFn),
      stored.record.id,
      NOW,
    );
    const tooEarly = await runRetryTick(
      workerDeps(events, retry, processFn),
      addMilliseconds(NOW, 500),
    );
    expect(tooEarly.claimed).toBe(0);
    const due = await runRetryTick(
      workerDeps(events, retry, processFn),
      addMilliseconds(NOW, 1_000),
    );
    expect(due.succeeded).toBe(1);
    expect((await events.findById(stored.record.id))?.processingStatus).toBe(
      "PROCESSED",
    );
    expect(calls).toBe(2);
  });

  it("dead-letters after the maximum number of attempts", async () => {
    const events = new MemoryEvents();
    const retry = new MemoryRetryRepository();
    const stored = await events.store(syntheticPaymentCreated());
    if (stored.outcome !== "STORED") {
      throw new Error("expected store");
    }
    const fail = async () => {
      throw new RetryableProcessingError();
    };
    await processFreshEvent(workerDeps(events, retry, fail), stored.record.id, NOW);
    await runRetryTick(
      workerDeps(events, retry, fail),
      addMilliseconds(NOW, 1_000),
    );
    await runRetryTick(
      workerDeps(events, retry, fail),
      addMilliseconds(NOW, 4_000),
    );
    const row = await retry.getByWebhookEventId(stored.record.id);
    expect(row?.status).toBe("DEAD_LETTERED");
    expect(row?.attemptCount).toBe(3);
  });

  it("does not create a second transition when a duplicate arrives during retry", async () => {
    const events = new MemoryEvents();
    const retry = new MemoryRetryRepository();
    const event = syntheticPaymentCreated();
    const first = await events.store(event);
    if (first.outcome !== "STORED") {
      throw new Error("expected store");
    }
    await processFreshEvent(
      workerDeps(events, retry, async () => {
        throw new RetryableProcessingError();
      }),
      first.record.id,
      NOW,
    );
    const duplicate = await events.store(event);
    expect(duplicate.outcome).toBe("DUPLICATE");
    const again = await processFreshEvent(
      workerDeps(events, retry, async () => {
        throw new RetryableProcessingError();
      }),
      first.record.id,
      NOW,
    );
    expect(again.status).toBe("RETRY_SCHEDULED");
    expect(again.attemptCount).toBe(1);
    expect(events.records).toHaveLength(1);
  });

  it("schedules exponential backoff from the attempt count", async () => {
    const events = new MemoryEvents();
    const retry = new MemoryRetryRepository();
    const stored = await events.store(syntheticPaymentCreated());
    if (stored.outcome !== "STORED") {
      throw new Error("expected store");
    }
    const fail = async () => {
      throw new RetryableProcessingError();
    };
    await processFreshEvent(workerDeps(events, retry, fail), stored.record.id, NOW);
    await runRetryTick(workerDeps(events, retry, fail), addMilliseconds(NOW, 1_000));
    const row = await retry.getByWebhookEventId(stored.record.id);
    expect(row?.status).toBe("RETRY_SCHEDULED");
    expect(row?.attemptCount).toBe(2);
    expect(row?.nextAttemptAt).toBe(addMilliseconds(NOW, 3_000));
  });

  it("does not claim the same retry while its lease is held", async () => {
    const events = new MemoryEvents();
    const retry = new MemoryRetryRepository();
    const stored = await events.store(syntheticPaymentCreated());
    if (stored.outcome !== "STORED") {
      throw new Error("expected store");
    }
    await retry.ensurePending(stored.record.id, NOW);
    const first = await retry.beginAttempt(
      (await retry.getByWebhookEventId(stored.record.id))!.id,
      NOW,
      LEASE_MS,
    );
    const second = await retry.beginAttempt(first!.id, NOW, LEASE_MS);
    expect(first?.status).toBe("PROCESSING");
    expect(second).toBeNull();
    const claimed = await retry.claimDue(NOW, 10, LEASE_MS);
    expect(claimed).toHaveLength(0);
  });

  it("does not apply a second payment transition across retry and duplicate", async () => {
    const events = new MemoryEvents();
    const retry = new MemoryRetryRepository();
    const event = syntheticPaymentCreated();
    const stored = await events.store(event);
    if (stored.outcome !== "STORED") {
      throw new Error("expected store");
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
    await processFreshEvent(
      workerDeps(events, retry, processFn),
      stored.record.id,
      NOW,
    );
    const duplicate = await events.store(event);
    expect(duplicate.outcome).toBe("DUPLICATE");
    await processFreshEvent(
      workerDeps(events, retry, processFn),
      stored.record.id,
      NOW,
    );
    await runRetryTick(
      workerDeps(events, retry, processFn),
      addMilliseconds(NOW, 1_000),
    );
    await processFreshEvent(
      workerDeps(events, retry, processFn),
      stored.record.id,
      addMilliseconds(NOW, 1_000),
    );
    expect(events.records).toHaveLength(1);
    const replay = await processPaymentEvents(
      events,
      event.provider,
      event.paymentId,
    );
    expect(replay.payment?.state).toBe("CREATED");
    expect(replay.decisions.filter((item) => item.decision === "ACCEPTED")).toHaveLength(
      1,
    );
    expect((await retry.getByWebhookEventId(stored.record.id))?.status).toBe(
      "SUCCEEDED",
    );
  });

  it("recovers a stale PROCESSING lease with the injected clock", async () => {
    const events = new MemoryEvents();
    const retry = new MemoryRetryRepository();
    const stored = await events.store(syntheticPaymentCreated());
    if (stored.outcome !== "STORED") {
      throw new Error("expected store");
    }
    await retry.ensurePending(stored.record.id, NOW);
    const started = await retry.beginAttempt(
      (await retry.getByWebhookEventId(stored.record.id))!.id,
      NOW,
      LEASE_MS,
    );
    expect(started?.status).toBe("PROCESSING");
    const beforeLease = await runRetryTick(
      workerDeps(events, retry),
      addMilliseconds(NOW, LEASE_MS - 1),
    );
    expect(beforeLease.claimed).toBe(0);
    const afterLease = await runRetryTick(
      workerDeps(events, retry),
      addMilliseconds(NOW, LEASE_MS),
    );
    expect(afterLease.claimed).toBe(1);
    expect(afterLease.succeeded).toBe(1);
  });

  it("emits retry lifecycle transitions for audit", async () => {
    const events = new MemoryEvents();
    const retry = new MemoryRetryRepository();
    const stored = await events.store(syntheticPaymentCreated());
    if (stored.outcome !== "STORED") {
      throw new Error("expected store");
    }
    const transitions: Parameters<typeof collectingRetryLifecycleSink>[0] = [];
    const audit = collectingRetryLifecycleSink(transitions);
    await processFreshEvent(
      {
        ...workerDeps(events, retry, async () => {
          throw new RetryableProcessingError();
        }),
        lifecycle: audit,
      },
      stored.record.id,
      NOW,
    );
    expect(transitions).toHaveLength(2);
    expect(transitions[0]?.newStatus).toBe("PROCESSING");
    expect(transitions[0]?.reason).toBe("CLAIMED");
    expect(transitions[1]?.newStatus).toBe("RETRY_SCHEDULED");
    expect(transitions[1]?.reason).toBe("TEMPORARY_UNAVAILABLE");
    expect(transitions[1]?.timestamp).toBe(NOW);
  });

  it("audits a live state change without rewriting history on replay", async () => {
    const events = new MemoryEvents();
    const retry = new MemoryRetryRepository();
    const trail = new MemoryAuditRepository();
    const stored = await events.store(syntheticPaymentCreated());
    if (stored.outcome !== "STORED") {
      throw new Error("expected store");
    }
    await processFreshEvent(
      {
        ...workerDeps(events, retry),
        audit: trail,
        correlationId: "corr-state",
      },
      stored.record.id,
      NOW,
    );
    await processPaymentEvents(
      events,
      stored.record.event.provider,
      stored.record.event.paymentId,
    );
    const rows = await trail.listByCorrelationId("corr-state");
    expect(rows.map((row) => row.eventType)).toEqual(["PAYMENT_STATE_CHANGED"]);
    expect(rows[0]?.previousState).toBeNull();
    expect(rows[0]?.resultingState).toBe("CREATED");
    expect(rows[0]?.occurredAt).toBe(stored.record.event.occurredAt);
    expect(rows[0]?.recordedAt).toBe(NOW);
  });

  it("audits a delayed event and a rejected transition", async () => {
    const events = new MemoryEvents();
    const retry = new MemoryRetryRepository();
    const trail = new MemoryAuditRepository();
    const paymentId = `SYNTHETIC:pay:${randomUUID()}`;
    const captured = await events.store(
      syntheticPaymentCaptured({
        paymentId,
        externalEventId: `SYNTHETIC:evt:${randomUUID()}`,
        payloadHash: `SYNTHETIC:hash:${randomUUID()}`,
      }),
    );
    if (captured.outcome !== "STORED") {
      throw new Error("expected store");
    }
    await processFreshEvent(
      {
        ...workerDeps(events, retry),
        audit: trail,
        correlationId: "corr-delay",
      },
      captured.record.id,
      NOW,
    );
    const delayed = await trail.listByCorrelationId("corr-delay");
    expect(delayed.map((row) => row.eventType)).toEqual(["WEBHOOK_DELAYED"]);
    expect(delayed[0]?.reason).toBe("AWAITING_PREREQUISITE");

    const payment = `SYNTHETIC:pay:${randomUUID()}`;
    const first = await events.store(
      syntheticPaymentCreated({
        paymentId: payment,
        externalEventId: "SYNTHETIC:evt:created-first",
        payloadHash: "SYNTHETIC:hash:created-first",
        occurredAt: instant("2026-01-15T10:00:00.000Z"),
      }),
    );
    if (first.outcome !== "STORED") {
      throw new Error("expected store");
    }
    await processFreshEvent(
      {
        ...workerDeps(events, retry),
        audit: trail,
        correlationId: "corr-created",
      },
      first.record.id,
      NOW,
    );
    const second = await events.store(
      syntheticPaymentCreated({
        paymentId: payment,
        externalEventId: "SYNTHETIC:evt:created-second",
        payloadHash: "SYNTHETIC:hash:created-second",
        occurredAt: instant("2026-01-15T10:00:01.000Z"),
      }),
    );
    if (second.outcome !== "STORED") {
      throw new Error("expected store");
    }
    await processFreshEvent(
      {
        ...workerDeps(events, retry),
        audit: trail,
        correlationId: "corr-conflict",
      },
      second.record.id,
      NOW,
    );
    const conflicted = await trail.listByCorrelationId("corr-conflict");
    expect(conflicted.map((row) => row.eventType)).toEqual([
      "WEBHOOK_CONFLICT",
      "RETRY_DEAD_LETTERED",
    ]);
    expect(conflicted[0]?.previousState).toBe("CREATED");
    expect(conflicted[0]?.resultingState).toBe("CREATED");
  });

  it("audits retry schedule, attempt, success, and dead-letter", async () => {
    const events = new MemoryEvents();
    const retry = new MemoryRetryRepository();
    const trail = new MemoryAuditRepository();
    const stored = await events.store(syntheticPaymentCreated());
    if (stored.outcome !== "STORED") {
      throw new Error("expected store");
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
    await processFreshEvent(
      {
        ...workerDeps(events, retry, processFn),
        audit: trail,
        correlationId: "corr-retry",
      },
      stored.record.id,
      NOW,
    );
    await runRetryTick(
      {
        ...workerDeps(events, retry, processFn),
        audit: trail,
        actor: "RETRY_WORKER",
      },
      addMilliseconds(NOW, 1_000),
    );
    expect((await trail.listByCorrelationId("corr-retry")).map((row) => row.eventType)).toEqual(
      ["RETRY_SCHEDULED", "RETRY_ATTEMPTED", "PAYMENT_STATE_CHANGED", "RETRY_SUCCEEDED"],
    );

    const deadEvents = new MemoryEvents();
    const deadRetry = new MemoryRetryRepository();
    const deadTrail = new MemoryAuditRepository();
    const deadStored = await deadEvents.store(syntheticPaymentCreated());
    if (deadStored.outcome !== "STORED") {
      throw new Error("expected store");
    }
    await processFreshEvent(
      {
        ...workerDeps(deadEvents, deadRetry, async () => {
          throw Object.assign(new Error("conflict"), {
            code: "PERMANENT_CONFLICT",
          });
        }),
        audit: deadTrail,
        correlationId: "corr-dead",
      },
      deadStored.record.id,
      NOW,
    );
    expect(
      (await deadTrail.listByCorrelationId("corr-dead")).map((row) => row.eventType),
    ).toEqual(["RETRY_DEAD_LETTERED"]);
  });
});
