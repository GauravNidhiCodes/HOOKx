import type { WebhookEventType } from "@hookx/webhook";
import {
  lookupTransition,
  TRANSITION_TABLE,
  type PaymentRecordState,
} from "./transition-table.js";

/**
 * States reachable from `from` by following the published transition table,
 * including `from` itself. Used only to classify an early event as DELAYED
 * versus an impossible CONFLICT. This does not guess or apply a future state.
 */
export function reachableStates(
  from: PaymentRecordState,
): ReadonlySet<PaymentRecordState> {
  const seen = new Set<PaymentRecordState>();
  const queue: PaymentRecordState[] = [from];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || seen.has(current)) {
      continue;
    }
    seen.add(current);
    for (const row of TRANSITION_TABLE) {
      if (row.from === current && !seen.has(row.to)) {
        queue.push(row.to);
      }
    }
  }

  return seen;
}

export function isEventuallyPossible(
  from: PaymentRecordState,
  eventType: WebhookEventType,
): boolean {
  for (const state of reachableStates(from)) {
    if (lookupTransition(state, eventType) !== null) {
      return true;
    }
  }
  return false;
}
