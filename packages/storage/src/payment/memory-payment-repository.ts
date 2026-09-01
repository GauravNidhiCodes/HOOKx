import type { PaymentId, ProviderId } from "@hookx/domain";
import type { PaymentRepository } from "./repository.js";
import type { StoredPayment } from "./types.js";

function key(provider: ProviderId, paymentId: PaymentId): string {
  return `${provider}\0${paymentId}`;
}

export class MemoryPaymentRepository implements PaymentRepository {
  public readonly records: StoredPayment[] = [];

  public async get(
    provider: ProviderId,
    paymentId: PaymentId,
  ): Promise<StoredPayment | null> {
    return (
      this.records.find(
        (row) => row.provider === provider && row.paymentId === paymentId,
      ) ?? null
    );
  }

  public async getByPaymentId(
    paymentId: PaymentId,
  ): Promise<StoredPayment | null> {
    return this.records.find((row) => row.paymentId === paymentId) ?? null;
  }

  public async upsert(record: StoredPayment): Promise<StoredPayment> {
    const next = Object.freeze({ ...record });
    const index = this.records.findIndex(
      (row) => key(row.provider, row.paymentId) === key(record.provider, record.paymentId),
    );
    if (index === -1) {
      this.records.push(next);
    } else {
      this.records[index] = next;
    }
    return next;
  }
}
