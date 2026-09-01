import type { PaymentId, ProviderId } from "@hookx/domain";
import type { PaymentListFilter } from "./list.js";
import type { StoredPayment } from "./types.js";

export type { PaymentListFilter } from "./list.js";

export interface PaymentRepository {
  get(
    provider: ProviderId,
    paymentId: PaymentId,
  ): Promise<StoredPayment | null>;
  getByPaymentId(paymentId: PaymentId): Promise<StoredPayment | null>;
  list(filter?: PaymentListFilter): Promise<readonly StoredPayment[]>;
  upsert(record: StoredPayment): Promise<StoredPayment>;
}
