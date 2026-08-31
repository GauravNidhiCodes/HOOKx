import type { ExternalEventId, PaymentId, ProviderId } from "@hookx/domain";
import type { NormalizedWebhookEvent } from "@hookx/webhook";
import type { Payment } from "./payment.js";
import type { PaymentRecordState } from "./transition-table.js";

export const REPLAY_DECISION = {
  ACCEPTED: "ACCEPTED",
  DUPLICATE: "DUPLICATE",
  DELAYED: "DELAYED",
  CONFLICT: "CONFLICT",
  REJECTED: "REJECTED",
} as const;

export type ReplayDecisionKind =
  (typeof REPLAY_DECISION)[keyof typeof REPLAY_DECISION];

export const REPLAY_REASON = {
  TRANSITION: "TRANSITION",
  IDENTICAL_DELIVERY: "IDENTICAL_DELIVERY",
  AWAITING_PREREQUISITE: "AWAITING_PREREQUISITE",
  OUT_OF_ORDER: "OUT_OF_ORDER",
  MATERIAL_CONFLICT: "MATERIAL_CONFLICT",
  IMPOSSIBLE_AFTER_ORDERING: "IMPOSSIBLE_AFTER_ORDERING",
  PAYMENT_ID_MISMATCH: "PAYMENT_ID_MISMATCH",
} as const;

export type ReplayReason = (typeof REPLAY_REASON)[keyof typeof REPLAY_REASON];

export type ReplayDecision = {
  readonly paymentId: PaymentId;
  readonly provider: ProviderId;
  readonly eventId: ExternalEventId;
  readonly previousState: PaymentRecordState;
  readonly resultingState: PaymentRecordState;
  readonly decision: ReplayDecisionKind;
  readonly reason: ReplayReason;
};

export type ReplayScope = {
  readonly provider: ProviderId;
  readonly paymentId: PaymentId;
};

export type ReplayResult = {
  readonly payment: Payment | null;
  readonly decisions: readonly ReplayDecision[];
  readonly delayed: readonly NormalizedWebhookEvent[];
  readonly requiresInvestigation: boolean;
};
