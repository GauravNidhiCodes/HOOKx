import { AUDIT_REASON } from "@hookx/audit";
import { providerId, type Instant, type PaymentId, type ProviderId } from "@hookx/domain";
import {
  factsFromReplayDecision,
  factsFromStoreOutcome,
  factsFromVerificationStatus,
  factsFromWebhookErrorCode,
  type DetectionFact,
} from "@hookx/exceptions";
import type {
  ExceptionRepository,
  PaymentRepository,
  WebhookEventRepository,
} from "@hookx/storage";
import {
  DEFAULT_RETRY_LEASE_MS,
  DEFAULT_RETRY_POLICY,
  ingestRejectionDraft,
  processFreshEvent,
  processPaymentEvents,
  recordExceptionsSafely,
  webhookReceiptDraft,
  type AuditRepository,
  type PersistOutcomeFn,
  type ProcessPaymentEventsFn,
  type RetryLifecycleSink,
  type RetryPolicy,
  type RetryRepository,
} from "@hookx/storage";
import type {
  SignatureVerificationStatus,
  SignatureVerifierRegistry,
} from "@hookx/webhook";
import { getProviderAdapter, isWebhookError } from "@hookx/webhook";
import type { Logger, ProcessMetrics } from "@hookx/observability";
import { PIPELINE_ERROR_CODE, pipelineHttpBody, type PipelineHttpBody } from "./errors.js";
import { emitLifecycle } from "../observability/emit.js";
import { observabilityRetrySink } from "../observability/retry-sink.js";

export type ProcessIncomingWebhookDependencies = {
  readonly verifiers: SignatureVerifierRegistry;
  readonly repository: WebhookEventRepository;
  readonly retry?: RetryRepository;
  readonly processPaymentEvents?: ProcessPaymentEventsFn;
  readonly retryPolicy?: RetryPolicy;
  readonly leaseMs?: number;
  readonly lifecycle?: RetryLifecycleSink;
  readonly audit?: AuditRepository;
  readonly persistOutcome?: PersistOutcomeFn;
  readonly payments?: PaymentRepository;
  readonly exceptions?: ExceptionRepository;
  readonly logger?: Logger;
  readonly metrics?: ProcessMetrics;
};

export type ProcessIncomingWebhookInput = {
  readonly provider: string;
  readonly rawBody: Uint8Array;
  readonly headers: ReadonlyMap<string, string>;
  readonly requestId: string;
  readonly now: Instant;
};

export type ProcessingObservation = {
  readonly requestId: string;
  readonly provider: string;
  readonly verification: SignatureVerificationStatus | "UNSUPPORTED_PROVIDER";
  readonly externalEventId?: string;
  readonly paymentId?: string;
  readonly storeOutcome?: string;
  readonly retryStatus?: string;
  readonly decision?: string;
  readonly durationMs: number;
};

export type ProcessIncomingWebhookResult = {
  readonly httpStatus: number;
  readonly body: PipelineHttpBody;
  readonly observation: ProcessingObservation;
};

function respond(
  httpStatus: number,
  body: PipelineHttpBody,
  observation: Omit<ProcessingObservation, "durationMs">,
  startedAt: number,
): ProcessIncomingWebhookResult {
  return Object.freeze({
    httpStatus,
    body: Object.freeze(body),
    observation: Object.freeze({
      ...observation,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    }),
  });
}

function internalError(
  requestId: string,
  provider: string,
  verification: ProcessingObservation["verification"],
  startedAt: number,
): ProcessIncomingWebhookResult {
  return respond(
    500,
    pipelineHttpBody(
      "error",
      requestId,
      PIPELINE_ERROR_CODE.TEMPORARY_PROCESSING_FAILURE,
    ),
    { requestId, provider, verification },
    startedAt,
  );
}

function optionalProvider(value: string): ProviderId | null {
  try {
    return providerId(value);
  } catch {
    return null;
  }
}

