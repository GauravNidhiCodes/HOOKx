import type { PublicIncident } from "./incident.js";
import {
  clampTimelineLimit,
  clampTimelineOffset,
} from "./limits.js";
import type { LifecycleEvent } from "./lifecycle.js";
import { isSyntheticOrigin } from "./synthetic.js";

export type TimelineSource =
  | "AUDIT"
  | "WEBHOOK"
  | "RETRY"
  | "EXCEPTION"
  | "INVESTIGATION";

export type TimelineRetryDetail = {
  readonly attempt: number | null;
  readonly scheduledAt: string | null;
  readonly attemptedAt: string | null;
  readonly result: string | null;
  readonly failureClass: string | null;
};

export type TimelineReplayDetail = {
  readonly replayId: string;
  readonly trigger: string;
  readonly eventsConsidered: number;
  readonly previousState: string | null;
  readonly resultingState: string | null;
};

export type IncidentTimelineItem = {
  readonly seq: number;
  readonly clock: string;
  readonly eventTime: string | null;
  readonly receivedTime: string | null;
  readonly processedTime: string | null;
  readonly lifecycle: LifecycleEvent;
  readonly decision: string | null;
  readonly reason: string | null;
  readonly correlationId: string;
  readonly provider: string | null;
  readonly paymentId: string | null;
  readonly eventId: string | null;
  readonly exceptionId: string | null;
  readonly exceptionCode: string | null;
  readonly previousState: string | null;
  readonly resultingState: string | null;
  readonly source: TimelineSource;
  readonly sourceId: string;
  readonly inferred: boolean;
  readonly synthetic: boolean;
  readonly retry: TimelineRetryDetail | null;
  readonly replay: TimelineReplayDetail | null;
};

export type TimelineException = {
  readonly exceptionId: string;
  readonly exceptionCode: string;
  readonly severity: string;
  readonly status: string;
  readonly paymentId: string | null;
  readonly webhookEventId: string | null;
  readonly provider: string | null;
  readonly reason: string;
  readonly detectedAt: string;
  readonly correlationId: string;
};

export type TimelineAudit = {
  readonly auditEventId: string;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly provider: string | null;
  readonly paymentId: string | null;
  readonly webhookEventId: string | null;
  readonly previousState: string | null;
  readonly resultingState: string | null;
  readonly reason: string;
  readonly correlationId: string;
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
};

export type TimelineWebhook = {
  readonly webhookEventId: string;
  readonly occurredAt: string;
  readonly receivedAt: string;
  readonly eventType: string;
  readonly provider: string;
  readonly paymentId: string;
};

export type TimelineRetry = {
  readonly webhookEventId: string;
  readonly attemptCount: number;
  readonly status: string;
  readonly nextAttemptAt: string | null;
  readonly lastErrorCode: string | null;
  readonly lastFailedAt: string | null;
};

export type TimelineDeadLetter = {
  readonly webhookEventId: string;
  readonly failureCode: string;
  readonly attemptCount: number;
  readonly deadLetteredAt: string;
};

export type TimelineInvestigation = {
  readonly investigationId: string;
  readonly createdAt: string;
  readonly correlationId: string;
};

export type ComposeIncidentTimelineInput = {
  readonly exception: TimelineException;
  readonly audit: readonly TimelineAudit[];
  readonly webhooks: readonly TimelineWebhook[];
  readonly retry: TimelineRetry | null;
  readonly deadLetter: TimelineDeadLetter | null;
  readonly investigation: TimelineInvestigation | null;
  readonly liveProviders?: readonly string[];
  readonly classifyFailure?: (code: string) => string;
  readonly offset?: number;
  readonly limit?: number;
};

