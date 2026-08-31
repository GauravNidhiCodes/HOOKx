import {
  DomainError,
  money,
  type Instant,
  type IsoCurrencyCode,
  type PaymentId,
  type PaymentState,
} from "@hookx/domain";

export interface Payment {
  readonly paymentId: PaymentId;
  readonly state: PaymentState;
  readonly amountMinor: bigint;
  readonly currency: IsoCurrencyCode;
  readonly lastOccurredAt: Instant;
}

export interface PaymentInput {
  readonly paymentId: PaymentId;
  readonly state: PaymentState;
  readonly amountMinor: bigint;
  readonly currency: IsoCurrencyCode;
  readonly lastOccurredAt: Instant;
}

export function createPayment(input: PaymentInput): Payment {
  if (typeof input.amountMinor !== "bigint") {
    throw new DomainError(
      "MONEY_AMOUNT_NOT_BIGINT",
      "amountMinor must be a bigint minor-unit value",
    );
  }

  const value = money(input.amountMinor, input.currency);

  return Object.freeze({
    paymentId: input.paymentId,
    state: input.state,
    amountMinor: value.amountMinor,
    currency: value.currency,
    lastOccurredAt: input.lastOccurredAt,
  });
}
