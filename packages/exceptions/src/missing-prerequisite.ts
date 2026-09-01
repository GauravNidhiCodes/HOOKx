import type { WebhookEventType } from "@hookx/webhook";
import {
  isEventuallyPossible,
  lookupTransition,
  TRANSITION_TABLE,
  type PaymentRecordState,
} from "@hookx/state-machine";

/**
 * Immediate unique predecessor event type required before `delayedEventType`
 * can apply from `from`. Returns null when the gap is not uniquely determined
 * by the published transition table (no clock, no timeout heuristics).
 */
export function uniqueMissingPrerequisite(
  from: PaymentRecordState,
  delayedEventType: WebhookEventType,
): WebhookEventType | null {
  if (lookupTransition(from, delayedEventType) !== null) {
    return null;
  }
  if (!isEventuallyPossible(from, delayedEventType)) {
    return null;
  }
  const enabling: WebhookEventType[] = [];
  for (const row of TRANSITION_TABLE) {
    if (row.from !== from) {
      continue;
    }
    const next = row.to;
    if (
      lookupTransition(next, delayedEventType) !== null ||
      isEventuallyPossible(next, delayedEventType)
    ) {
      enabling.push(row.eventType);
    }
  }
  const unique = [...new Set(enabling)];
  return unique.length === 1 ? (unique[0] ?? null) : null;
}
