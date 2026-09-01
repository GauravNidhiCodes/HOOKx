import {
  lifecycleMessage,
  recordLifecycleMetric,
  type LifecycleEvent,
  type LogLevel,
  type Logger,
  type ProcessMetrics,
} from "@hookx/observability";

export type ObservabilitySink = {
  readonly logger?: Logger;
  readonly metrics?: ProcessMetrics;
};

export type LifecycleLogInput = {
  readonly level: LogLevel;
  readonly lifecycle: LifecycleEvent;
  readonly timestamp: string;
  readonly correlationId: string;
  readonly provider?: string | null;
  readonly eventId?: string | null;
  readonly paymentId?: string | null;
  readonly eventType?: string | null;
  readonly processingDecision?: string | null;
  readonly exceptionCode?: string | null;
  readonly attempt?: number;
  readonly storeOutcome?: string;
  readonly verification?: string;
  readonly replayId?: string;
  readonly previousState?: string | null;
  readonly resultingState?: string | null;
  readonly failureClass?: string;
  readonly trigger?: string;
  readonly eventsConsidered?: number;
  readonly message?: string;
};

export function emitLifecycle(
  sink: ObservabilitySink,
  entry: LifecycleLogInput,
): void {
  recordLifecycleMetric(sink.metrics, entry.lifecycle);
  sink.logger?.log(
    entry.level,
    entry.message ?? lifecycleMessage(entry.lifecycle),
    {
      timestamp: entry.timestamp,
      correlationId: entry.correlationId,
      provider: entry.provider,
      eventId: entry.eventId,
      paymentId: entry.paymentId,
      eventType: entry.eventType,
      processingDecision: entry.processingDecision,
      exceptionCode: entry.exceptionCode,
      lifecycle: entry.lifecycle,
      attempt: entry.attempt,
      storeOutcome: entry.storeOutcome,
      verification: entry.verification,
      replayId: entry.replayId,
      previousState: entry.previousState,
      resultingState: entry.resultingState,
      failureClass: entry.failureClass,
      trigger: entry.trigger,
      eventsConsidered: entry.eventsConsidered,
    },
  );
}
