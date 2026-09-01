import type { LifecycleEvent } from "./lifecycle.js";

export const RUNTIME_METRIC_NAMES = [
  "webhooksReceived",
  "webhooksRejected",
  "duplicates",
  "conflicts",
  "processingFailures",
  "retryAttempts",
  "deadLetterEvents",
] as const;

export type RuntimeMetricName = (typeof RUNTIME_METRIC_NAMES)[number];

export type RuntimeMetricSnapshot = {
  readonly source: "process";
  readonly note: "Counts since this API process started. Not historical persisted activity.";
  readonly counts: Readonly<Record<RuntimeMetricName, number>>;
};

export type ProcessMetrics = {
  increment(name: RuntimeMetricName): void;
  snapshot(): RuntimeMetricSnapshot;
};

export function createProcessMetrics(): ProcessMetrics {
  const counts: Record<RuntimeMetricName, number> = {
    webhooksReceived: 0,
    webhooksRejected: 0,
    duplicates: 0,
    conflicts: 0,
    processingFailures: 0,
    retryAttempts: 0,
    deadLetterEvents: 0,
  };

  return {
    increment(name) {
      counts[name] += 1;
    },
    snapshot() {
      return {
        source: "process",
        note: "Counts since this API process started. Not historical persisted activity.",
        counts: { ...counts },
      };
    },
  };
}

export function recordLifecycleMetric(
  metrics: ProcessMetrics | undefined,
  lifecycle: LifecycleEvent,
): void {
  if (metrics === undefined) {
    return;
  }
  if (lifecycle === "WEBHOOK_RECEIVED") {
    metrics.increment("webhooksReceived");
    return;
  }
  if (lifecycle === "SIGNATURE_REJECTED") {
    metrics.increment("webhooksRejected");
    return;
  }
  if (lifecycle === "DUPLICATE_DETECTED") {
    metrics.increment("duplicates");
    return;
  }
  if (lifecycle === "CONFLICT_DETECTED") {
    metrics.increment("conflicts");
    return;
  }
  if (lifecycle === "PROCESSING_FAILED") {
    metrics.increment("processingFailures");
    return;
  }
  if (lifecycle === "RETRY_ATTEMPTED") {
    metrics.increment("retryAttempts");
    return;
  }
  if (lifecycle === "RETRY_EXHAUSTED") {
    metrics.increment("deadLetterEvents");
  }
}
