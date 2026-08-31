import type { NormalizedWebhookEvent } from "@hookx/webhook";
import { withProcessedEvent, type ProcessingHistory } from "./history.js";
import { orderWebhookEvents } from "./order-events.js";
import type { Payment } from "./payment.js";
import { processEvent } from "./process-event.js";
import { isEventuallyPossible } from "./reachability.js";
import {
  REPLAY_REASON,
  type ReplayDecision,
  type ReplayReason,
  type ReplayResult,
  type ReplayScope,
} from "./replay-result.js";
import type { TransitionResult } from "./result.js";
import type { PaymentRecordState } from "./transition-table.js";

function emptyReplayResult(): ReplayResult {
  return Object.freeze({
    payment: null,
    decisions: Object.freeze([]),
    delayed: Object.freeze([]),
    requiresInvestigation: false,
  });
}

function freezeReplayResult(
  payment: Payment | null,
  decisions: readonly ReplayDecision[],
  delayed: readonly NormalizedWebhookEvent[],
): ReplayResult {
  return Object.freeze({
    payment,
    decisions: Object.freeze([...decisions]),
    delayed: Object.freeze([...delayed]),
    requiresInvestigation: decisions.some(
      (decision) => decision.decision === "CONFLICT",
    ),
  });
}

function decisionRecord(
  event: NormalizedWebhookEvent,
  previousState: PaymentRecordState,
  resultingState: PaymentRecordState,
  decision: ReplayDecision["decision"],
  reason: ReplayReason,
): ReplayDecision {
  return Object.freeze({
    paymentId: event.paymentId,
    provider: event.provider,
    eventId: event.externalEventId,
    previousState,
    resultingState,
    decision,
    reason,
  });
}

function classifyAttempt(
  result: TransitionResult,
  event: NormalizedWebhookEvent,
  previousState: PaymentRecordState,
): {
  readonly decision: ReplayDecision["decision"];
  readonly reason: ReplayReason;
  readonly settle: boolean;
  readonly resultingState: PaymentRecordState;
  readonly acceptedPayment: Payment | null;
} {
  switch (result.status) {
    case "ACCEPTED":
      return {
        decision: "ACCEPTED",
        reason: REPLAY_REASON.TRANSITION,
        settle: true,
        resultingState: result.to,
        acceptedPayment: result.payment,
      };
    case "IGNORED_DUPLICATE":
      return {
        decision: "DUPLICATE",
        reason: REPLAY_REASON.IDENTICAL_DELIVERY,
        settle: true,
        resultingState: previousState,
        acceptedPayment: null,
      };
    case "CONFLICT":
      return {
        decision: "CONFLICT",
        reason: REPLAY_REASON.MATERIAL_CONFLICT,
        settle: true,
        resultingState: previousState,
        acceptedPayment: null,
      };
    case "DELAYED":
      return {
        decision: "DELAYED",
        reason: REPLAY_REASON.OUT_OF_ORDER,
        settle: false,
        resultingState: previousState,
        acceptedPayment: null,
      };
    case "REJECTED":
      if (result.reason === "PAYMENT_ID_MISMATCH") {
        return {
          decision: "REJECTED",
          reason: REPLAY_REASON.PAYMENT_ID_MISMATCH,
          settle: true,
          resultingState: previousState,
          acceptedPayment: null,
        };
      }
      if (isEventuallyPossible(previousState, event.eventType)) {
        return {
          decision: "DELAYED",
          reason: REPLAY_REASON.AWAITING_PREREQUISITE,
          settle: false,
          resultingState: previousState,
          acceptedPayment: null,
        };
      }
      return {
        decision: "CONFLICT",
        reason: REPLAY_REASON.IMPOSSIBLE_AFTER_ORDERING,
        settle: true,
        resultingState: previousState,
        acceptedPayment: null,
      };
  }
}

/**
 * Pure replay: order stored events, then drive `processEvent` until no further
 * ACCEPTED progress is possible.
 *
 * No database, network, system clock, or randomness.
 * Same scoped events always produce the same result.
 */
export function replayEvents(
  events: readonly NormalizedWebhookEvent[],
  scope?: ReplayScope,
): ReplayResult {
  if (events.length === 0) {
    return emptyReplayResult();
  }

  const provider = scope?.provider ?? events[0]!.provider;
  const paymentId = scope?.paymentId ?? events[0]!.paymentId;
  const scoped = events.filter(
    (event) => event.provider === provider && event.paymentId === paymentId,
  );
  if (scoped.length === 0) {
    return emptyReplayResult();
  }

  const ordered = orderWebhookEvents(scoped);
  let payment: Payment | null = null;
  let history: ProcessingHistory = [];
  const settledIndexes = new Set<number>();
  const settledDecisions = new Map<number, ReplayDecision>();

  let progress = true;
  while (progress) {
    progress = false;
    for (let index = 0; index < ordered.length; index += 1) {
      if (settledIndexes.has(index)) {
        continue;
      }
      const event = ordered[index]!;
      const previousState: PaymentRecordState =
        payment === null ? null : payment.state;
      const classified = classifyAttempt(
        processEvent(payment, event, history),
        event,
        previousState,
      );

      if (classified.decision === "ACCEPTED" && classified.acceptedPayment !== null) {
        payment = classified.acceptedPayment;
        history = withProcessedEvent(history, event);
        settledIndexes.add(index);
        settledDecisions.set(
          index,
          decisionRecord(
            event,
            previousState,
            classified.resultingState,
            classified.decision,
            classified.reason,
          ),
        );
        progress = true;
        continue;
      }

      if (!classified.settle) {
        continue;
      }

      settledIndexes.add(index);
      settledDecisions.set(
        index,
        decisionRecord(
          event,
          previousState,
          classified.resultingState,
          classified.decision,
          classified.reason,
        ),
      );
    }
  }

  const finalState: PaymentRecordState =
    payment === null ? null : payment.state;
  const delayed: NormalizedWebhookEvent[] = [];
  const decisions: ReplayDecision[] = ordered.map((event, index) => {
    const settled = settledDecisions.get(index);
    if (settled !== undefined) {
      return settled;
    }
    delayed.push(event);
    return decisionRecord(
      event,
      finalState,
      finalState,
      "DELAYED",
      REPLAY_REASON.AWAITING_PREREQUISITE,
    );
  });

  return freezeReplayResult(payment, decisions, delayed);
}
