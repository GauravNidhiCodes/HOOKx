import { and, desc, eq, like, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PaymentId, ProviderId } from "@hookx/domain";
import { dateFromInstant } from "../mapping.js";
import { payments } from "../schema/payments.js";
import { likeContains } from "../sql-search.js";
import { PAYMENT_LIST_LIMIT, type PaymentListFilter } from "./list.js";
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

  public async list(
    filter?: PaymentListFilter,
  ): Promise<readonly StoredPayment[]> {
    const clauses: SQL[] = [];
    if (filter?.provider !== undefined) {
      clauses.push(eq(payments.provider, filter.provider));
    }
    if (filter?.state !== undefined) {
      clauses.push(eq(payments.state, filter.state));
    }
    if (filter?.q !== undefined) {
      const q = filter.q;
      clauses.push(like(payments.paymentId, likeContains(q)));
    }
    const query =
      clauses.length === 0
        ? this.db.select().from(payments)
        : this.db
            .select()
            .from(payments)
            .where(and(...clauses));
    const rows = await query
      .orderBy(desc(payments.updatedAt), desc(payments.paymentId))
      .limit(PAYMENT_LIST_LIMIT);
    return rows.map((row) => toStoredPayment(row));
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
