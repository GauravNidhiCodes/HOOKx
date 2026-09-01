import type { FailureLabRunReport } from "../api/types";

export const DEMO_STEP_IDS = [
  "RECEIVE",
  "VERIFY",
  "PROCESS",
  "FAIL",
  "RETRY",
  "RECOVER",
  "AUDIT",
  "INVESTIGATE",
] as const;

export type DemoStepId = (typeof DEMO_STEP_IDS)[number];

export type DemoStep = {
  readonly number: string;
  readonly id: DemoStepId;
  readonly complete: boolean;
};

function hasLifecycle(
  report: FailureLabRunReport,
  name: string,
): boolean {
  return report.log.some((entry) => entry.lifecycle === name);
}

export function webhookRecovered(report: FailureLabRunReport): boolean {
  if (report.retry?.status === "DEAD_LETTERED" || report.deadLetter !== null) {
    return false;
  }
  return (
    report.retry?.status === "SUCCEEDED" &&
    (report.eventProcessingStatus === "PROCESSED" ||
      report.eventProcessingStatus === undefined)
  );
}

export function retryExhausted(report: FailureLabRunReport): boolean {
  return (
    report.retry?.status === "DEAD_LETTERED" ||
    report.deadLetter !== null ||
    report.exception?.exceptionCode === "RETRY_EXHAUSTED"
  );
}

export function unexpectedDemoOutcome(report: FailureLabRunReport): boolean {
  if (report.failureMode === "FAIL_ONCE" && report.result.error < 1) {
    return true;
  }
  return false;
}

export function deriveDemoSteps(
  report: FailureLabRunReport | null,
  investigated: boolean,
): readonly DemoStep[] {
  const complete = (id: DemoStepId): boolean => {
    if (report === null) {
      return false;
    }
    switch (id) {
      case "RECEIVE":
        return hasLifecycle(report, "WEBHOOK_RECEIVED") || report.deliveries.length > 0;
      case "VERIFY":
        return hasLifecycle(report, "SIGNATURE_VERIFIED");
      case "PROCESS":
        return (
          hasLifecycle(report, "PROCESSING_STARTED") ||
          hasLifecycle(report, "EVENT_PERSISTED")
        );
      case "FAIL":
        return (
          report.result.error >= 1 ||
          report.exception?.exceptionCode === "PROCESSING_FAILURE" ||
          (report.retry !== null && report.retry.lastErrorCode !== null)
        );
      case "RETRY":
        return hasLifecycle(report, "RETRY_SCHEDULED") || report.retry !== null;
      case "RECOVER":
        return webhookRecovered(report);
      case "AUDIT":
        return report.auditCount > 0;
      case "INVESTIGATE":
        return investigated;
      default:
        return false;
    }
  };

  return DEMO_STEP_IDS.map((id, index) => ({
    number: String(index + 1).padStart(2, "0"),
    id,
    complete: complete(id),
  }));
}

export function failureClassification(
  report: FailureLabRunReport,
): {
  readonly heading: string;
  readonly code: string;
  readonly failureClass: string | null;
} | null {
  if (report.result.error < 1 && report.exception === null && report.retry === null) {
    return null;
  }
  const code =
    report.deliveries.find((row) => row.bodyStatus === "error")?.code ??
    report.retry?.lastErrorCode ??
    report.exception?.exceptionCode ??
    null;
  if (code === null) {
    return null;
  }
  return {
    heading: "PROCESSING FAILED",
    code,
    failureClass: report.retry?.failureClass ?? null,
  };
}
