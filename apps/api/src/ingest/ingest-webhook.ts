import { AUDIT_REASON } from "@hookx/audit";
import { providerId, type Instant, type ProviderId } from "@hookx/domain";
import type { WebhookEventRepository } from "@hookx/storage";
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
import {
  getProviderAdapter,
  isWebhookError,
} from "@hookx/webhook";

export type IngestDependencies = {
  readonly verifiers: SignatureVerifierRegistry;
  readonly repository: WebhookEventRepository;
  readonly retry?: RetryRepository;
  readonly processPaymentEvents?: ProcessPaymentEventsFn;
  readonly retryPolicy?: RetryPolicy;
  readonly leaseMs?: number;
  readonly lifecycle?: RetryLifecycleSink;
  readonly audit?: AuditRepository;
  readonly persistOutcome?: PersistOutcomeFn;
};

export type IngestWebhookInput = {
  readonly provider: string;
  readonly rawBody: Uint8Array;
  readonly headers: ReadonlyMap<string, string>;
  readonly requestId: string;
  readonly now: Instant;
};

export type IngestHttpBody = {
  readonly status: string;
  readonly requestId: string;
  readonly code?: string;
};

export type IngestObservation = {
  readonly requestId: string;
  readonly provider: string;
  readonly verification: SignatureVerificationStatus | "UNSUPPORTED_PROVIDER";
  readonly externalEventId?: string;
  readonly storeOutcome?: string;
  readonly retryStatus?: string;
};

export type IngestWebhookResult = {
  readonly httpStatus: number;
  readonly body: IngestHttpBody;
  readonly observation: IngestObservation;
};

function respond(
  httpStatus: number,
  body: IngestHttpBody,
  observation: IngestObservation,
): IngestWebhookResult {
  return Object.freeze({
    httpStatus,
    body: Object.freeze(body),
    observation: Object.freeze(observation),
  });
}

function internalError(
  requestId: string,
  provider: string,
  verification: IngestObservation["verification"],
): IngestWebhookResult {
  return respond(
    500,
    { status: "error", requestId },
    { requestId, provider, verification },
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
  dependencies: IngestDependencies,
  input: IngestWebhookInput,
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
 * Verify → parse → normalize → persist → replay.
 * Unverified payloads never reach storage or the state machine.
 */
export async function ingestWebhook(
  dependencies: IngestDependencies,
  input: IngestWebhookInput,
): Promise<IngestWebhookResult> {
  const verifier = dependencies.verifiers.get(input.provider);
  if (verifier === null) {
    await recordRejection(dependencies, input, AUDIT_REASON.UNSUPPORTED_PROVIDER);
    return respond(
      404,
      {
        status: "not_found",
        requestId: input.requestId,
        code: "UNSUPPORTED_PROVIDER",
      },
      {
        requestId: input.requestId,
        provider: input.provider,
        verification: "UNSUPPORTED_PROVIDER",
      },
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
      {
        status: malformed ? "bad_request" : "unauthorized",
        requestId: input.requestId,
        code: verification.status,
      },
      {
        requestId: input.requestId,
        provider: input.provider,
        verification: verification.status,
      },
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(input.rawBody));
  } catch {
    await recordRejection(dependencies, input, AUDIT_REASON.INVALID_PAYLOAD);
    return respond(
      400,
      {
        status: "bad_request",
        requestId: input.requestId,
        code: "INVALID_PAYLOAD",
      },
      {
        requestId: input.requestId,
        provider: input.provider,
        verification: "VERIFIED",
      },
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
        {
          status: "bad_request",
          requestId: input.requestId,
          code: error.code,
        },
        {
          requestId: input.requestId,
          provider: input.provider,
          verification: "VERIFIED",
        },
      );
    }
    return internalError(input.requestId, input.provider, "VERIFIED");
  }

  let stored;
  try {
    stored = await dependencies.repository.store(event);
  } catch {
    return internalError(input.requestId, input.provider, "VERIFIED");
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
      {
        status: "conflict",
        requestId: input.requestId,
        code: "CONFLICT",
      },
      {
        requestId: input.requestId,
        provider: input.provider,
        verification: "VERIFIED",
        externalEventId: event.externalEventId,
        storeOutcome: "CONFLICT",
      },
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
      // The webhook row is already durable. A processing crash must not
      // look like event loss to the provider.
    }
    return respond(
      200,
      {
        status: stored.outcome === "DUPLICATE" ? "duplicate" : "accepted",
        requestId: input.requestId,
      },
      {
        requestId: input.requestId,
        provider: input.provider,
        verification: "VERIFIED",
        externalEventId: event.externalEventId,
        storeOutcome: stored.outcome,
        retryStatus,
      },
    );
  }

  try {
    await processPaymentEvents(
      dependencies.repository,
      event.provider,
      event.paymentId,
    );
  } catch {
    return internalError(input.requestId, input.provider, "VERIFIED");
  }

  return respond(
    200,
    {
      status: stored.outcome === "DUPLICATE" ? "duplicate" : "accepted",
      requestId: input.requestId,
    },
    {
      requestId: input.requestId,
      provider: input.provider,
      verification: "VERIFIED",
      externalEventId: event.externalEventId,
      storeOutcome: stored.outcome,
    },
  );
}
