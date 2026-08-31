export const SYNTHETIC_PROVIDER_NAME = "SYNTHETIC" as const;

export const SYNTHETIC_EVENT_NAME = {
  PAYMENT_OPENED: "syn.payment.opened",
  PAYMENT_HOLD: "syn.payment.hold",
  PAYMENT_SETTLED: "syn.payment.settled",
  PAYMENT_DECLINED: "syn.payment.declined",
  PAYMENT_RETURN: "syn.payment.return",
} as const;

export type SyntheticEventName =
  (typeof SYNTHETIC_EVENT_NAME)[keyof typeof SYNTHETIC_EVENT_NAME];

export interface SyntheticWebhookPayload {
  readonly infrastructure: typeof SYNTHETIC_PROVIDER_NAME;
  readonly event_ref: string;
  readonly kind: string;
  readonly entity: {
    readonly payment_ref: string;
    readonly booked_at: string;
    readonly money: {
      readonly minor_units: string;
      readonly ccy: string;
    };
  };
}

export function isSyntheticEventName(value: string): value is SyntheticEventName {
  return (Object.values(SYNTHETIC_EVENT_NAME) as readonly string[]).includes(
    value,
  );
}
