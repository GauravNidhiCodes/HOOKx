import type { PaymentId, ProviderId } from "@hookx/domain";
import { replayEvents, type ReplayResult } from "@hookx/state-machine";
import type { WebhookEventRepository } from "./repository.js";

/**
 * Load every stored event for one provider payment, then replay through the
 * pure coordinator. Database access stays here; ordering and the state machine
 * do not query PostgreSQL.
 *
 * Does not insert, delete, or overwrite stored events. Replay may be run
 * repeatedly; it is a projection over the durable event log.
 */
export async function processPaymentEvents(
  repository: WebhookEventRepository,
  provider: ProviderId,
  paymentId: PaymentId,
): Promise<ReplayResult> {
  const stored = await repository.listByPayment(provider, paymentId);
  return replayEvents(
    stored.map((row) => row.event),
    { provider, paymentId },
  );
}
