import type { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { paymentId, providerId } from "@hookx/domain";
import {
  DEFAULT_RETRY_POLICY,
  type ProcessPaymentEventsFn,
} from "@hookx/storage";
import {
  RAZORPAY_EVENT_ID_HEADER,
  RAZORPAY_PROVIDER_NAME,
  RAZORPAY_SIGNATURE_HEADER,
  razorpayPaymentAuthorizedPayload,
  signRazorpayWebhook,
} from "@hookx/webhook";
import type { ApiDependencies } from "../app.js";
import {
  FAILURE_LAB_SCENARIO,
  type FailureLabScenarioId,
} from "./catalog.js";
import { composeFailureLabReport, drainLabRetries } from "./compose.js";
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

async function postRazorpayLab(
  app: Hono,
  input: {
    readonly rawBody: string;
    readonly eventId: string;
    readonly signature: string;
    readonly requestId: string;
    readonly stepIndex: number;
    readonly kind: string;
  },
): Promise<FailureLabDeliveryResult> {
  const response = await app.request("/webhooks/razorpay", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": input.requestId,
      [RAZORPAY_SIGNATURE_HEADER]: input.signature,
      [RAZORPAY_EVENT_ID_HEADER]: input.eventId,
    },
    body: input.rawBody,
  });
  const body = readJson(await response.json());
  return {
    stepIndex: input.stepIndex,
    eventType: "payment.authorized",
    eventKey: input.eventId,
    httpStatus: response.status,
    bodyStatus: String(body["status"] ?? ""),
    code: typeof body["code"] === "string" ? body["code"] : null,
    kind: input.kind,
  };
}

export type RazorpayLabPathOptions = {
  readonly scenarioId: FailureLabScenarioId;
  readonly labels: readonly string[];
  readonly correlationId: string;
  readonly redeliverImmediately: boolean;
  readonly redeliverAfterDrain: boolean;
};

/**
 * Posts a SYNTHETIC Razorpay-shaped envelope through POST /webhooks/razorpay
 * (adapter + ingest). Payment ids stay lab-prefixed so reset still purges them.
 * Nothing is sent to Razorpay.
 */
export async function runRazorpayShapedLab(
  dependencies: ApiDependencies,
  app: Hono,
  processFn: ProcessPaymentEventsFn,
  secret: string,
  options: RazorpayLabPathOptions,
): Promise<FailureLabRunReport> {
  const runId = randomUUID();
  const startedAt = dependencies.clock.now();
  const paymentIdValue = `SYNTHETIC:pay:lab-${runId}`;
  const eventId = `SYNTHETIC:evt:lab-${runId}-1`;
  const correlationId = options.correlationId.replaceAll("{runId}", runId);
  const provider = providerId(RAZORPAY_PROVIDER_NAME);
  const payload = razorpayPaymentAuthorizedPayload({ id: paymentIdValue });
  const rawBody = JSON.stringify(payload);
  const signature = signRazorpayWebhook({ secret, rawBody });
  const posted: FailureLabDeliveryResult[] = [];

  posted.push(
    await postRazorpayLab(app, {
      rawBody,
      eventId,
      signature,
      requestId: correlationId,
      stepIndex: 0,
      kind: "original",
    }),
  );

  if (options.redeliverAfterDrain) {
    const stored = await dependencies.repository.listByPayment(
      provider,
      paymentId(paymentIdValue),
    );
    const policy = dependencies.retryPolicy ?? DEFAULT_RETRY_POLICY;
    await drainLabRetries(
      dependencies,
      processFn,
      policy,
      stored.map((row) => row.id),
    );
  }

  if (options.redeliverImmediately || options.redeliverAfterDrain) {
    posted.push(
      await postRazorpayLab(app, {
        rawBody,
        eventId,
        signature,
        requestId: `${correlationId}-redelivery`,
        stepIndex: 1,
        kind: "redelivery",
      }),
    );
  }

  return composeFailureLabReport(dependencies, processFn, {
    scenarioId: options.scenarioId,
    runId,
    startedAt,
    posted,
    provider,
    paymentIdValue,
    eventTimeOrder: ["payment.authorized"],
    labels: [...options.labels],
    correlationId,
  });
}

export async function runRazorpayShapedDuplicate(
  dependencies: ApiDependencies,
  app: Hono,
  processFn: ProcessPaymentEventsFn,
  secret: string,
): Promise<FailureLabRunReport> {
  return runRazorpayShapedLab(dependencies, app, processFn, secret, {
    scenarioId: FAILURE_LAB_SCENARIO.RAZORPAY_SHAPED_DUPLICATE,
    labels: ["SYNTHETIC", "RAZORPAY ADAPTER"],
    correlationId: "lab-{runId}",
    redeliverImmediately: true,
    redeliverAfterDrain: false,
  });
}

export async function runGoldenDemo(
  dependencies: ApiDependencies,
  app: Hono,
  processFn: ProcessPaymentEventsFn,
  secret: string,
): Promise<FailureLabRunReport> {
  return runRazorpayShapedLab(dependencies, app, processFn, secret, {
    scenarioId: FAILURE_LAB_SCENARIO.GOLDEN_DEMO,
    labels: ["SYNTHETIC", "RAZORPAY ADAPTER", "DEMO RUN"],
    correlationId: "demo-{runId}",
    redeliverImmediately: false,
    redeliverAfterDrain: true,
  });
}
