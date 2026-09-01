import { instant, paymentId, providerId } from "@hookx/domain";
import type { Hono } from "hono";
import {
  addMilliseconds,
  runRetryTick,
  type WebhookEventStore,
} from "@hookx/storage";
import {
  generateDeliveries,
  SIMULATOR_NOW,
  SIMULATOR_PROVIDER,
  SIMULATOR_SECRET,
  type DeliveryReport,
  type PaymentReport,
  type ScenarioDefinition,
  type ScenarioRunView,
  type SignedDelivery,
} from "@hookx/simulator";
import { createApp } from "../app.js";
import { fixedClock } from "../clock.js";
import { createSimulatorProcessFn } from "./failure-process.js";
import { createSignatureVerifierRegistry, SYNTHETIC_SIGNATURE_HEADER } from "@hookx/webhook";

export type ScenarioRunResult = ScenarioRunView & {
  readonly storedEventCount: number;
  readonly stateTransitionCount: number;
  readonly auditEventTypes: readonly string[];
  readonly delayedAuditCount: number;
  readonly retryStatus: string | null;
  readonly retryAttemptCount: number;
  readonly deadLettered: boolean;
  readonly originalAmountMinor: string | null;
  readonly exceptionCodes: readonly string[];
};

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
): Promise<{ readonly status: number; readonly body: Record<string, unknown> }> {
  const response = await app.request("/webhooks/SYNTHETIC", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId,
      [SYNTHETIC_SIGNATURE_HEADER]: delivery.signature,
    },
    body: delivery.rawBody,
  });
  return {
    status: response.status,
    body: readJson(await response.json()),
  };
}

function noteFor(
  scenario: ScenarioDefinition,
  delivery: SignedDelivery,
  bodyStatus: string,
): string | undefined {
  if (delivery.kind === "RESEND_IDENTICAL" || delivery.kind === "SEND_CONFLICTING") {
    return undefined;
  }
  if (
    scenario.id === "OUT_OF_ORDER" &&
    delivery.eventType === "payment.captured"
  ) {
    return bodyStatus === "accepted" ? "delayed" : undefined;
  }
  return undefined;
}

/**
 * Drive a scenario through the production Hono webhook route, then inspect
 * stored results. Does not call internal ingest functions directly.
 */
export async function runScenario(
  store: WebhookEventStore,
  scenario: ScenarioDefinition,
): Promise<ScenarioRunResult> {
  const processFn = createSimulatorProcessFn(scenario.failure);
  const app = createApp({
    repository: store.repository,
    retry: store.retry,
    audit: store.audit,
    payments: store.payments,
    persistOutcome: store.persistOutcome,
    exceptions: store.exceptions,
    retryPolicy: {
      maxAttempts: scenario.retry.maxAttempts,
      baseDelayMs: scenario.retry.baseDelayMs,
      maxDelayMs: scenario.retry.maxDelayMs,
    },
    leaseMs: 2_000,
    processPaymentEvents: processFn,
    verifiers: createSignatureVerifierRegistry({
      syntheticSecret: SIMULATOR_SECRET,
      syntheticToleranceSeconds: 300,
    }),
    clock: fixedClock(instant(SIMULATOR_NOW)),
  });

  const deliveries = generateDeliveries(scenario);
  const reports: DeliveryReport[] = [];

  for (const delivery of deliveries) {
    const requestId = `sim-${scenario.id}-${delivery.stepIndex}`;
    const posted = await postDelivery(app, delivery, requestId);
    reports.push({
      stepIndex: delivery.stepIndex,
      eventType: delivery.eventType,
      paymentId: delivery.paymentId,
      httpStatus: posted.status,
      bodyStatus: String(posted.body["status"] ?? ""),
      code:
        typeof posted.body["code"] === "string" ? posted.body["code"] : undefined,
      note: noteFor(scenario, delivery, String(posted.body["status"] ?? "")),
    });
  }

  const now = instant(SIMULATOR_NOW);
  for (let tick = 0; tick < scenario.retry.ticksAfterDelivery; tick += 1) {
    const delay = scenario.retry.baseDelayMs * 2 ** tick;
    await runRetryTick(
      {
        retry: store.retry,
        events: store.repository,
        policy: {
          maxAttempts: scenario.retry.maxAttempts,
          baseDelayMs: scenario.retry.baseDelayMs,
          maxDelayMs: scenario.retry.maxDelayMs,
        },
        leaseMs: 2_000,
        processPaymentEvents: processFn,
        audit: store.audit,
        persistOutcome: store.persistOutcome,
        actor: "RETRY_WORKER",
        exceptions: store.exceptions,
      },
      addMilliseconds(now, delay),
    );
  }

  const provider = providerId(SIMULATOR_PROVIDER);
  const payments: PaymentReport[] = [];
  const eventIds = new Set<string>();
  const auditTypes: string[] = [];
  let delayedAuditCount = 0;
  let stateTransitionCount = 0;
  let originalAmountMinor: string | null = null;
  const exceptionCodes: string[] = [];
  let retryStatus: string | null = null;
  let retryAttemptCount = 0;
  let deadLettered = false;

  for (const payment of scenario.paymentIds) {
    const id = paymentId(payment);
    const record = await store.payments.get(provider, id);
    payments.push({
      paymentId: payment,
      state: record?.state ?? null,
    });
    const events = await store.repository.listByPayment(provider, id);
    for (const row of events) {
      eventIds.add(row.id);
      if (originalAmountMinor === null) {
        originalAmountMinor = row.event.amountMinor.toString();
      }
    }
    const listed = await store.exceptions.listByPayment(id);
    for (const item of listed) {
      exceptionCodes.push(item.exceptionCode);
    }
    const audit = await store.audit.listByPayment(id, provider);
    for (const item of audit) {
      auditTypes.push(item.eventType);
      if (item.eventType === "WEBHOOK_DELAYED") {
        delayedAuditCount += 1;
      }
      if (item.eventType === "PAYMENT_STATE_CHANGED") {
        stateTransitionCount += 1;
      }
    }
  }

  for (const webhookEventId of eventIds) {
    const retry = await store.retry.getByWebhookEventId(webhookEventId);
    if (retry !== null) {
      retryStatus = retry.status;
      retryAttemptCount = Math.max(retryAttemptCount, retry.attemptCount);
    }
    const dead = await store.retry.getDeadLetterByWebhookEventId(webhookEventId);
    if (dead !== null) {
      deadLettered = true;
    }
  }

  return {
    scenario,
    deliveries: reports,
    payments,
    storedEventCount: eventIds.size,
    stateTransitionCount,
    auditEventTypes: Object.freeze([...new Set(auditTypes)]),
    delayedAuditCount,
    retryStatus,
    retryAttemptCount,
    deadLettered,
    originalAmountMinor,
    exceptionCodes: Object.freeze([...new Set(exceptionCodes)]),
  };
}
