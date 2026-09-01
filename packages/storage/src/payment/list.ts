import type { PaymentState, ProviderId } from "@hookx/domain";
import type { StoredPayment } from "./types.js";

export const PAYMENT_LIST_LIMIT = 200;

export type PaymentListFilter = {
  readonly q?: string;
  readonly provider?: ProviderId;
  readonly state?: PaymentState;
};

export function matchesPaymentListFilter(
  row: StoredPayment,
  filter?: PaymentListFilter,
): boolean {
  if (filter === undefined) {
    return true;
  }
  if (filter.provider !== undefined && row.provider !== filter.provider) {
    return false;
  }
  if (filter.state !== undefined && row.state !== filter.state) {
    return false;
  }
  if (filter.q !== undefined) {
    const q = filter.q;
    if (row.paymentId !== q && !row.paymentId.includes(q)) {
      return false;
    }
  }
  return true;
}

export function comparePaymentsUpdatedDesc(
  left: StoredPayment,
  right: StoredPayment,
): number {
  if (left.updatedAt > right.updatedAt) {
    return -1;
  }
  if (left.updatedAt < right.updatedAt) {
    return 1;
  }
  if (left.paymentId < right.paymentId) {
    return -1;
  }
  if (left.paymentId > right.paymentId) {
    return 1;
  }
  return left.provider < right.provider
    ? -1
    : left.provider > right.provider
      ? 1
      : 0;
}

export function selectPaymentList(
  rows: readonly StoredPayment[],
  filter?: PaymentListFilter,
): readonly StoredPayment[] {
  return rows
    .filter((row) => matchesPaymentListFilter(row, filter))
    .slice()
    .sort(comparePaymentsUpdatedDesc)
    .slice(0, PAYMENT_LIST_LIMIT);
}