async function recordRejection(
  dependencies: ProcessIncomingWebhookDependencies,
  input: ProcessIncomingWebhookInput,
  reason: string,
): Promise<void> {
  if (dependencies.audit === undefined) {
    return;
  }
  try {
    await dependencies.audit.append(
      ingestRejectionDraft({
        now: input.now,
        correlationId: input.requestId,
        provider: optionalProvider(input.provider),
        reason,
      }),
    );
  } catch {
    // Audit must not change the HTTP outcome of a rejected delivery.
  }
}

async function recordIngestExceptions(
  dependencies: ProcessIncomingWebhookDependencies,
  input: ProcessIncomingWebhookInput,
  facts: readonly DetectionFact[],
  ids: {
    readonly paymentId?: PaymentId | null;
    readonly webhookEventId?: string | null;
    readonly eventType?: string;
  } = {},
): Promise<void> {
  if (facts.length === 0) {
    return;
  }
  const created = await recordExceptionsSafely(
    {
      exceptions: dependencies.exceptions,
      audit: dependencies.audit,
    },
    {
      detectedAt: input.now,
      correlationId: input.requestId,
      provider: optionalProvider(input.provider),
      paymentId: ids.paymentId ?? null,
      webhookEventId: ids.webhookEventId ?? null,
      facts,
    },
    "SYSTEM",
  );
  for (const record of created) {
    emitLifecycle(dependencies, {
      level: record.severity === "INFO" ? "INFO" : "WARN",
      lifecycle: "EXCEPTION_CREATED",
      timestamp: input.now,
      correlationId: input.requestId,
      provider: input.provider,
      paymentId: record.paymentId,
      eventId: record.webhookEventId,
      eventType: ids.eventType,
      exceptionCode: record.exceptionCode,
      processingDecision: record.reason,
    });
  }
}

function logReplayDecisions(
  dependencies: ProcessIncomingWebhookDependencies,
  input: ProcessIncomingWebhookInput,
  event: {
    readonly paymentId: string;
    readonly externalEventId: string;
    readonly eventType: string;
    readonly provider: string;
  },
  decisions: readonly {
    readonly eventId: string;
    readonly decision: string;
    readonly reason: string;
    readonly previousState: string | null;
    readonly resultingState: string | null;
  }[],
): void {
  const incoming = decisions.find((item) => item.eventId === event.externalEventId);
  if (incoming?.decision === "DELAYED") {
    emitLifecycle(dependencies, {
      level: "INFO",
      lifecycle: "REPLAY_STARTED",
      timestamp: input.now,
      correlationId: input.requestId,
      provider: event.provider,
      paymentId: event.paymentId,
      eventId: event.externalEventId,
      eventType: event.eventType,
      processingDecision: incoming.decision,
      trigger: incoming.reason,
      replayId: event.externalEventId,
      previousState: incoming.previousState,
      resultingState: incoming.resultingState,
      eventsConsidered: decisions.length,
    });
  }
  if (incoming?.decision === "ACCEPTED") {
    emitLifecycle(dependencies, {
      level: "INFO",
      lifecycle: "STATE_TRANSITION",
      timestamp: input.now,
      correlationId: input.requestId,
      provider: event.provider,
      paymentId: event.paymentId,
      eventId: event.externalEventId,
      eventType: event.eventType,
      processingDecision: incoming.decision,
      previousState: incoming.previousState,
      resultingState: incoming.resultingState,
    });
  }
  for (const item of decisions) {
    if (item.eventId === event.externalEventId || item.decision !== "ACCEPTED") {
      continue;
    }
    emitLifecycle(dependencies, {
      level: "INFO",
      lifecycle: "REPLAY_COMPLETED",
      timestamp: input.now,
      correlationId: input.requestId,
      provider: event.provider,
      paymentId: event.paymentId,
      eventId: item.eventId,
      processingDecision: item.decision,
      replayId: item.eventId,
      trigger: "OUT_OF_ORDER",
      previousState: item.previousState,
      resultingState: item.resultingState,
      eventsConsidered: decisions.length,
    });
  }
}

