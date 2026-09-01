import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Hono } from "hono";
import type { ProcessPaymentEventsFn } from "@hookx/storage";
import {
  GOLDEN_DEMO_NOTICE,
  GOLDEN_DEMO_SCENARIO,
} from "../failure-lab/catalog.js";
import { failureModeForLab } from "../failure-lab/bind.js";
import { createLabProcessFn } from "../failure-lab/injection.js";
import { runFailureLabScenario } from "../failure-lab/run.js";
import type { FailureLabRunReport } from "../failure-lab/report.js";
import type { FailureLabRouteDependencies } from "../failure-lab/http.js";
import { retainLabRuns } from "../failure-lab/run-retention.js";

export const GOLDEN_DEMO_EXPLANATION =
  "Observe how HOOKX handles a webhook failure without allowing the financial state to become inconsistent.";

export type GoldenDemoInvariant = {
  readonly storedEventCount: number;
  readonly stateChange: number;
  readonly duplicateDeliveries: number;
  readonly noDuplicateEconomicEffect: boolean;
};

export type GoldenDemoRun = {
  readonly demoRunId: string;
  readonly correlationId: string;
  readonly synthetic: true;
  readonly notice: string;
  readonly invariant: GoldenDemoInvariant;
  readonly run: FailureLabRunReport;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const HISTORY_LIMIT = 10;

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

function wrap(report: FailureLabRunReport): GoldenDemoRun {
  const storedEventCount = report.storedEventCount;
  const duplicateDeliveries = report.result.duplicate;
  const noDuplicateEconomicEffect =
    storedEventCount === 1 && report.stateChange === 0;
  return {
    demoRunId: report.runId,
    correlationId: report.correlationId ?? `demo-${report.runId}`,
    synthetic: true,
    notice: GOLDEN_DEMO_NOTICE,
    invariant: {
      storedEventCount,
      stateChange: report.stateChange,
      duplicateDeliveries,
      noDuplicateEconomicEffect,
    },
    run: report,
  };
}

function isGolden(report: FailureLabRunReport): boolean {
  return report.scenario === GOLDEN_DEMO_SCENARIO;
}

export function handleDemoDescribe(context: Context): Response {
  return context.json({
    product: "HOOKX",
    fullName: "HOOKX — Payment Webhook Reliability Engine",
    kind: "SYNTHETIC DEMONSTRATION",
    explanation: GOLDEN_DEMO_EXPLANATION,
    synthetic: true,
    notice: GOLDEN_DEMO_NOTICE,
    scenario: GOLDEN_DEMO_SCENARIO,
    route: "/demo",
    run: "/demo/run",
  });
}

export async function handleDemoRun(
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
  if (
    dependencies.razorpayWebhookSecret === undefined ||
    dependencies.razorpayWebhookSecret.length === 0
  ) {
    return unavailable(context, "RAZORPAY_WEBHOOK_SECRET_UNAVAILABLE");
  }
  const processFn = createLabProcessFn(failureModeForLab(GOLDEN_DEMO_SCENARIO));
  const labApp = createLabApp(processFn);
  let report: FailureLabRunReport;
  try {
    report = await runFailureLabScenario(
      dependencies,
      labApp,
      processFn,
      GOLDEN_DEMO_SCENARIO,
      dependencies.syntheticWebhookSecret,
    );
  } catch (error) {
    const code =
      error instanceof Error && error.message === "RAZORPAY_WEBHOOK_SECRET_UNAVAILABLE"
        ? "RAZORPAY_WEBHOOK_SECRET_UNAVAILABLE"
        : "DEMO_FAILED";
    if (code === "RAZORPAY_WEBHOOK_SECRET_UNAVAILABLE") {
      return unavailable(context, code);
    }
    return context.json(
      {
        status: "error",
        code,
        synthetic: true,
      },
      500 as ContentfulStatusCode,
    );
  }
  runs.set(report.runId, report);
  retainLabRuns(runs);
  return context.json({ demo: wrap(report) });
}

export function handleDemoList(
  context: Context,
  runs: Map<string, FailureLabRunReport>,
): Response {
  const demos = [...runs.values()]
    .filter(isGolden)
    .slice(-HISTORY_LIMIT)
    .reverse()
    .map(wrap);
  return context.json({
    synthetic: true,
    notice: GOLDEN_DEMO_NOTICE,
    runs: demos,
  });
}

export function handleDemoGet(
  context: Context,
  runs: Map<string, FailureLabRunReport>,
): Response {
  const id = context.req.param("id") ?? "";
  if (!UUID.test(id)) {
    return badRequest(context, "INVALID_DEMO_RUN_ID");
  }
  const report = runs.get(id);
  if (report === undefined || !isGolden(report)) {
    return context.json(
      { status: "not_found", code: "DEMO_RUN_NOT_FOUND" },
      404 as ContentfulStatusCode,
    );
  }
  return context.json({ demo: wrap(report) });
}
