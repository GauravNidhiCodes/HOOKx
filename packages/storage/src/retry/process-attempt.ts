import type { ReplayDecision, ReplayResult } from "@hookx/state-machine";
import { StorageError } from "../errors.js";
import { processPaymentEvents } from "../process-payment-events.js";
import type { WebhookEventRepository } from "../repository.js";
import {
  classifyProcessingError,
  FAILURE_CLASS,
  FAILURE_CODE,
} from "./classify.js";

export type ProcessPaymentEventsFn = typeof processPaymentEvents;

export type ProcessWebhookAttemptOptions = {
  readonly deferTerminalStatus?: boolean;
};

export type ProcessingAttemptResult =
  | {
      readonly outcome: "SUCCEEDED";
      readonly decision?: ReplayDecision;
      readonly replay?: ReplayResult;
    }
  | { readonly outcome: "ALREADY_PROCESSED" }
  | { readonly outcome: "RETRYABLE"; readonly code: string }
  | {
      readonly outcome: "NON_RETRYABLE";
      readonly code: string;
      readonly decision?: ReplayDecision;
    };

/**
 * Same pipeline as first-time ingest: stored event → replay → state machine.
 * Does not bypass idempotency or domain rules.
 * Does not emit audit events; callers record live outcomes after this returns.
 */
export async function processWebhookAttempt(
  repository: WebhookEventRepository,
  webhookEventId: string,
  processFn: ProcessPaymentEventsFn = processPaymentEvents,
  options: ProcessWebhookAttemptOptions = {},
): Promise<ProcessingAttemptResult> {
  const stored = await repository.findById(webhookEventId);
  if (stored === null) {
    return {
      outcome: "NON_RETRYABLE",
      code: FAILURE_CODE.INVALID_NORMALIZED_EVENT,
    };
  }
  if (stored.processingStatus === "PROCESSED") {
    return { outcome: "ALREADY_PROCESSED" };
  }
  if (
    stored.processingStatus === "REJECTED" ||
    stored.processingStatus === "CONFLICT"
  ) {
    return {
      outcome: "NON_RETRYABLE",
      code: FAILURE_CODE.PERMANENT_CONFLICT,
    };
  }

  if (stored.processingStatus === "RECEIVED") {
    try {
      await repository.markProcessing(stored.id);
    } catch (error) {
      if (
        error instanceof StorageError &&
        error.code === "INVALID_STATUS_TRANSITION"
      ) {
        const latest = await repository.findById(webhookEventId);
        if (latest?.processingStatus === "PROCESSED") {
          return { outcome: "ALREADY_PROCESSED" };
        }
        if (latest?.processingStatus !== "PROCESSING") {
          return classifyThrown(error);
        }
      } else {
        return classifyThrown(error);
      }
    }
  }

  let replay;
  try {
    replay = await processFn(
      repository,
      stored.event.provider,
      stored.event.paymentId,
    );
  } catch (error) {
    return classifyThrown(error);
  }

  const decision = replay.decisions.find(
    (item) => item.eventId === stored.event.externalEventId,
  );
  const defer = options.deferTerminalStatus === true;

  if (decision?.decision === "CONFLICT") {
    if (!defer) {
      try {
        await repository.markConflict(stored.id);
      } catch {
        // Status update is secondary to recording the permanent failure.
      }
    }
    return {
      outcome: "NON_RETRYABLE",
      code: FAILURE_CODE.PERMANENT_CONFLICT,
      decision,
    };
  }
  if (decision?.decision === "REJECTED") {
    if (!defer) {
      try {
        await repository.markRejected(stored.id);
      } catch {
        // Status update is secondary to recording the permanent failure.
      }
    }
    return {
      outcome: "NON_RETRYABLE",
      code: FAILURE_CODE.INVALID_TRANSITION,
      decision,
    };
  }

  if (!defer) {
    try {
      const current = await repository.findById(stored.id);
      if (current?.processingStatus === "RECEIVED") {
        await repository.markProcessing(stored.id);
      }
      if (current?.processingStatus !== "PROCESSED") {
        await repository.markProcessed(stored.id);
      }
    } catch (error) {
      const latest = await repository.findById(stored.id);
      if (latest?.processingStatus === "PROCESSED") {
        return { outcome: "SUCCEEDED", decision, replay };
      }
      return classifyThrown(error);
    }
  }

  return { outcome: "SUCCEEDED", decision, replay };
}

function classifyThrown(error: unknown): ProcessingAttemptResult {
  const classified = classifyProcessingError(error);
  if (classified.failureClass === FAILURE_CLASS.NON_RETRYABLE) {
    return { outcome: "NON_RETRYABLE", code: classified.code };
  }
  return { outcome: "RETRYABLE", code: classified.code };
}
