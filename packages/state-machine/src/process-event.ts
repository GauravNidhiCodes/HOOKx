import { eventIdentityKey, type NormalizedWebhookEvent } from "@hookx/webhook";
import {
  eventMaterial,
  findProcessedEvent,
  eventsMateriallyEqual,
  type ProcessingHistory,
} from "./history.js";
import { compareInstant } from "./instant-order.js";
import { createPayment, type Payment } from "./payment.js";
import type { TransitionResult } from "./result.js";
import { lookupTransition } from "./transition-table.js";

export function processEvent(
  currentPayment: Payment | null,
  event: NormalizedWebhookEvent,
  processingHistory: ProcessingHistory,
): TransitionResult {
  const identityKey = eventIdentityKey(event);
  const existing = findProcessedEvent(processingHistory, identityKey);

  if (existing !== null) {
    const incoming = eventMaterial(event);
    if (eventsMateriallyEqual(existing, incoming)) {
      return Object.freeze({
        status: "IGNORED_DUPLICATE",
        identityKey,
        payment: currentPayment,
      });
    }

    return Object.freeze({
      status: "CONFLICT",
      identityKey,
      existing: eventMaterial(existing),
      incoming,
      payment: currentPayment,
    });
  }

  if (
    currentPayment !== null &&
    currentPayment.paymentId !== event.paymentId
  ) {
    return Object.freeze({
      status: "REJECTED",
      reason: "PAYMENT_ID_MISMATCH",
      from: currentPayment.state,
      eventType: event.eventType,
      payment: currentPayment,
    });
  }

  if (
    currentPayment !== null &&
    compareInstant(event.occurredAt, currentPayment.lastOccurredAt) < 0
  ) {
    return Object.freeze({
      status: "DELAYED",
      reason: "OUT_OF_ORDER",
      payment: currentPayment,
      eventOccurredAt: event.occurredAt,
      lastOccurredAt: currentPayment.lastOccurredAt,
    });
  }

  const from = currentPayment === null ? null : currentPayment.state;
  const to = lookupTransition(from, event.eventType);
  if (to === null) {
    return Object.freeze({
      status: "REJECTED",
      reason: "INVALID_TRANSITION",
      from,
      eventType: event.eventType,
      payment: currentPayment,
    });
  }

  const amountMinor =
    currentPayment === null ? event.amountMinor : currentPayment.amountMinor;
  const currency =
    currentPayment === null ? event.currency : currentPayment.currency;

  return Object.freeze({
    status: "ACCEPTED",
    from,
    to,
    payment: createPayment({
      paymentId: event.paymentId,
      state: to,
      amountMinor,
      currency,
      lastOccurredAt: event.occurredAt,
    }),
  });
}
