import { processPaymentEvents } from "../process-payment-events.js";
import type { Instant } from "@hookx/domain";
import type { WebhookEventRepository } from "../repository.js";
import { FAILURE_CLASS, classifyFailure, safeFailureCode } from "./classify.js";
import type { RetryLifecycleSink } from "./lifecycle.js";
import { silentRetryLifecycleSink } from "./lifecycle.js";
import {
  assertRetryPolicy,
  calculateRetryDelay,
  type RetryPolicy,
} from "./policy.js";
import { processWebhookAttempt, type ProcessPaymentEventsFn } from "./process-attempt.js";
import type { RetryRepository } from "./repository.js";
import type { RetryStatus } from "./status.js";
import { addMilliseconds } from "./time.js";
import type { RetryRecord } from "./types.js";

export type RetryTickResult = {
  readonly claimed: number;
  readonly succeeded: number;
  readonly scheduled: number;
  readonly deadLettered: number;
};

export type RetryWorkerDependencies = {
  readonly retry: RetryRepository;
  readonly events: WebhookEventRepository;
  readonly policy: RetryPolicy;
  readonly processPaymentEvents?: ProcessPaymentEventsFn;
  readonly lifecycle?: RetryLifecycleSink;
  readonly leaseMs: number;
  readonly limit?: number;
};

export async function runRetryTick(
  dependencies: RetryWorkerDependencies,
  now: Instant,
): Promise<RetryTickResult> {
  const policy = assertRetryPolicy(dependencies.policy);
  const lifecycle = dependencies.lifecycle ?? silentRetryLifecycleSink();
  const processFn =
    dependencies.processPaymentEvents ?? processPaymentEvents;
  const limit = dependencies.limit ?? 10;

  const claimed = await dependencies.retry.claimDue(
    now,
    limit,
    dependencies.leaseMs,
  );

  let succeeded = 0;
  let scheduled = 0;
  let deadLettered = 0;

  for (const record of claimed) {
    const outcome = await finishAttempt(
      dependencies,
      record,
      now,
      policy,
      processFn,
      lifecycle,
    );
    if (outcome === "SUCCEEDED") {
      succeeded += 1;
    } else if (outcome === "RETRY_SCHEDULED") {
      scheduled += 1;
    } else {
      deadLettered += 1;
    }
  }

  return Object.freeze({
    claimed: claimed.length,
    succeeded,
    scheduled,
    deadLettered,
  });
}

async function finishAttempt(
  dependencies: RetryWorkerDependencies,
  record: RetryRecord,
  now: Instant,
  policy: RetryPolicy,
  processFn: ProcessPaymentEventsFn,
  lifecycle: RetryLifecycleSink,
): Promise<"SUCCEEDED" | "RETRY_SCHEDULED" | "DEAD_LETTERED"> {
  lifecycle.record({
    webhookEventId: record.webhookEventId,
    attempt: record.attemptCount,
    previousStatus: claimedPreviousStatus(record),
    newStatus: "PROCESSING",
    reason: "CLAIMED",
    timestamp: now,
  });

  const result = await processWebhookAttempt(
    dependencies.events,
    record.webhookEventId,
    processFn,
  );

  if (result.outcome === "SUCCEEDED" || result.outcome === "ALREADY_PROCESSED") {
    await dependencies.retry.markSucceeded(record.id, now);
    lifecycle.record({
      webhookEventId: record.webhookEventId,
      attempt: record.attemptCount,
      previousStatus: record.status,
      newStatus: "SUCCEEDED",
      reason: result.outcome,
      timestamp: now,
    });
    return "SUCCEEDED";
  }

  const code = safeFailureCode(result.code);
  const failureClass = classifyFailure(code);
  const exhausted =
    result.outcome === "NON_RETRYABLE" ||
    failureClass === FAILURE_CLASS.NON_RETRYABLE ||
    record.attemptCount >= policy.maxAttempts;

  if (exhausted) {
    await dependencies.retry.deadLetter(record.id, {
      errorCode: code,
      now,
    });
    lifecycle.record({
      webhookEventId: record.webhookEventId,
      attempt: record.attemptCount,
      previousStatus: record.status,
      newStatus: "DEAD_LETTERED",
      reason: code,
      timestamp: now,
    });
    return "DEAD_LETTERED";
  }

  const delayMs = calculateRetryDelay(record.attemptCount, policy);
  const nextAttemptAt = addMilliseconds(now, delayMs);
  await dependencies.retry.scheduleRetry(record.id, {
    nextAttemptAt,
    errorCode: code,
    failedAt: now,
    now,
  });
  lifecycle.record({
    webhookEventId: record.webhookEventId,
    attempt: record.attemptCount,
    previousStatus: record.status,
    newStatus: "RETRY_SCHEDULED",
    reason: code,
    timestamp: now,
  });
  return "RETRY_SCHEDULED";
}

export async function processFreshEvent(
  dependencies: {
    readonly retry: RetryRepository;
    readonly events: WebhookEventRepository;
    readonly policy: RetryPolicy;
    readonly processPaymentEvents?: ProcessPaymentEventsFn;
    readonly lifecycle?: RetryLifecycleSink;
    readonly leaseMs: number;
  },
  webhookEventId: string,
  now: Instant,
): Promise<RetryRecord> {
  const policy = assertRetryPolicy(dependencies.policy);
  const lifecycle = dependencies.lifecycle ?? silentRetryLifecycleSink();
  const processFn =
    dependencies.processPaymentEvents ?? processPaymentEvents;

  const pending = await dependencies.retry.ensurePending(webhookEventId, now);
  if (
    pending.status === "SUCCEEDED" ||
    pending.status === "DEAD_LETTERED" ||
    pending.status === "PROCESSING" ||
    pending.status === "RETRY_SCHEDULED"
  ) {
    return pending;
  }

  const started = await dependencies.retry.beginAttempt(
    pending.id,
    now,
    dependencies.leaseMs,
  );
  if (started === null) {
    return (await dependencies.retry.getByWebhookEventId(webhookEventId)) ?? pending;
  }

  await finishAttempt(
    {
      retry: dependencies.retry,
      events: dependencies.events,
      policy,
      processPaymentEvents: processFn,
      lifecycle,
      leaseMs: dependencies.leaseMs,
    },
    started,
    now,
    policy,
    processFn,
    lifecycle,
  );
  return (await dependencies.retry.getByWebhookEventId(webhookEventId)) ?? started;
}

function claimedPreviousStatus(record: RetryRecord): RetryStatus {
  if (record.lastErrorCode === null && record.attemptCount === 1) {
    return "PENDING";
  }
  if (record.lastErrorCode === null) {
    return "PROCESSING";
  }
  return "RETRY_SCHEDULED";
}
