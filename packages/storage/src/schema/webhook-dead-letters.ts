import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { webhookEvents } from "./webhook-events.js";
import { webhookRetries } from "./webhook-retries.js";

export const webhookDeadLetters = pgTable(
  "webhook_dead_letters",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    webhookEventId: uuid("webhook_event_id").notNull(),
    retryId: uuid("retry_id").notNull(),
    failureCode: text("failure_code").notNull(),
    attemptCount: integer("attempt_count").notNull(),
    deadLetteredAt: timestamp("dead_lettered_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    unique("webhook_dead_letters_webhook_event_id_unique").on(
      table.webhookEventId,
    ),
    foreignKey({
      name: "webhook_dead_letters_webhook_event_id_webhook_events_id_fk",
      columns: [table.webhookEventId],
      foreignColumns: [webhookEvents.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "webhook_dead_letters_retry_id_webhook_retries_id_fk",
      columns: [table.retryId],
      foreignColumns: [webhookRetries.id],
    }).onDelete("restrict"),
    check(
      "webhook_dead_letters_attempt_count_non_negative",
      sql`${table.attemptCount} >= 0`,
    ),
  ],
);
