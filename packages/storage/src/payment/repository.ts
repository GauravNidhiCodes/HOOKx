import type { PaymentId, ProviderId } from "@hookx/domain";
import type { StoredPayment } from "./types.js";

export interface PaymentRepository {
  get(
    provider: ProviderId,
    paymentId: PaymentId,
  ): Promise<StoredPayment | null>;
  getByPaymentId(paymentId: PaymentId): Promise<StoredPayment | null>;
  upsert(record: StoredPayment): Promise<StoredPayment>;
}
