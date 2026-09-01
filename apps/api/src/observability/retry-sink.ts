import type { RetryLifecycleSink } from "@hookx/storage";
import { emitLifecycle, type ObservabilitySink } from "./emit.js";

export type RetryLogContext = {
  readonly correlationId: string;
  readonly provider: string;
  readonly paymentId?: string;
  readonly eventType?: string;
};

export function observabilityRetrySink(
  inner: RetryLifecycleSink | undefined,
  sink: ObservabilitySink,
  context: RetryLogContext,
): RetryLifecycleSink {
  return {
    record(transition) {
      inner?.record(transition);
      if (transition.newStatus === "PROCESSING" && transition.attempt > 1) {
        emitLifecycle(sink, {
          level: "INFO",
          lifecycle: "RETRY_ATTEMPTED",
          timestamp: transition.timestamp,
          correlationId: context.correlationId,
          provider: context.provider,
          paymentId: context.paymentId,
          eventId: transition.webhookEventId,
          eventType: context.eventType,
          attempt: transition.attempt,
          processingDecision: transition.reason,
        });
        return;
      }
      if (transition.newStatus === "RETRY_SCHEDULED") {
        emitLifecycle(sink, {
          level: "WARN",
          lifecycle: "RETRY_SCHEDULED",
          timestamp: transition.timestamp,
          correlationId: context.correlationId,
          provider: context.provider,
          paymentId: context.paymentId,
          eventId: transition.webhookEventId,
          eventType: context.eventType,
          attempt: transition.attempt,
          processingDecision: transition.reason,
          failureClass: "RETRYABLE",
        });
        return;
      }
      if (transition.newStatus === "SUCCEEDED" && transition.attempt > 1) {
        emitLifecycle(sink, {
          level: "INFO",
          lifecycle: "RETRY_SUCCEEDED",
          timestamp: transition.timestamp,
          correlationId: context.correlationId,
          provider: context.provider,
          paymentId: context.paymentId,
          eventId: transition.webhookEventId,
          eventType: context.eventType,
          attempt: transition.attempt,
          processingDecision: transition.reason,
        });
        return;
      }
      if (transition.newStatus === "DEAD_LETTERED") {
        emitLifecycle(sink, {
          level: "ERROR",
          lifecycle: "RETRY_EXHAUSTED",
          timestamp: transition.timestamp,
          correlationId: context.correlationId,
          provider: context.provider,
          paymentId: context.paymentId,
          eventId: transition.webhookEventId,
          eventType: context.eventType,
          attempt: transition.attempt,
          processingDecision: transition.reason,
        });
      }
    },
  };
}
