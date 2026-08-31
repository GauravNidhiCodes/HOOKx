import { eventIdentityKey, type NormalizedWebhookEvent } from "@hookx/webhook";
import { compareInstant } from "./instant-order.js";

/**
 * Deterministic event order for replay.
 *
 * 1. `occurredAt` (provider occurrence time), via `compareInstant`.
 * 2. Webhook identity key: canonical JSON
 *    `{"provider":"...","externalEventId":"..."}` compared as UTF-16 code units
 *    (`<` / `>`). This is the tie-breaker when timestamps are equal.
 *
 * Never used: webhook arrival time (`receivedAt`), database insertion time,
 * `Date.now()`, array index (except as a last resort for true duplicate
 * copies of the same identity in one input list), or random order.
 *
 * Equal identity keys compare equal. `orderWebhookEvents` then uses the
 * original input index only so that `Array.prototype.sort` stability is not
 * required. That last step does not change the resulting payment state.
 */
export function compareWebhookEvents(
  left: NormalizedWebhookEvent,
  right: NormalizedWebhookEvent,
): -1 | 0 | 1 {
  const byTime = compareInstant(left.occurredAt, right.occurredAt);
  if (byTime !== 0) {
    return byTime;
  }

  const leftIdentity = eventIdentityKey(left);
  const rightIdentity = eventIdentityKey(right);
  if (leftIdentity < rightIdentity) {
    return -1;
  }
  if (leftIdentity > rightIdentity) {
    return 1;
  }
  return 0;
}

export function orderWebhookEvents(
  events: readonly NormalizedWebhookEvent[],
): NormalizedWebhookEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => {
      const byEvent = compareWebhookEvents(left.event, right.event);
      if (byEvent !== 0) {
        return byEvent;
      }
      return left.index - right.index;
    })
    .map((item) => item.event);
}
