export const PAYMENT_STATES = [
  "CREATED",
  "AUTHORIZED",
  "CAPTURED",
  "FAILED",
  "REFUNDED",
] as const;

export type PaymentState = (typeof PAYMENT_STATES)[number];

export const TERMINAL_PAYMENT_STATES = ["FAILED", "REFUNDED"] as const;

export type TerminalPaymentState = (typeof TERMINAL_PAYMENT_STATES)[number];

export function isPaymentState(value: string): value is PaymentState {
  return (PAYMENT_STATES as readonly string[]).includes(value);
}

export function isTerminalPaymentState(
  value: PaymentState,
): value is TerminalPaymentState {
  return (TERMINAL_PAYMENT_STATES as readonly PaymentState[]).includes(value);
}
