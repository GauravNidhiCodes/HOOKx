import { sql } from "drizzle-orm";
import {
  bigint,
  char,
  check,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").notNull(),
    externalEventId: text("external_event_id").notNull(),
    paymentId: text("payment_id").notNull(),
    eventType: text("event_type").notNull(),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    receivedAt: timestamp("received_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    amountMinorUnits: bigint("amount_minor_units", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    payloadHash: text("payload_hash").notNull(),
    processingStatus: text("processing_status").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("webhook_events_provider_external_event_id_unique").on(
      table.provider,
      table.externalEventId,
    ),
    check(
      "webhook_events_amount_minor_units_non_negative",
      sql`${table.amountMinorUnits} >= 0`,
    ),
    check(
      "webhook_events_currency_iso",
      sql`${table.currency} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "webhook_events_processing_status_valid",
      sql`${table.processingStatus} IN ('RECEIVED', 'PROCESSING', 'PROCESSED', 'REJECTED', 'CONFLICT')`,
    ),
    check(
      "webhook_events_event_type_valid",
      sql`${table.eventType} IN ('payment.created', 'payment.authorized', 'payment.captured', 'payment.failed', 'refund.created')`,
    ),
  ],
);
