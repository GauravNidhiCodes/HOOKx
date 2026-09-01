import type { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { providerId } from "@hookx/domain";
import type { ProcessPaymentEventsFn } from "@hookx/storage";
import {
  RAZORPAY_EVENT_ID_HEADER,
  RAZORPAY_PROVIDER_NAME,
  RAZORPAY_SIGNATURE_HEADER,
  razorpayPaymentAuthorizedPayload,
  signRazorpayWebhook,
} from "@hookx/webhook";
import type { ApiDependencies } from "../app.js";
import { FAILURE_LAB_SCENARIO } from "./catalog.js";
import { composeFailureLabReport } from "./compose.js";
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
    stepIndex: 0,
    eventType: "payment.authorized",
    eventKey: input.eventId,
    httpStatus: response.status,
    bodyStatus: String(body["status"] ?? ""),
    code: typeof body["code"] === "string" ? body["code"] : null,
    kind: "duplicate",
  };
}

/**
 * Failure Lab scenario that posts a SYNTHETIC Razorpay-shaped envelope through
 * POST /webhooks/razorpay (adapter + ingest). Payment ids stay lab-prefixed
 * so reset still purges them. Nothing is sent to Razorpay.
 */
export async function runRazorpayShapedDuplicate(
  dependencies: ApiDependencies,
  app: Hono,
  processFn: ProcessPaymentEventsFn,
  secret: string,
): Promise<FailureLabRunReport> {
  const runId = randomUUID();
  const startedAt = dependencies.clock.now();
  const paymentIdValue = `SYNTHETIC:pay:lab-${runId}`;
  const eventId = `evt_lab-${runId}-1`;
  const payload = razorpayPaymentAuthorizedPayload({ id: paymentIdValue });
  const rawBody = JSON.stringify(payload);
  const signature = signRazorpayWebhook({ secret, rawBody });
  const posted: FailureLabDeliveryResult[] = [];
  posted.push(
    await postRazorpayLab(app, {
      rawBody,
      eventId,
      signature,
      requestId: `lab-${runId}-0`,
    }),
  );
  posted.push({
    ...(await postRazorpayLab(app, {
      rawBody,
      eventId,
      signature,
      requestId: `lab-${runId}-1`,
    })),
    stepIndex: 1,
  });

  return composeFailureLabReport(dependencies, processFn, {
    scenarioId: FAILURE_LAB_SCENARIO.RAZORPAY_SHAPED_DUPLICATE,
    runId,
    startedAt,
    posted,
    provider: providerId(RAZORPAY_PROVIDER_NAME),
    paymentIdValue,
    eventTimeOrder: ["payment.authorized"],
    labels: ["SYNTHETIC", "RAZORPAY ADAPTER"],
  });
}
