import type { Instant } from "@hookx/domain";
import type { WebhookEventRepository } from "@hookx/storage";
import { processPaymentEvents } from "@hookx/storage";
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
