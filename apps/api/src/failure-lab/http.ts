import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Hono } from "hono";
import type {
  FailureLabPurgeResult,
  ProcessPaymentEventsFn,
} from "@hookx/storage";
import type { ApiDependencies } from "../app.js";
import {
  FAILURE_LAB_CATALOG,
  FAILURE_LAB_NOTICE,
  isFailureLabScenarioId,
} from "./catalog.js";
import { failureModeForLab } from "./bind.js";
import { createLabProcessFn } from "./injection.js";
import { runFailureLabScenario } from "./run.js";
import type { FailureLabRunReport } from "./report.js";

export const FAILURE_LAB_RESET_CONFIRM = "SYNTHETIC_FAILURE_LAB";

export type FailureLabRouteDependencies = ApiDependencies & {
  readonly syntheticWebhookSecret?: string;
  readonly purgeFailureLab?: () => Promise<FailureLabPurgeResult>;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function badRequest(context: Context, code: string): Response {
  return context.json(
    { status: "bad_request", code },
    400 as ContentfulStatusCode,
  );
}

function unavailable(context: Context, code: string): Response {
  return context.json(
    { status: "unavailable", code },
    503 as ContentfulStatusCode,
  );
}

export function handleFailureLabCatalog(context: Context): Response {
  return context.json({
    notice: FAILURE_LAB_NOTICE,
    synthetic: true,
    scenarios: FAILURE_LAB_CATALOG,
  });
}

export async function handleFailureLabRun(
  context: Context,
  dependencies: FailureLabRouteDependencies,
  runs: Map<string, FailureLabRunReport>,
  createLabApp: (processFn: ProcessPaymentEventsFn) => Hono,
): Promise<Response> {
  if (
    dependencies.syntheticWebhookSecret === undefined ||
    dependencies.syntheticWebhookSecret.length === 0
  ) {
    return unavailable(context, "FAILURE_LAB_SECRET_UNAVAILABLE");
  }
  let body: unknown;
  try {
    body = await context.req.json();
  } catch {
    return badRequest(context, "INVALID_JSON");
  }
  if (typeof body !== "object" || body === null || !("scenario" in body)) {
    return badRequest(context, "MISSING_SCENARIO");
  }
  const scenario = (body as { scenario: unknown }).scenario;
  if (typeof scenario !== "string" || !isFailureLabScenarioId(scenario)) {
    return badRequest(context, "UNKNOWN_FAILURE_LAB_SCENARIO");
  }
  if (
    scenario === "RAZORPAY_SHAPED_DUPLICATE" &&
    (dependencies.razorpayWebhookSecret === undefined ||
      dependencies.razorpayWebhookSecret.length === 0)
  ) {
    return unavailable(context, "RAZORPAY_WEBHOOK_SECRET_UNAVAILABLE");
  }
  const processFn = createLabProcessFn(failureModeForLab(scenario));
  const labApp = createLabApp(processFn);
  const report = await runFailureLabScenario(
    dependencies,
    labApp,
    processFn,
    scenario,
    dependencies.syntheticWebhookSecret,
  );
  runs.set(report.runId, report);
  return context.json({ run: report });
}

export function handleFailureLabGetRun(
  context: Context,
  runs: Map<string, FailureLabRunReport>,
): Response {
  const id = context.req.param("id") ?? "";
  if (!UUID.test(id)) {
    return badRequest(context, "INVALID_RUN_ID");
  }
  const report = runs.get(id);
  if (report === undefined) {
    return context.json(
      { status: "not_found", code: "FAILURE_LAB_RUN_NOT_FOUND" },
      404 as ContentfulStatusCode,
    );
  }
  return context.json({ run: report });
}

export async function handleFailureLabReset(
  context: Context,
  dependencies: FailureLabRouteDependencies,
  runs: Map<string, FailureLabRunReport>,
): Promise<Response> {
  if (dependencies.purgeFailureLab === undefined) {
    return unavailable(context, "FAILURE_LAB_RESET_UNAVAILABLE");
  }
  let body: unknown;
  try {
    body = await context.req.json();
  } catch {
    return badRequest(context, "INVALID_JSON");
  }
  const confirm =
    typeof body === "object" && body !== null && "confirm" in body
      ? (body as { confirm: unknown }).confirm
      : undefined;
  if (confirm !== FAILURE_LAB_RESET_CONFIRM) {
    return badRequest(context, "RESET_CONFIRMATION_REQUIRED");
  }
  const deleted = await dependencies.purgeFailureLab();
  runs.clear();
  return context.json({
    notice: FAILURE_LAB_NOTICE,
    deleted,
  });
}