/**
 * Application orchestration: verify → adapter → normalize → persist →
 * replay → durable payment + audit. Does not own transition rules, provider
 * parsing, schema SQL, or retry backoff.
 */
export async function processIncomingWebhook(
  dependencies: ProcessIncomingWebhookDependencies,
  input: ProcessIncomingWebhookInput,
): Promise<ProcessIncomingWebhookResult> {
  const startedAt = performance.now();
  emitLifecycle(dependencies, {
    level: "INFO",
    lifecycle: "WEBHOOK_RECEIVED",
    timestamp: input.now,
    correlationId: input.requestId,
    provider: input.provider,
  });
  const verifier = dependencies.verifiers.get(input.provider);
  if (verifier === null) {
    await recordRejection(dependencies, input, AUDIT_REASON.UNSUPPORTED_PROVIDER);
    await recordIngestExceptions(
      dependencies,
      input,
      factsFromVerificationStatus("UNSUPPORTED_PROVIDER"),
    );
    emitLifecycle(dependencies, {
      level: "WARN",
      lifecycle: "PROCESSING_FAILED",
      timestamp: input.now,
      correlationId: input.requestId,
      provider: input.provider,
      processingDecision: "UNSUPPORTED_PROVIDER",
      verification: "UNSUPPORTED_PROVIDER",
    });
    return respond(
      404,
      pipelineHttpBody(
        "not_found",
        input.requestId,
        PIPELINE_ERROR_CODE.UNSUPPORTED_PROVIDER,
      ),
      {
        requestId: input.requestId,
        provider: input.provider,
        verification: "UNSUPPORTED_PROVIDER",
      },
      startedAt,
    );
  }

  const verification = verifier.verify({
    rawBody: input.rawBody,
    headers: input.headers,
    now: input.now,
  });

  if (verification.status !== "VERIFIED") {
    await recordRejection(dependencies, input, verification.status);
    await recordIngestExceptions(
      dependencies,
      input,
      factsFromVerificationStatus(verification.status),
    );
    emitLifecycle(dependencies, {
      level: "WARN",
      lifecycle: "SIGNATURE_REJECTED",
      timestamp: input.now,
      correlationId: input.requestId,
      provider: input.provider,
      processingDecision: verification.status,
      verification: verification.status,
    });
    const malformed = verification.status === "MALFORMED_SIGNATURE";
    return respond(
      malformed ? 400 : 401,
      pipelineHttpBody(
        malformed ? "bad_request" : "unauthorized",
        input.requestId,
        verification.status,
      ),
      {
        requestId: input.requestId,
        provider: input.provider,
        verification: verification.status,
      },
      startedAt,
    );
  }

  emitLifecycle(dependencies, {
    level: "INFO",
    lifecycle: "SIGNATURE_VERIFIED",
    timestamp: input.now,
    correlationId: input.requestId,
    provider: input.provider,
    verification: "VERIFIED",
  });

  let payload: unknown;
  try {
    // Parse only after HMAC over the original raw bytes. Do not stringify
    // this object and re-verify; that would not match the signed representation.
    payload = JSON.parse(new TextDecoder().decode(input.rawBody));
  } catch {
    await recordRejection(dependencies, input, AUDIT_REASON.INVALID_PAYLOAD);
    await recordIngestExceptions(
      dependencies,
      input,
      factsFromWebhookErrorCode(AUDIT_REASON.INVALID_PAYLOAD),
    );
    emitLifecycle(dependencies, {
      level: "WARN",
      lifecycle: "PROCESSING_FAILED",
      timestamp: input.now,
      correlationId: input.requestId,
      provider: input.provider,
      processingDecision: PIPELINE_ERROR_CODE.INVALID_PAYLOAD,
      verification: "VERIFIED",
    });
    return respond(
      400,
      pipelineHttpBody(
        "bad_request",
        input.requestId,
        PIPELINE_ERROR_CODE.INVALID_PAYLOAD,
      ),
      {
        requestId: input.requestId,
        provider: input.provider,
        verification: "VERIFIED",
      },
      startedAt,
    );
  }

  let event;
  try {
    const adapter = getProviderAdapter(input.provider);
    event = adapter.normalize(payload, {
      receivedAt: input.now,
      headers: input.headers,
    });
    emitLifecycle(dependencies, {
      level: "DEBUG",
      lifecycle: "WEBHOOK_NORMALIZED",
      timestamp: input.now,
      correlationId: input.requestId,
      provider: input.provider,
      paymentId: event.paymentId,
      eventId: event.externalEventId,
      eventType: event.eventType,
    });
  } catch (error) {
    if (isWebhookError(error)) {
      await recordRejection(dependencies, input, error.code);
      await recordIngestExceptions(
        dependencies,
        input,
        factsFromWebhookErrorCode(error.code),
      );
      emitLifecycle(dependencies, {
        level: "WARN",
        lifecycle: "PROCESSING_FAILED",
        timestamp: input.now,
        correlationId: input.requestId,
        provider: input.provider,
        processingDecision: error.code,
        verification: "VERIFIED",
      });
      return respond(
        400,
        pipelineHttpBody("bad_request", input.requestId, error.code),
        {
          requestId: input.requestId,
          provider: input.provider,
          verification: "VERIFIED",
        },
        startedAt,
      );
    }
    emitLifecycle(dependencies, {
      level: "ERROR",
      lifecycle: "PROCESSING_FAILED",
      timestamp: input.now,
      correlationId: input.requestId,
      provider: input.provider,
      processingDecision: PIPELINE_ERROR_CODE.TEMPORARY_PROCESSING_FAILURE,
    });
    return internalError(input.requestId, input.provider, "VERIFIED", startedAt);
  }

  let stored;
  try {
    stored = await dependencies.repository.store(event);
  } catch {
    emitLifecycle(dependencies, {
      level: "ERROR",
      lifecycle: "PROCESSING_FAILED",
      timestamp: input.now,
      correlationId: input.requestId,
      provider: input.provider,
      paymentId: event.paymentId,
      eventType: event.eventType,
      processingDecision: PIPELINE_ERROR_CODE.TEMPORARY_PROCESSING_FAILURE,
    });
    return internalError(input.requestId, input.provider, "VERIFIED", startedAt);
  }

  if (stored.outcome === "CONFLICT") {
    if (dependencies.audit !== undefined) {
      try {
        await dependencies.audit.append(
          webhookReceiptDraft(
            stored.existing,
            input.now,
            input.requestId,
            "WEBHOOK_CONFLICT",
            AUDIT_REASON.CONFLICTING_EVENT,
          ),
        );
      } catch {
        // Conflict HTTP response is authoritative for the provider.
      }
    }
    await recordIngestExceptions(
      dependencies,
      input,
      factsFromStoreOutcome("CONFLICT"),
      {
        paymentId: event.paymentId,
        webhookEventId: stored.existing.id,
        eventType: event.eventType,
      },
    );
    emitLifecycle(dependencies, {
      level: "WARN",
      lifecycle: "CONFLICT_DETECTED",
      timestamp: input.now,
      correlationId: input.requestId,
      provider: input.provider,
      paymentId: event.paymentId,
      eventId: stored.existing.id,
      eventType: event.eventType,
      storeOutcome: "CONFLICT",
      processingDecision: "CONFLICT",
    });
    return respond(
      409,
      pipelineHttpBody("conflict", input.requestId, PIPELINE_ERROR_CODE.CONFLICT),
      {
        requestId: input.requestId,
        provider: input.provider,
        verification: "VERIFIED",
        externalEventId: event.externalEventId,
        paymentId: event.paymentId,
        storeOutcome: "CONFLICT",
      },
      startedAt,
    );
  }

  if (dependencies.audit !== undefined) {
    try {
      await dependencies.audit.append(
        webhookReceiptDraft(
          stored.record,
          input.now,
          input.requestId,
          stored.outcome === "DUPLICATE"
            ? "WEBHOOK_DUPLICATE"
            : "WEBHOOK_RECEIVED",
          stored.outcome === "DUPLICATE"
            ? AUDIT_REASON.DUPLICATE_EVENT
            : AUDIT_REASON.ACCEPTED,
        ),
      );
    } catch {
      // The webhook row is durable. Processing still proceeds.
    }
  }

  if (stored.outcome === "DUPLICATE") {
    emitLifecycle(dependencies, {
      level: "INFO",
      lifecycle: "DUPLICATE_DETECTED",
      timestamp: input.now,
      correlationId: input.requestId,
      provider: input.provider,
      paymentId: event.paymentId,
      eventId: stored.record.id,
      eventType: event.eventType,
      storeOutcome: "DUPLICATE",
      processingDecision: "DUPLICATE",
    });
  } else {
    emitLifecycle(dependencies, {
      level: "INFO",
      lifecycle: "EVENT_PERSISTED",
      timestamp: input.now,
      correlationId: input.requestId,
      provider: input.provider,
      paymentId: event.paymentId,
      eventId: stored.record.id,
      eventType: event.eventType,
      storeOutcome: "STORED",
    });
    emitLifecycle(dependencies, {
      level: "DEBUG",
      lifecycle: "PROCESSING_STARTED",
      timestamp: input.now,
      correlationId: input.requestId,
      provider: input.provider,
      paymentId: event.paymentId,
      eventId: stored.record.id,
      eventType: event.eventType,
    });
  }

  const retryLifecycle = observabilityRetrySink(
    dependencies.lifecycle,
    dependencies,
    {
      correlationId: input.requestId,
      provider: input.provider,
      paymentId: event.paymentId,
      eventType: event.eventType,
    },
  );

  if (dependencies.retry !== undefined) {
    let retryStatus: string | undefined;
    try {
      const retryRow = await processFreshEvent(
        {
          retry: dependencies.retry,
          events: dependencies.repository,
          policy: dependencies.retryPolicy ?? DEFAULT_RETRY_POLICY,
          processPaymentEvents: dependencies.processPaymentEvents,
          lifecycle: retryLifecycle,
          leaseMs: dependencies.leaseMs ?? DEFAULT_RETRY_LEASE_MS,
          audit: dependencies.audit,
          persistOutcome: dependencies.persistOutcome,
          correlationId: input.requestId,
          actor: "SYSTEM",
          exceptions: dependencies.exceptions,
        },
        stored.record.id,
        input.now,
      );
      retryStatus = retryRow.status;
    } catch {
      emitLifecycle(dependencies, {
        level: "ERROR",
        lifecycle: "PROCESSING_FAILED",
        timestamp: input.now,
        correlationId: input.requestId,
        provider: input.provider,
        paymentId: event.paymentId,
        eventId: stored.record.id,
        eventType: event.eventType,
        processingDecision: PIPELINE_ERROR_CODE.TEMPORARY_PROCESSING_FAILURE,
      });
      return respond(
        500,
        pipelineHttpBody(
          "error",
          input.requestId,
          PIPELINE_ERROR_CODE.TEMPORARY_PROCESSING_FAILURE,
        ),
        {
          requestId: input.requestId,
          provider: input.provider,
          verification: "VERIFIED",
          externalEventId: event.externalEventId,
          paymentId: event.paymentId,
          storeOutcome: stored.outcome,
        },
        startedAt,
      );
    }

    let decision: string | undefined;
    if (retryStatus === "SUCCEEDED") {
      try {
        const replay = await (
          dependencies.processPaymentEvents ?? processPaymentEvents
        )(dependencies.repository, event.provider, event.paymentId);
        decision = replay.decisions.find(
          (item) => item.eventId === event.externalEventId,
        )?.decision;
        logReplayDecisions(dependencies, input, event, replay.decisions);
      } catch {
        // Observation must not change the HTTP outcome.
      }
    }

    if (stored.outcome === "DUPLICATE") {
      await recordIngestExceptions(
        dependencies,
        input,
        factsFromStoreOutcome("DUPLICATE"),
        {
          paymentId: event.paymentId,
          webhookEventId: stored.record.id,
          eventType: event.eventType,
        },
      );
      return respond(
        200,
        pipelineHttpBody("duplicate", input.requestId),
        {
          requestId: input.requestId,
          provider: input.provider,
          verification: "VERIFIED",
          externalEventId: event.externalEventId,
          paymentId: event.paymentId,
          storeOutcome: stored.outcome,
          retryStatus,
          decision,
        },
        startedAt,
      );
    }

    if (retryStatus === "RETRY_SCHEDULED") {
      emitLifecycle(dependencies, {
        level: "WARN",
        lifecycle: "PROCESSING_FAILED",
        timestamp: input.now,
        correlationId: input.requestId,
        provider: input.provider,
        paymentId: event.paymentId,
        eventId: stored.record.id,
        eventType: event.eventType,
        processingDecision: PIPELINE_ERROR_CODE.TEMPORARY_PROCESSING_FAILURE,
      });
      return respond(
        500,
        pipelineHttpBody(
          "error",
          input.requestId,
          PIPELINE_ERROR_CODE.TEMPORARY_PROCESSING_FAILURE,
        ),
        {
          requestId: input.requestId,
          provider: input.provider,
          verification: "VERIFIED",
          externalEventId: event.externalEventId,
          paymentId: event.paymentId,
          storeOutcome: stored.outcome,
          retryStatus,
        },
        startedAt,
      );
    }

    return respond(
      200,
      pipelineHttpBody("accepted", input.requestId),
      {
        requestId: input.requestId,
        provider: input.provider,
        verification: "VERIFIED",
        externalEventId: event.externalEventId,
        paymentId: event.paymentId,
        storeOutcome: stored.outcome,
        retryStatus,
        decision,
      },
      startedAt,
    );
  }

  try {
    const replay = await processPaymentEvents(
      dependencies.repository,
      event.provider,
      event.paymentId,
    );
    const decision = replay.decisions.find(
      (item) => item.eventId === event.externalEventId,
    );
    logReplayDecisions(dependencies, input, event, replay.decisions);
    if (stored.outcome === "DUPLICATE") {
      await recordIngestExceptions(
        dependencies,
        input,
        factsFromStoreOutcome("DUPLICATE"),
        {
          paymentId: event.paymentId,
          webhookEventId: stored.record.id,
          eventType: event.eventType,
        },
      );
    } else if (decision !== undefined) {
      await recordIngestExceptions(
        dependencies,
        input,
        factsFromReplayDecision({
          decision: decision.decision,
          reason: decision.reason,
          previousState: decision.previousState,
          eventType: event.eventType,
        }),
        {
          paymentId: event.paymentId,
          webhookEventId: stored.record.id,
          eventType: event.eventType,
        },
      );
    }
    return respond(
      200,
      pipelineHttpBody(
        stored.outcome === "DUPLICATE" ? "duplicate" : "accepted",
        input.requestId,
      ),
      {
        requestId: input.requestId,
        provider: input.provider,
        verification: "VERIFIED",
        externalEventId: event.externalEventId,
        paymentId: event.paymentId,
        storeOutcome: stored.outcome,
        decision: decision?.decision,
      },
      startedAt,
    );
  } catch {
    emitLifecycle(dependencies, {
      level: "ERROR",
      lifecycle: "PROCESSING_FAILED",
      timestamp: input.now,
      correlationId: input.requestId,
      provider: input.provider,
      paymentId: event.paymentId,
      eventId: stored.record.id,
      eventType: event.eventType,
      processingDecision: PIPELINE_ERROR_CODE.TEMPORARY_PROCESSING_FAILURE,
    });
    return internalError(input.requestId, input.provider, "VERIFIED", startedAt);
  }
}
