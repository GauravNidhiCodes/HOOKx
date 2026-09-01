import type { Instant, ProviderId } from "@hookx/domain";
import type { ReplayDecision, ReplayResult } from "@hookx/state-machine";
import type { StoredPayment } from "./types.js";

/**
 * Persist the replay projection only when this event produced an ACCEPTED
 * transition. DELAYED / REJECTED / CONFLICT must not create or overwrite
 * durable payment state.
 */
export function storedPaymentFromReplay(
  replay: ReplayResult | undefined,
  decision: ReplayDecision | undefined,
  provider: ProviderId,
  updatedAt: Instant,
): StoredPayment | null {
  if (replay?.payment === null || replay?.payment === undefined) {
    return null;
  }
  if (decision?.decision !== "ACCEPTED") {
    return null;
  }
  return Object.freeze({
    provider,
    paymentId: replay.payment.paymentId,
    state: replay.payment.state,
    amountMinor: replay.payment.amountMinor,
    currency: replay.payment.currency,
    lastOccurredAt: replay.payment.lastOccurredAt,
    updatedAt,
  });
}
