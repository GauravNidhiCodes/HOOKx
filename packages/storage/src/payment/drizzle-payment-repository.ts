import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PaymentId, ProviderId } from "@hookx/domain";
import { dateFromInstant } from "../mapping.js";
import { payments } from "../schema/payments.js";
import { toStoredPayment } from "./mapping.js";
import type { PaymentRepository } from "./repository.js";
import type { StoredPayment } from "./types.js";

type StorageDatabase = ReturnType<typeof drizzle>;

export class DrizzlePaymentRepository implements PaymentRepository {
  public constructor(private readonly db: StorageDatabase) {}

  public async get(
    provider: ProviderId,
    paymentId: PaymentId,
  ): Promise<StoredPayment | null> {
    const rows = await this.db
      .select()
      .from(payments)
      .where(
        and(eq(payments.provider, provider), eq(payments.paymentId, paymentId)),
      )
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toStoredPayment(row);
  }

  public async getByPaymentId(
    paymentId: PaymentId,
  ): Promise<StoredPayment | null> {
    const rows = await this.db
      .select()
      .from(payments)
      .where(eq(payments.paymentId, paymentId))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toStoredPayment(row);
  }

  public async upsert(record: StoredPayment): Promise<StoredPayment> {
    const inserted = await this.db
      .insert(payments)
      .values({
        provider: record.provider,
        paymentId: record.paymentId,
        state: record.state,
        amountMinorUnits: record.amountMinor,
        currency: record.currency,
        lastOccurredAt: dateFromInstant(record.lastOccurredAt),
        updatedAt: dateFromInstant(record.updatedAt),
      })
      .onConflictDoUpdate({
        target: [payments.provider, payments.paymentId],
        set: {
          state: record.state,
          amountMinorUnits: record.amountMinor,
          currency: record.currency,
          lastOccurredAt: dateFromInstant(record.lastOccurredAt),
          updatedAt: dateFromInstant(record.updatedAt),
        },
      })
      .returning();
    const row = inserted[0];
    if (row === undefined) {
      throw new Error("Payment row was not upserted");
    }
    return toStoredPayment(row);
  }
}
