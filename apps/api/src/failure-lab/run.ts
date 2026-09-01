import type { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { paymentId, providerId, type Instant } from "@hookx/domain";
import {
  generateDeliveries,
  SIMULATOR_PROVIDER,
  type SignedDelivery,
} from "@hookx/simulator";
import {
  classifyFailure,
  DEFAULT_RETRY_LEASE_MS,
  DEFAULT_RETRY_POLICY,
  runRetryTick,
  type ProcessPaymentEventsFn,
  type RetryPolicy,
} from "@hookx/storage";
import { SYNTHETIC_SIGNATURE_HEADER } from "@hookx/webhook";
import type { ApiDependencies } from "../app.js";
import { loadIncidentTimeline } from "../observability/load-timeline.js";
import {
  bindScenarioToLabRun,
  failureModeForLab,
  simulatorScenarioForLab,
} from "./bind.js";
import {
  ARCHITECTURE_DEMO_SCENARIO,
  FAILURE_LAB_NOTICE,
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

function readJson(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  return value as Record<string, unknown>;
}

async function postDelivery(
  app: Hono,
  delivery: SignedDelivery,
  requestId: string,
): Promise<FailureLabDeliveryResult> {
  const response = await app.request("/webhooks/SYNTHETIC", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId,
      [SYNTHETIC_SIGNATURE_HEADER]: delivery.signature,
    },
    body: delivery.rawBody,
  });
  const body = readJson(await response.json());
  return {
    stepIndex: delivery.stepIndex,
    eventType: delivery.eventType,
    eventKey: delivery.eventKey,
    httpStatus: response.status,
    bodyStatus: String(body["status"] ?? ""),
    code: typeof body["code"] === "string" ? body["code"] : null,
    kind: delivery.kind,
  };
}

async function drainRetries(
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

export async function runFailureLabScenario(
  dependencies: ApiDependencies,
  app: Hono,
  processFn: ProcessPaymentEventsFn,
  scenarioId: FailureLabScenarioId,
  secret: string,
): Promise<FailureLabRunReport> {
  const catalog = failureLabCatalogEntry(scenarioId);
  const runId = randomUUID();
  const startedAt = dependencies.clock.now();
  const base = simulatorScenarioForLab(scenarioId);
  const bound = bindScenarioToLabRun(base, runId);
  const policy = dependencies.retryPolicy ?? DEFAULT_RETRY_POLICY;
  const mode = failureModeForLab(scenarioId);
  const deliveries = generateDeliveries(bound, {
    secret,
    now: dependencies.clock.now(),
  });
  const posted: FailureLabDeliveryResult[] = [];
  const replaySplit =
    scenarioId === "REPLAY_RECOVERY" ? 2 : deliveries.length;
  const provider = providerId(SIMULATOR_PROVIDER);
  const primaryPayment = bound.paymentIds[0];
  if (primaryPayment === undefined) {
    throw new Error("Failure Lab scenario has no payment id");
  }
  const pay = paymentId(primaryPayment);

  for (const delivery of deliveries.slice(0, replaySplit)) {
    posted.push(
      await postDelivery(app, delivery, `lab-${runId}-${delivery.stepIndex}`),
    );
  }

  let beforeState: string | null = null;
  if (scenarioId === "REPLAY_RECOVERY" && dependencies.payments !== undefined) {
    beforeState = (await dependencies.payments.get(provider, pay))?.state ?? null;
  }

  for (const delivery of deliveries.slice(replaySplit)) {
    posted.push(
      await postDelivery(app, delivery, `lab-${runId}-${delivery.stepIndex}`),
    );
  }

  const stored = await dependencies.repository.listByPayment(provider, pay);
  await drainRetries(
    dependencies,
    processFn,
    policy,
    stored.map((row) => row.id),
  );

  const afterPayment =
    dependencies.payments === undefined
      ? null
      : await dependencies.payments.get(provider, pay);
  const exceptions =
    dependencies.exceptions === undefined
      ? []
      : [...(await dependencies.exceptions.listByPayment(pay))];
  const primaryException = pickLabException(exceptions);
  const audit = await dependencies.audit.listByPayment(pay, provider);
  const refreshed = await dependencies.repository.listByPayment(provider, pay);

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

  const eventTimeOrder = [...bound.events]
    .sort((left, right) =>
      left.bookedAt < right.bookedAt
        ? -1
        : left.bookedAt > right.bookedAt
          ? 1
          : 0,
    )
    .map((item) => item.eventType);

  const firstEvent =
    refreshed.find((row) => row.event.eventType === "payment.created") ??
    refreshed[0];
  const delayed = audit.some((item) => item.eventType === "WEBHOOK_DELAYED");
  const stateChange = audit.filter(
    (item) => item.eventType === "PAYMENT_STATE_CHANGED",
  ).length;

  const demoRun = scenarioId === ARCHITECTURE_DEMO_SCENARIO;
  return {
    runId,
    scenario: scenarioId,
    title: catalog.title,
    synthetic: true,
    demoRun,
    labels: demoRun ? ["SYNTHETIC", "DEMO RUN"] : ["SYNTHETIC"],
    notice: FAILURE_LAB_NOTICE,
    startedAt,
    finishedAt: dependencies.clock.now(),
    failureMode: mode,
    retryPolicy: {
      maxAttempts: policy.maxAttempts,
      baseDelayMs: policy.baseDelayMs,
      maxDelayMs: policy.maxDelayMs,
    },
    input: {
      deliveries: posted.length,
      eventOrderSent: posted.map((row) => row.eventType),
      eventTimeOrder,
    },
    result: {
      processed: posted.filter((row) => row.bodyStatus === "accepted").length,
      duplicate: posted.filter((row) => row.bodyStatus === "duplicate").length,
      conflict: posted.filter((row) => row.bodyStatus === "conflict").length,
      error: posted.filter((row) => row.bodyStatus === "error").length,
      accepted: posted.filter((row) => row.bodyStatus === "accepted").length,
    },
    stateChange,
    payment: {
      paymentId: primaryPayment,
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
    auditCount: audit.length,
    retry: retrySnapshot,
    deadLetter: deadSnapshot,
    replay:
      scenarioId === "REPLAY_RECOVERY" || scenarioId === "OUT_OF_ORDER"
        ? {
            beforeState: scenarioId === "REPLAY_RECOVERY" ? beforeState : null,
            afterState: afterPayment?.state ?? null,
            delayed,
          }
        : null,
    log,
    deliveries: posted,
    links: {
      incident:
        primaryException === null
          ? null
          : `/incidents/${primaryException.exceptionId}`,
      payment: `/payments/${encodeURIComponent(primaryPayment)}`,
      event:
        firstEvent === undefined ? null : `/events/${firstEvent.id}`,
    },
  };
}