export type ComposedIncidentTimeline = {
  readonly incident: PublicIncident;
  readonly items: readonly IncidentTimelineItem[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
};

const SIGNATURE_REJECT_REASONS = new Set([
  "INVALID_SIGNATURE",
  "MISSING_SIGNATURE",
  "MALFORMED_SIGNATURE",
  "EXPIRED_SIGNATURE",
]);

type DraftItem = Omit<IncidentTimelineItem, "seq"> & {
  readonly orderKey: number;
};

function webhookById(
  webhooks: readonly TimelineWebhook[],
): ReadonlyMap<string, TimelineWebhook> {
  return new Map(webhooks.map((row) => [row.webhookEventId, row]));
}

function metadataAttempt(
  metadata: Readonly<Record<string, string | number | boolean | null>>,
): number | null {
  const value = metadata["attempt"];
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  return null;
}

function metadataExceptionId(
  metadata: Readonly<Record<string, string | number | boolean | null>>,
): string | null {
  const value = metadata["exceptionId"];
  return typeof value === "string" ? value : null;
}

function metadataExceptionCode(
  metadata: Readonly<Record<string, string | number | boolean | null>>,
): string | null {
  const value = metadata["exceptionCode"];
  return typeof value === "string" ? value : null;
}

function compareDraft(left: DraftItem, right: DraftItem): number {
  if (left.clock < right.clock) {
    return -1;
  }
  if (left.clock > right.clock) {
    return 1;
  }
  if (left.orderKey < right.orderKey) {
    return -1;
  }
  if (left.orderKey > right.orderKey) {
    return 1;
  }
  return left.lifecycle < right.lifecycle
    ? -1
    : left.lifecycle > right.lifecycle
      ? 1
      : 0;
}

export function composeIncidentTimeline(
  input: ComposeIncidentTimelineInput,
): ComposedIncidentTimeline {
  const liveProviders = input.liveProviders ?? [];
  const synthetic = isSyntheticOrigin(
    input.exception.provider,
    input.exception.paymentId,
    liveProviders,
  );
  const incident: PublicIncident = {
    incidentId: input.exception.exceptionId,
    exceptionId: input.exception.exceptionId,
    exceptionCode: input.exception.exceptionCode,
    severity: input.exception.severity,
    status: input.exception.status,
    paymentId: input.exception.paymentId,
    eventId: input.exception.webhookEventId,
    correlationId: input.exception.correlationId,
    provider: input.exception.provider,
    detectedAt: input.exception.detectedAt,
    reason: input.exception.reason,
    synthetic,
  };

  const byWebhook = webhookById(input.webhooks);
  const delayedSeen = new Set<string>();
  const drafts: DraftItem[] = [];
  let order = 0;

  for (const event of input.audit) {
    const linked =
      event.webhookEventId === null
        ? undefined
        : byWebhook.get(event.webhookEventId);
    const eventTime = linked?.occurredAt ?? event.occurredAt;
    const receivedTime = linked?.receivedAt ?? null;
    const base = {
      clock: event.recordedAt,
      eventTime,
      receivedTime,
      processedTime: null as string | null,
      decision: event.reason,
      reason: event.reason,
      correlationId: event.correlationId,
      provider: event.provider,
      paymentId: event.paymentId,
      eventId: event.webhookEventId,
      exceptionId: metadataExceptionId(event.metadata),
      exceptionCode: metadataExceptionCode(event.metadata),
      previousState: event.previousState,
      resultingState: event.resultingState,
      source: "AUDIT" as const,
      sourceId: event.auditEventId,
      inferred: false,
      synthetic,
      retry: null as TimelineRetryDetail | null,
      replay: null as TimelineReplayDetail | null,
    };

    const expansions = expandAudit(event, delayedSeen, input.webhooks.length, {
      retry: input.retry,
      deadLetter: input.deadLetter,
      classifyFailure: input.classifyFailure,
    });
    for (const expansion of expansions) {
      drafts.push({
        ...base,
        ...expansion,
        clock: event.recordedAt,
        orderKey: order,
        synthetic,
      });
      order += 1;
    }
    if (event.eventType === "WEBHOOK_DELAYED" && event.webhookEventId !== null) {
      delayedSeen.add(event.webhookEventId);
    }
  }

  if (input.investigation !== null) {
    drafts.push({
      clock: input.investigation.createdAt,
      eventTime: null,
      receivedTime: null,
      processedTime: input.investigation.createdAt,
      lifecycle: "INVESTIGATION_AVAILABLE",
      decision: null,
      reason: null,
      correlationId: input.investigation.correlationId,
      provider: input.exception.provider,
      paymentId: input.exception.paymentId,
      eventId: input.exception.webhookEventId,
      exceptionId: input.exception.exceptionId,
      exceptionCode: input.exception.exceptionCode,
      previousState: null,
      resultingState: null,
      source: "INVESTIGATION",
      sourceId: input.investigation.investigationId,
      inferred: false,
      synthetic,
      retry: null,
      replay: null,
      orderKey: order,
    });
  }

  drafts.sort(compareDraft);
  const numbered: IncidentTimelineItem[] = drafts.map((draft, index) => {
    const { orderKey: _orderKey, ...rest } = draft;
    return { ...rest, seq: index };
  });

  const offset = clampTimelineOffset(input.offset);
  const limit = clampTimelineLimit(input.limit);
  return {
    incident,
    items: numbered.slice(offset, offset + limit),
    total: numbered.length,
    offset,
    limit,
  };
}

function expandAudit(
  event: TimelineAudit,
  delayed: ReadonlySet<string>,
  eventsConsidered: number,
  retryContext: {
    readonly retry: TimelineRetry | null;
    readonly deadLetter: TimelineDeadLetter | null;
    readonly classifyFailure?: (code: string) => string;
  },
): readonly (Partial<DraftItem> & { readonly lifecycle: LifecycleEvent })[] {
  const retry = retryDetail(event, retryContext);
  const replay = replayDetail(event, delayed, eventsConsidered);

  if (event.eventType === "WEBHOOK_RECEIVED") {
    return [
      { lifecycle: "WEBHOOK_RECEIVED", inferred: false },
      { lifecycle: "SIGNATURE_VERIFIED", inferred: true, decision: "VERIFIED" },
      { lifecycle: "WEBHOOK_NORMALIZED", inferred: true },
      { lifecycle: "EVENT_PERSISTED", inferred: true },
      { lifecycle: "PROCESSING_STARTED", inferred: true },
    ];
  }
  if (event.eventType === "WEBHOOK_DUPLICATE") {
    return [
      { lifecycle: "WEBHOOK_RECEIVED", inferred: true },
      { lifecycle: "SIGNATURE_VERIFIED", inferred: true, decision: "VERIFIED" },
      {
        lifecycle: "DUPLICATE_DETECTED",
        inferred: false,
        decision: event.reason,
      },
    ];
  }
  if (event.eventType === "WEBHOOK_CONFLICT") {
    return [
      { lifecycle: "WEBHOOK_RECEIVED", inferred: true },
      { lifecycle: "SIGNATURE_VERIFIED", inferred: true, decision: "VERIFIED" },
      {
        lifecycle: "CONFLICT_DETECTED",
        inferred: false,
        decision: event.reason,
      },
    ];
  }
  if (event.eventType === "WEBHOOK_REJECTED") {
    const rejected = SIGNATURE_REJECT_REASONS.has(event.reason)
      ? "SIGNATURE_REJECTED"
      : "PROCESSING_FAILED";
    return [
      { lifecycle: "WEBHOOK_RECEIVED", inferred: true },
      { lifecycle: rejected, inferred: false, decision: event.reason },
    ];
  }
  if (event.eventType === "PAYMENT_STATE_CHANGED") {
    const items: (Partial<DraftItem> & { readonly lifecycle: LifecycleEvent })[] =
      [
        {
          lifecycle: "STATE_TRANSITION",
          processedTime: event.recordedAt,
          decision: event.reason,
        },
      ];
    if (replay !== null) {
      items.push({
        lifecycle: "REPLAY_COMPLETED",
        processedTime: event.recordedAt,
        replay,
        decision: event.reason,
      });
    }
    return items;
  }
  if (event.eventType === "WEBHOOK_DELAYED") {
    return [
      {
        lifecycle: "REPLAY_STARTED",
        replay,
        decision: event.reason,
      },
    ];
  }
  if (event.eventType === "RETRY_SCHEDULED") {
    return [{ lifecycle: "RETRY_SCHEDULED", retry, decision: event.reason }];
  }
  if (event.eventType === "RETRY_ATTEMPTED") {
    return [{ lifecycle: "RETRY_ATTEMPTED", retry, decision: event.reason }];
  }
  if (event.eventType === "RETRY_SUCCEEDED") {
    return [{ lifecycle: "RETRY_SUCCEEDED", retry, decision: event.reason }];
  }
  if (event.eventType === "RETRY_DEAD_LETTERED") {
    return [{ lifecycle: "RETRY_EXHAUSTED", retry, decision: event.reason }];
  }
  if (
    event.eventType === "EXCEPTION_DETECTED" ||
    event.eventType === "WEBHOOK_CONFLICT_DETECTED" ||
    event.eventType === "INVALID_TRANSITION_DETECTED" ||
    event.eventType === "RETRY_EXHAUSTED"
  ) {
    const conflict = event.eventType === "WEBHOOK_CONFLICT_DETECTED";
    const created: (Partial<DraftItem> & { readonly lifecycle: LifecycleEvent })[] =
      [];
    if (conflict) {
      created.push({
        lifecycle: "CONFLICT_DETECTED",
        inferred: true,
        decision: event.reason,
      });
    }
    created.push({
      lifecycle: "EXCEPTION_CREATED",
      source: "EXCEPTION",
      sourceId: metadataExceptionId(event.metadata) ?? event.auditEventId,
      exceptionId: metadataExceptionId(event.metadata),
      exceptionCode: metadataExceptionCode(event.metadata) ?? event.reason,
      decision: event.reason,
    });
    return created;
  }
  return [];
}

function replayDetail(
  event: TimelineAudit,
  delayed: ReadonlySet<string>,
  eventsConsidered: number,
): TimelineReplayDetail | null {
  if (event.eventType === "WEBHOOK_DELAYED") {
    return {
      replayId: event.auditEventId,
      trigger: event.reason,
      eventsConsidered,
      previousState: event.previousState,
      resultingState: event.resultingState,
    };
  }
  if (event.eventType !== "PAYMENT_STATE_CHANGED" || delayed.size === 0) {
    return null;
  }
  return {
    replayId: event.auditEventId,
    trigger: event.reason,
    eventsConsidered,
    previousState: event.previousState,
    resultingState: event.resultingState,
  };
}

function retryDetail(
  event: TimelineAudit,
  context: {
    readonly retry: TimelineRetry | null;
    readonly deadLetter: TimelineDeadLetter | null;
    readonly classifyFailure?: (code: string) => string;
  },
): TimelineRetryDetail | null {
  if (
    event.eventType !== "RETRY_SCHEDULED" &&
    event.eventType !== "RETRY_ATTEMPTED" &&
    event.eventType !== "RETRY_SUCCEEDED" &&
    event.eventType !== "RETRY_DEAD_LETTERED"
  ) {
    return null;
  }
  const attempt =
    metadataAttempt(event.metadata) ??
    (event.eventType === "RETRY_DEAD_LETTERED"
      ? context.deadLetter?.attemptCount ?? null
      : context.retry?.attemptCount ?? null);
  const failureCode =
    event.eventType === "RETRY_DEAD_LETTERED"
      ? (context.deadLetter?.failureCode ?? event.reason)
      : (context.retry?.lastErrorCode ?? event.reason);
  const failureClass =
    context.classifyFailure !== undefined && failureCode.length > 0
      ? context.classifyFailure(failureCode)
      : null;
  const scheduledAt =
    event.eventType === "RETRY_SCHEDULED" &&
    context.retry !== null &&
    context.retry.webhookEventId === event.webhookEventId &&
    context.retry.status === "RETRY_SCHEDULED"
      ? context.retry.nextAttemptAt
      : null;
  const attemptedAt =
    event.eventType === "RETRY_ATTEMPTED" ||
    event.eventType === "RETRY_SUCCEEDED" ||
    event.eventType === "RETRY_DEAD_LETTERED"
      ? event.recordedAt
      : null;
  return {
    attempt,
    scheduledAt,
    attemptedAt,
    result: event.reason,
    failureClass,
  };
}
