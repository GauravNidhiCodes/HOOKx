import { paymentId, type Instant, type ProviderId } from "@hookx/domain";
import {
  classifyFailure,
  DEFAULT_RETRY_LEASE_MS,
  DEFAULT_RETRY_POLICY,
  runRetryTick,
  type ProcessPaymentEventsFn,
  type RetryPolicy,
} from "@hookx/storage";
import type { ApiDependencies } from "../app.js";
import { loadIncidentTimeline } from "../observability/load-timeline.js";
import { failureModeForLab } from "./bind.js";
import {
  ARCHITECTURE_DEMO_SCENARIO,
  FAILURE_LAB_NOTICE,
  GOLDEN_DEMO_NOTICE,
  GOLDEN_DEMO_SCENARIO,
  failureLabCatalogEntry,
  type FailureLabScenarioId,
} from "./catalog.js";
import type {
  FailureLabDeliveryResult,
  FailureLabLogEntry,
  FailureLabRunReport,
} from "./report.js";

const LAB_EXCEPTION_PRIORITY = [
  "CONFLICTING_EVENT",
  "RETRY_EXHAUSTED",
  "PROCESSING_FAILURE",
  "DUPLICATE_EVENT",
  "OUT_OF_ORDER_EVENT",
  "MISSING_EVENT",
] as const;

function pickLabException<T extends { readonly exceptionCode: string }>(
  rows: readonly T[],
): T | null {
  for (const code of LAB_EXCEPTION_PRIORITY) {
    const match = rows.find((row) => row.exceptionCode === code);
    if (match !== undefined) {
      return match;
    }
  }
  return rows[0] ?? null;
}

export async function drainLabRetries(
  dependencies: ApiDependencies,
  processFn: ProcessPaymentEventsFn,
  policy: RetryPolicy,
  webhookEventIds: readonly string[],
): Promise<void> {
  const leaseMs = dependencies.leaseMs ?? DEFAULT_RETRY_LEASE_MS;
  const tickLimit = policy.maxAttempts + 2;
  for (let tick = 0; tick < tickLimit; tick += 1) {
    let due: Instant | null = null;
    for (const id of webhookEventIds) {
      const row = await dependencies.retry.getByWebhookEventId(id);
      if (row !== null && row.status === "RETRY_SCHEDULED") {
        due = row.nextAttemptAt ?? dependencies.clock.now();
        break;
      }
    }
    if (due === null) {
      return;
    }
    const now = due < dependencies.clock.now() ? dependencies.clock.now() : due;
    await runRetryTick(
      {
        retry: dependencies.retry,
        events: dependencies.repository,
        policy,
        leaseMs,
        processPaymentEvents: processFn,
        audit: dependencies.audit,
        persistOutcome: dependencies.persistOutcome,
        actor: "RETRY_WORKER",
        exceptions: dependencies.exceptions,
      },
      now,
    );
  }
}

export type ComposeFailureLabReportInput = {
  readonly scenarioId: FailureLabScenarioId;
  readonly runId: string;
  readonly startedAt: Instant;
  readonly posted: readonly FailureLabDeliveryResult[];
  readonly provider: ProviderId;
  readonly paymentIdValue: string;
  readonly eventTimeOrder: readonly string[];
  readonly labels: readonly string[];
  readonly beforeState?: string | null;
  readonly correlationId?: string;
};

