import type { AuditActor } from "@hookx/audit";
import { AUDIT_REASON } from "@hookx/audit";
import type { Instant } from "@hookx/domain";
import {
  factsFromReplayDecision,
  factsFromRetryOutcome,
  type DetectionFact,
} from "@hookx/exceptions";
import { processPaymentEvents } from "../process-payment-events.js";
import type { StoredPayment } from "../payment/types.js";
import { storedPaymentFromReplay } from "../payment/from-replay.js";
import type { WebhookEventRepository } from "../repository.js";
import { appendAuditDrafts } from "../audit/persist-outcome.js";
import {
  outcomeDraftsFromDecision,
  retryFailureReason,
  retryLifecycleDraft,
  type LiveAuditContext,
} from "../audit/live.js";
import type {
  AuditRepository,
  PersistOutcomeFn,
  WebhookTerminalStatus,
} from "../audit/repository.js";
import { recordExceptionsSafely } from "../exceptions/record.js";
import type { ExceptionRepository } from "../exceptions/repository.js";
import type { StoredWebhookEvent } from "../types.js";
import { FAILURE_CLASS, classifyFailure, safeFailureCode } from "./classify.js";
import type { RetryLifecycleSink } from "./lifecycle.js";
import { silentRetryLifecycleSink } from "./lifecycle.js";
import {
  assertRetryPolicy,
  calculateRetryDelay,
  type RetryPolicy,
} from "./policy.js";
import {
  processWebhookAttempt,
  type ProcessPaymentEventsFn,
  type ProcessingAttemptResult,
} from "./process-attempt.js";
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
  readonly audit?: AuditRepository;
  readonly persistOutcome?: PersistOutcomeFn;
  readonly correlationId?: string;
  readonly actor?: AuditActor;
  readonly exceptions?: ExceptionRepository;
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
    const correlationId = await resolveCorrelationId(
      dependencies,
      record.webhookEventId,
    );
    const outcome = await finishAttempt(
      dependencies,
      record,
      now,
      policy,
      processFn,
      lifecycle,
      correlationId,
      dependencies.actor ?? "RETRY_WORKER",
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
  correlationId: string,
  actor: AuditActor,
): Promise<"SUCCEEDED" | "RETRY_SCHEDULED" | "DEAD_LETTERED"> {
  lifecycle.record({
    webhookEventId: record.webhookEventId,
    attempt: record.attemptCount,
    previousStatus: claimedPreviousStatus(record),
    newStatus: "PROCESSING",
    reason: "CLAIMED",
    timestamp: now,
  });

  const stored = await dependencies.events.findById(record.webhookEventId);
  const context: LiveAuditContext | null =
    stored === null
      ? null
      : {
          stored,
          now,
          correlationId,
          actor,
          attempt: record.attemptCount,
        };
  const isRetryClaim =
    record.attemptCount > 1 || record.lastErrorCode !== null;
  if (context !== null && isRetryClaim) {
    await appendIfAuditing(dependencies.audit, [
      retryLifecycleDraft(context, "RETRY_ATTEMPTED", AUDIT_REASON.ACCEPTED),
    ]);
  }

  const defer = dependencies.persistOutcome !== undefined;
  const result = await processWebhookAttempt(
    dependencies.events,
    record.webhookEventId,
    processFn,
    { deferTerminalStatus: defer },
  );

  if (result.outcome === "SUCCEEDED" || result.outcome === "ALREADY_PROCESSED") {
    const drafts = [];
    if (result.outcome === "SUCCEEDED" && context !== null) {
      drafts.push(...outcomeDraftsFromDecision(context, result.decision));
    }
    if (isRetryClaim && context !== null) {
      drafts.push(
        retryLifecycleDraft(
          context,
          "RETRY_SUCCEEDED",
          result.outcome === "ALREADY_PROCESSED"
            ? AUDIT_REASON.ALREADY_PROCESSED
            : AUDIT_REASON.ACCEPTED,
        ),
      );
    }
    if (result.outcome === "SUCCEEDED") {
      const payment =
        context === null
          ? null
          : storedPaymentFromReplay(
              result.replay,
              result.decision,
              context.stored.event.provider,
              now,
            );
      await writeTerminal(
        dependencies,
        record.webhookEventId,
        "PROCESSED",
        drafts,
        payment,
      );
    } else {
      await appendIfAuditing(dependencies.audit, drafts);
    }
    await dependencies.retry.markSucceeded(record.id, now);
    lifecycle.record({
      webhookEventId: record.webhookEventId,
      attempt: record.attemptCount,
      previousStatus: record.status,
      newStatus: "SUCCEEDED",
      reason: result.outcome,
      timestamp: now,
    });
    if (result.outcome === "SUCCEEDED") {
      await recordAttemptExceptions(dependencies, {
        stored,
        now,
        correlationId,
        actor,
        retryOutcome: "SUCCEEDED",
        result,
        record,
        policy,
        exhaustedByAttempts: false,
      });
    }
    return "SUCCEEDED";
  }

  const code = safeFailureCode(result.code);
  const failureClass = classifyFailure(code);
  const exhaustedByAttempts = record.attemptCount >= policy.maxAttempts;
  const exhausted =
    result.outcome === "NON_RETRYABLE" ||
    failureClass === FAILURE_CLASS.NON_RETRYABLE ||
    exhaustedByAttempts;
  const reason = retryFailureReason(code, exhausted && exhaustedByAttempts);

  if (exhausted) {
    const decision =
      result.outcome === "NON_RETRYABLE" ? result.decision : undefined;
    const terminal: WebhookTerminalStatus | null =
      decision?.decision === "CONFLICT"
        ? "CONFLICT"
        : decision?.decision === "REJECTED"
          ? "REJECTED"
          : null;
    const drafts = [];
    if (context !== null) {
      drafts.push(...outcomeDraftsFromDecision(context, decision));
      drafts.push(
        retryLifecycleDraft(context, "RETRY_DEAD_LETTERED", reason),
      );
    }
    if (terminal !== null && defer) {
      await writeTerminal(
        dependencies,
        record.webhookEventId,
        terminal,
        drafts,
        null,
      );
    } else {
      await appendIfAuditing(dependencies.audit, drafts);
    }
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
    await recordAttemptExceptions(dependencies, {
      stored,
      now,
      correlationId,
      actor,
      retryOutcome: "DEAD_LETTERED",
      result,
      record,
      policy,
      exhaustedByAttempts: exhaustedByAttempts,
      failureCode: code,
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
  if (context !== null) {
    await appendIfAuditing(dependencies.audit, [
      retryLifecycleDraft(context, "RETRY_SCHEDULED", reason),
    ]);
  }
  lifecycle.record({
    webhookEventId: record.webhookEventId,
    attempt: record.attemptCount,
    previousStatus: record.status,
    newStatus: "RETRY_SCHEDULED",
    reason: code,
    timestamp: now,
  });
  await recordAttemptExceptions(dependencies, {
    stored,
    now,
    correlationId,
    actor,
    retryOutcome: "RETRY_SCHEDULED",
    result,
    record,
    policy,
    exhaustedByAttempts: false,
    failureCode: code,
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
    readonly audit?: AuditRepository;
    readonly persistOutcome?: PersistOutcomeFn;
    readonly correlationId?: string;
    readonly actor?: AuditActor;
    readonly exceptions?: ExceptionRepository;
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

  const correlationId = await resolveCorrelationId(dependencies, webhookEventId);
  await finishAttempt(
    {
      retry: dependencies.retry,
      events: dependencies.events,
      policy,
      processPaymentEvents: processFn,
      lifecycle,
      leaseMs: dependencies.leaseMs,
      audit: dependencies.audit,
      persistOutcome: dependencies.persistOutcome,
      correlationId,
      actor: dependencies.actor ?? "SYSTEM",
      exceptions: dependencies.exceptions,
    },
    started,
    now,
    policy,
    processFn,
    lifecycle,
    correlationId,
    dependencies.actor ?? "SYSTEM",
  );
  return (await dependencies.retry.getByWebhookEventId(webhookEventId)) ?? started;
}

async function recordAttemptExceptions(
  dependencies: RetryWorkerDependencies,
  input: {
    readonly stored: StoredWebhookEvent | null;
    readonly now: Instant;
    readonly correlationId: string;
    readonly actor: AuditActor;
    readonly retryOutcome: "SUCCEEDED" | "RETRY_SCHEDULED" | "DEAD_LETTERED";
    readonly result: ProcessingAttemptResult;
    readonly record: RetryRecord;
    readonly policy: RetryPolicy;
    readonly exhaustedByAttempts: boolean;
    readonly failureCode?: string;
  },
): Promise<void> {
  const facts: DetectionFact[] = [];
  const decision =
    input.result.outcome === "SUCCEEDED" ||
    input.result.outcome === "NON_RETRYABLE"
      ? input.result.decision
      : undefined;
  if (decision !== undefined && input.stored !== null) {
    facts.push(
      ...factsFromReplayDecision({
        decision: decision.decision,
        reason: decision.reason,
        previousState: decision.previousState,
        eventType: input.stored.event.eventType,
      }),
    );
  }
  facts.push(
    ...factsFromRetryOutcome({
      status: input.retryOutcome,
      attemptCount: input.record.attemptCount,
      maxAttempts: input.policy.maxAttempts,
      failureCode: input.failureCode,
      exhaustedByAttempts: input.exhaustedByAttempts,
    }),
  );
  if (facts.length === 0) {
    return;
  }
  await recordExceptionsSafely(
    {
      exceptions: dependencies.exceptions,
      audit: dependencies.audit,
    },
    {
      detectedAt: input.now,
      correlationId: input.correlationId,
      provider: input.stored?.event.provider ?? null,
      paymentId: input.stored?.event.paymentId ?? null,
      webhookEventId: input.stored?.id ?? input.record.webhookEventId,
      facts,
    },
    input.actor,
  );
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

async function resolveCorrelationId(
  dependencies: {
    readonly audit?: AuditRepository;
    readonly correlationId?: string;
  },
  webhookEventId: string,
): Promise<string> {
  if (dependencies.correlationId !== undefined) {
    return dependencies.correlationId;
  }
  if (dependencies.audit !== undefined) {
    const existing = await dependencies.audit.listByWebhook(webhookEventId);
    const first = existing[0];
    if (first !== undefined) {
      return first.correlationId;
    }
  }
  return `retry-${webhookEventId}`;
}

async function appendIfAuditing(
  audit: AuditRepository | undefined,
  drafts: readonly Parameters<AuditRepository["append"]>[0][],
): Promise<void> {
  if (audit === undefined || drafts.length === 0) {
    return;
  }
  await appendAuditDrafts(audit, drafts);
}

async function writeTerminal(
  dependencies: RetryWorkerDependencies,
  webhookEventId: string,
  status: WebhookTerminalStatus,
  drafts: readonly Parameters<AuditRepository["append"]>[0][],
  payment?: StoredPayment | null,
): Promise<void> {
  if (dependencies.persistOutcome !== undefined) {
    await dependencies.persistOutcome(webhookEventId, status, drafts, payment);
    return;
  }
  await appendIfAuditing(dependencies.audit, drafts);
}
