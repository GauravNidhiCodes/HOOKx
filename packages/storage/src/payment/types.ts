import type {
  Instant,
  IsoCurrencyCode,
  PaymentId,
  PaymentState,
  ProviderId,
} from "@hookx/domain";

export type StoredPayment = {
  readonly provider: ProviderId;
  readonly paymentId: PaymentId;
  readonly state: PaymentState;
  readonly amountMinor: bigint;
  readonly currency: IsoCurrencyCode;
  readonly lastOccurredAt: Instant;
  readonly updatedAt: Instant;
};
