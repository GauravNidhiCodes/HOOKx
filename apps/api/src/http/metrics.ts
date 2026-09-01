import type { Context } from "hono";
import type { Clock } from "../clock.js";
import type { ProcessMetrics } from "@hookx/observability";
import type {
  AuditRepository,
  ExceptionRepository,
  RetryRepository,
  WebhookEventRepository,
} from "@hookx/storage";

export type MetricsRouteDependencies = {
  readonly clock: Clock;
  readonly repository: WebhookEventRepository;
  readonly retry: RetryRepository;
  readonly audit: AuditRepository;
  readonly exceptions?: ExceptionRepository;
  readonly metrics?: ProcessMetrics;
};

export async function handleMetricsSummary(
  context: Context,
  dependencies: MetricsRouteDependencies,
): Promise<Response> {
  const persisted: {
    source: "database";
    webhookEvents: number;
    exceptions?: number;
    retries: number;
    deadLetters: number;
    auditByType: Readonly<Record<string, number>>;
  } = {
    source: "database",
    webhookEvents: await dependencies.repository.count(),
    retries: await dependencies.retry.count(),
    deadLetters: await dependencies.retry.countDeadLetters(),
    auditByType: await dependencies.audit.countByEventType(),
  };
  if (dependencies.exceptions !== undefined) {
    persisted.exceptions = await dependencies.exceptions.count();
  }
  return context.json({
    asOf: dependencies.clock.now(),
    persisted,
    ...(dependencies.metrics === undefined
      ? {}
      : { runtime: dependencies.metrics.snapshot() }),
  });
}
