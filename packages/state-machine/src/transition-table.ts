import type { PaymentState } from "@hookx/domain";
import type { WebhookEventType } from "@hookx/webhook";

export type PaymentRecordState = PaymentState | null;

export interface AllowedTransition {
  readonly from: PaymentRecordState;
  readonly eventType: WebhookEventType;
  readonly to: PaymentState;
}

export const TRANSITION_TABLE: readonly AllowedTransition[] = Object.freeze([
  { from: null, eventType: "payment.created", to: "CREATED" },
  { from: "CREATED", eventType: "payment.authorized", to: "AUTHORIZED" },
  { from: "CREATED", eventType: "payment.failed", to: "FAILED" },
  { from: "AUTHORIZED", eventType: "payment.captured", to: "CAPTURED" },
  { from: "AUTHORIZED", eventType: "payment.failed", to: "FAILED" },
  { from: "CAPTURED", eventType: "refund.created", to: "REFUNDED" },
]);

function tableKey(from: PaymentRecordState, eventType: WebhookEventType): string {
  return `${from ?? "NONE"}|${eventType}`;
}

const TRANSITION_INDEX: ReadonlyMap<string, PaymentState> = new Map(
  TRANSITION_TABLE.map((row) => [tableKey(row.from, row.eventType), row.to]),
);

export function lookupTransition(
  from: PaymentRecordState,
  eventType: WebhookEventType,
): PaymentState | null {
  return TRANSITION_INDEX.get(tableKey(from, eventType)) ?? null;
}
