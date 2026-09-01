import { sql } from "drizzle-orm";
import {
  bigint,
  char,
  check,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const payments = pgTable(
  "payments",
  {
    provider: text("provider").notNull(),
    paymentId: text("payment_id").notNull(),
    state: text("state").notNull(),
    amountMinorUnits: bigint("amount_minor_units", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    lastOccurredAt: timestamp("last_occurred_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    primaryKey({
      name: "payments_provider_payment_id_pk",
      columns: [table.provider, table.paymentId],
    }),
    check(
      "payments_state_valid",
      sql`${table.state} IN ('CREATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED')`,
    ),
    check(
      "payments_amount_minor_units_non_negative",
      sql`${table.amountMinorUnits} >= 0`,
    ),
    check("payments_currency_iso", sql`${table.currency} ~ '^[A-Z]{3}$'`),
  ],
);
