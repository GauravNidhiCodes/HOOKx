import type { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { paymentId, providerId } from "@hookx/domain";
import {
  generateDeliveries,
  SIMULATOR_PROVIDER,
  type SignedDelivery,
} from "@hookx/simulator";
import {
  DEFAULT_RETRY_POLICY,
  type ProcessPaymentEventsFn,
} from "@hookx/storage";
import { SYNTHETIC_SIGNATURE_HEADER } from "@hookx/webhook";
import type { ApiDependencies } from "../app.js";
import { bindScenarioToLabRun, simulatorScenarioForLab } from "./bind.js";
import {
  FAILURE_LAB_SCENARIO,
  type FailureLabScenarioId,
} from "./catalog.js";
import { composeFailureLabReport, drainLabRetries } from "./compose.js";
import { runRazorpayShapedDuplicate } from "./razorpay-path.js";
import type {
  FailureLabDeliveryResult,
  FailureLabRunReport,
} from "./report.js";

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

export async function runFailureLabScenario(
  dependencies: ApiDependencies,
  app: Hono,
  processFn: ProcessPaymentEventsFn,
  scenarioId: FailureLabScenarioId,
  secret: string,
): Promise<FailureLabRunReport> {
  if (scenarioId === FAILURE_LAB_SCENARIO.RAZORPAY_SHAPED_DUPLICATE) {
    const razorpaySecret = dependencies.razorpayWebhookSecret;
    if (razorpaySecret === undefined || razorpaySecret.length === 0) {
      throw new Error("RAZORPAY_WEBHOOK_SECRET_UNAVAILABLE");
    }
    return runRazorpayShapedDuplicate(
      dependencies,
      app,
      processFn,
      razorpaySecret,
    );
  }

  const runId = randomUUID();
  const startedAt = dependencies.clock.now();
  const base = simulatorScenarioForLab(scenarioId);
  const bound = bindScenarioToLabRun(base, runId);
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

  for (const delivery of deliveries.slice(0, replaySplit)) {
    posted.push(
      await postDelivery(app, delivery, `lab-${runId}-${delivery.stepIndex}`),
    );
  }

  let beforeState: string | null = null;
  if (scenarioId === "REPLAY_RECOVERY" && dependencies.payments !== undefined) {
    beforeState =
      (await dependencies.payments.get(provider, paymentId(primaryPayment)))
        ?.state ?? null;
  }

  for (const delivery of deliveries.slice(replaySplit)) {
    posted.push(
      await postDelivery(app, delivery, `lab-${runId}-${delivery.stepIndex}`),
    );
  }

  if (scenarioId === FAILURE_LAB_SCENARIO.GOLDEN_DEMO) {
    const original = deliveries[0];
    if (original === undefined) {
      throw new Error("Golden Demo has no signed delivery");
    }
    const storedForRetry = await dependencies.repository.listByPayment(
      provider,
      paymentId(primaryPayment),
    );
    await drainLabRetries(
      dependencies,
      processFn,
      dependencies.retryPolicy ?? DEFAULT_RETRY_POLICY,
      storedForRetry.map((row) => row.id),
    );
    posted.push(
      await postDelivery(app, original, `demo-${runId}-redelivery`),
    );
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

  const demoRun =
    scenarioId === "TRANSIENT_FAILURE" ||
    scenarioId === FAILURE_LAB_SCENARIO.GOLDEN_DEMO;
  return composeFailureLabReport(dependencies, processFn, {
    scenarioId,
    runId,
    startedAt,
    posted,
    provider,
    paymentIdValue: primaryPayment,
    eventTimeOrder,
    labels: demoRun ? ["SYNTHETIC", "DEMO RUN"] : ["SYNTHETIC"],
    beforeState,
    correlationId:
      scenarioId === FAILURE_LAB_SCENARIO.GOLDEN_DEMO
        ? `demo-${runId}`
        : undefined,
  });
}