export async function composeFailureLabReport(
  dependencies: ApiDependencies,
  processFn: ProcessPaymentEventsFn,
  input: ComposeFailureLabReportInput,
): Promise<FailureLabRunReport> {
  const catalog = failureLabCatalogEntry(input.scenarioId);
  const policy = dependencies.retryPolicy ?? DEFAULT_RETRY_POLICY;
  const mode = failureModeForLab(input.scenarioId);
  const pay = paymentId(input.paymentIdValue);
  const stored = await dependencies.repository.listByPayment(
    input.provider,
    pay,
  );
  await drainLabRetries(
    dependencies,
    processFn,
    policy,
    stored.map((row) => row.id),
  );

  const afterPayment =
    dependencies.payments === undefined
      ? null
      : await dependencies.payments.get(input.provider, pay);
  const exceptions =
    dependencies.exceptions === undefined
      ? []
      : [...(await dependencies.exceptions.listByPayment(pay))];
  const primaryException = pickLabException(exceptions);
  const audit = await dependencies.audit.listByPayment(pay, input.provider);
  const refreshed = await dependencies.repository.listByPayment(
    input.provider,
    pay,
  );

  let retrySnapshot = null;
  let deadSnapshot = null;
  for (const row of refreshed) {
    const retry = await dependencies.retry.getByWebhookEventId(row.id);
    if (retry !== null) {
      retrySnapshot = {
        attemptCount: retry.attemptCount,
        status: retry.status,
        nextAttemptAt: retry.nextAttemptAt,
        lastErrorCode: retry.lastErrorCode,
        lastFailedAt: retry.lastFailedAt,
        failureClass:
          retry.lastErrorCode === null
            ? null
            : classifyFailure(retry.lastErrorCode),
      };
    }
    const dead = await dependencies.retry.getDeadLetterByWebhookEventId(row.id);
    if (dead !== null) {
      deadSnapshot = {
        failureCode: dead.failureCode,
        attemptCount: dead.attemptCount,
        deadLetteredAt: dead.deadLetteredAt,
      };
    }
  }

  let log: FailureLabLogEntry[] = [];
  if (primaryException !== null && dependencies.exceptions !== undefined) {
    const composed = await loadIncidentTimeline(
      {
        exceptions: dependencies.exceptions,
        audit: dependencies.audit,
        repository: dependencies.repository,
        retry: dependencies.retry,
        investigations: dependencies.investigations,
        liveProviders: dependencies.liveProviders,
      },
      primaryException.exceptionId,
    );
    if (composed !== null) {
      log = composed.items.map((item) => ({
        clock: item.clock,
        lifecycle: item.lifecycle,
        decision: item.decision,
        inferred: item.inferred,
      }));
    }
  }
  if (log.length === 0) {
    log = audit.map((item) => ({
      clock: item.recordedAt,
      lifecycle: item.eventType,
      decision: item.reason,
      inferred: false,
    }));
  }

  const firstEvent =
    refreshed.find((row) => row.event.eventType === "payment.created") ??
    refreshed[0];
  const delayed = audit.some((item) => item.eventType === "WEBHOOK_DELAYED");
  const stateChange = audit.filter(
    (item) => item.eventType === "PAYMENT_STATE_CHANGED",
  ).length;

  const demoRun =
    input.scenarioId === ARCHITECTURE_DEMO_SCENARIO ||
    input.scenarioId === GOLDEN_DEMO_SCENARIO;
  const notice =
    input.scenarioId === GOLDEN_DEMO_SCENARIO
      ? GOLDEN_DEMO_NOTICE
      : FAILURE_LAB_NOTICE;
  return {
    runId: input.runId,
    scenario: input.scenarioId,
    title: catalog.title,
    synthetic: true,
    demoRun,
    labels: [...input.labels],
    notice,
    startedAt: input.startedAt,
    finishedAt: dependencies.clock.now(),
    failureMode: mode,
    retryPolicy: {
      maxAttempts: policy.maxAttempts,
      baseDelayMs: policy.baseDelayMs,
      maxDelayMs: policy.maxDelayMs,
    },
    input: {
      deliveries: input.posted.length,
      eventOrderSent: input.posted.map((row) => row.eventType),
      eventTimeOrder: input.eventTimeOrder,
    },
    result: {
      processed: input.posted.filter((row) => row.bodyStatus === "accepted")
        .length,
      duplicate: input.posted.filter((row) => row.bodyStatus === "duplicate")
        .length,
      conflict: input.posted.filter((row) => row.bodyStatus === "conflict")
        .length,
      error: input.posted.filter((row) => row.bodyStatus === "error").length,
      accepted: input.posted.filter((row) => row.bodyStatus === "accepted")
        .length,
    },
    stateChange,
    payment: {
      provider: input.provider,
      paymentId: input.paymentIdValue,
      state: afterPayment?.state ?? null,
      amountMinor: afterPayment?.amountMinor.toString() ?? null,
    },
    originalAmountMinor: firstEvent?.event.amountMinor.toString() ?? null,
    originalPayloadHash: firstEvent?.event.payloadHash ?? null,
    exception:
      primaryException === null
        ? null
        : {
            exceptionId: primaryException.exceptionId,
            exceptionCode: primaryException.exceptionCode,
          },
    incidentId: primaryException?.exceptionId ?? null,
    correlationId: input.correlationId ?? null,
    storedEventCount: refreshed.length,
    eventProcessingStatus: firstEvent?.processingStatus ?? null,
    eventType: firstEvent?.event.eventType ?? null,
    auditCount: audit.length,
    retry: retrySnapshot,
    deadLetter: deadSnapshot,
    replay:
      input.scenarioId === "REPLAY_RECOVERY" ||
      input.scenarioId === "OUT_OF_ORDER"
        ? {
            beforeState:
              input.scenarioId === "REPLAY_RECOVERY"
                ? (input.beforeState ?? null)
                : null,
            afterState: afterPayment?.state ?? null,
            delayed,
          }
        : null,
    log,
    deliveries: input.posted,
    links: {
      incident:
        primaryException === null
          ? null
          : `/incidents/${primaryException.exceptionId}`,
      payment: `/payments/${encodeURIComponent(input.paymentIdValue)}`,
      event: firstEvent === undefined ? null : `/events/${firstEvent.id}`,
    },
  };
}
