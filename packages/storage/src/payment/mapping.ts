import {
  isPaymentState,
  isoCurrencyCode,
  paymentId,
  providerId,
} from "@hookx/domain";
import { StorageError } from "../errors.js";
import { bigintFromDatabase, instantFromDate } from "../mapping.js";
import type { StoredPayment } from "./types.js";

export type PaymentPersistenceRow = {
  readonly provider: string;
  readonly paymentId: string;
  readonly state: string;
  readonly amountMinorUnits: bigint | string;
  readonly currency: string;
  readonly lastOccurredAt: Date;
  readonly updatedAt: Date;
};

export function toStoredPayment(row: PaymentPersistenceRow): StoredPayment {
  if (!isPaymentState(row.state)) {
    throw new StorageError("INVALID_ROW", "Stored payment state is invalid");
  }
  return Object.freeze({
    provider: providerId(row.provider),
    paymentId: paymentId(row.paymentId),
    state: row.state,
    amountMinor: bigintFromDatabase(row.amountMinorUnits),
    currency: isoCurrencyCode(row.currency),
    lastOccurredAt: instantFromDate(row.lastOccurredAt),
    updatedAt: instantFromDate(row.updatedAt),
  });
}
