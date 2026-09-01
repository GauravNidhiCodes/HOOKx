import { AUDIT_REASON } from "@hookx/audit";
import { providerId, type Instant, type ProviderId } from "@hookx/domain";
import type { PaymentRepository, WebhookEventRepository } from "@hookx/storage";
import {
  DEFAULT_RETRY_LEASE_MS,
  DEFAULT_RETRY_POLICY,
  ingestRejectionDraft,
  processFreshEvent,
  processPaymentEvents,
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
import { PIPELINE_ERROR_CODE, pipelineHttpBody, type PipelineHttpBody } from "./errors.js";

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

/** @deprecated Use ProcessIncomingWebhookDependencies. */
export type IngestDependencies = ProcessIncomingWebhookDependencies;
/** @deprecated Use ProcessIncomingWebhookInput. */
export type IngestWebhookInput = ProcessIncomingWebhookInput;
/** @deprecated Use PipelineHttpBody. */
export type IngestHttpBody = PipelineHttpBody;
/** @deprecated Use ProcessingObservation. */
export type IngestObservation = Omit<ProcessingObservation, "durationMs"> & {
  readonly durationMs?: number;
};
/** @deprecated Use ProcessIncomingWebhookResult. */
export type IngestWebhookResult = ProcessIncomingWebhookResult;

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
  const verifier = dependencies.verifiers.get(input.provider);
  if (verifier === null) {
    await recordRejection(dependencies, input, AUDIT_REASON.UNSUPPORTED_PROVIDER);
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

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(input.rawBody));
  } catch {
    await recordRejection(dependencies, input, AUDIT_REASON.INVALID_PAYLOAD);
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
    event = adapter.normalize(payload, { receivedAt: input.now });
  } catch (error) {
    if (isWebhookError(error)) {
      await recordRejection(dependencies, input, error.code);
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
    return internalError(input.requestId, input.provider, "VERIFIED", startedAt);
  }

  let stored;
  try {
    stored = await dependencies.repository.store(event);
  } catch {
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

  if (dependencies.retry !== undefined) {
    let retryStatus: string | undefined;
    try {
      const retryRow = await processFreshEvent(
        {
          retry: dependencies.retry,
          events: dependencies.repository,
          policy: dependencies.retryPolicy ?? DEFAULT_RETRY_POLICY,
          processPaymentEvents: dependencies.processPaymentEvents,
          lifecycle: dependencies.lifecycle,
          leaseMs: dependencies.leaseMs ?? DEFAULT_RETRY_LEASE_MS,
          audit: dependencies.audit,
          persistOutcome: dependencies.persistOutcome,
          correlationId: input.requestId,
          actor: "SYSTEM",
        },
        stored.record.id,
        input.now,
      );
      retryStatus = retryRow.status;
    } catch {
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
      } catch {
        // Observation must not change the HTTP outcome.
      }
    }

    if (stored.outcome === "DUPLICATE") {
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
        decision: replay.decisions.find(
          (item) => item.eventId === event.externalEventId,
        )?.decision,
      },
      startedAt,
    );
  } catch {
    return internalError(input.requestId, input.provider, "VERIFIED", startedAt);
  }
}

/** @deprecated Use processIncomingWebhook. */
export const ingestWebhook = processIncomingWebhook;
