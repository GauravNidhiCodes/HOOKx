import type { PaymentState } from "@hookx/domain";
import type { Instant } from "@hookx/domain";
import type { WebhookEventType, WebhookIdentityKey } from "@hookx/webhook";
import type { Payment } from "./payment.js";
import type { EventMaterial } from "./history.js";
import type { PaymentRecordState } from "./transition-table.js";

export const TRANSITION_STATUS = {
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
  IGNORED_DUPLICATE: "IGNORED_DUPLICATE",
  DELAYED: "DELAYED",
  CONFLICT: "CONFLICT",
} as const;

export type TransitionStatus =
  (typeof TRANSITION_STATUS)[keyof typeof TRANSITION_STATUS];

export type RejectionReason = "INVALID_TRANSITION" | "PAYMENT_ID_MISMATCH";

export type AcceptedTransition = {
  readonly status: "ACCEPTED";
  readonly from: PaymentRecordState;
  readonly to: PaymentState;
  readonly payment: Payment;
};

export type RejectedTransition = {
  readonly status: "REJECTED";
  readonly reason: RejectionReason;
  readonly from: PaymentRecordState;
  readonly eventType: WebhookEventType;
  readonly payment: Payment | null;
};

export type IgnoredDuplicate = {
  readonly status: "IGNORED_DUPLICATE";
  readonly identityKey: WebhookIdentityKey;
  readonly payment: Payment | null;
};

export type DelayedTransition = {
  readonly status: "DELAYED";
  readonly reason: "OUT_OF_ORDER";
  readonly payment: Payment;
  readonly eventOccurredAt: Instant;
  readonly lastOccurredAt: Instant;
};

export type ConflictingEvent = {
  readonly status: "CONFLICT";
  readonly identityKey: WebhookIdentityKey;
  readonly existing: EventMaterial;
  readonly incoming: EventMaterial;
  readonly payment: Payment | null;
};

export type TransitionResult =
  | AcceptedTransition
  | RejectedTransition
  | IgnoredDuplicate
  | DelayedTransition
  | ConflictingEvent;
