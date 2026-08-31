import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { webhookEvents } from "./webhook-events.js";

export const webhookRetries = pgTable(
  "webhook_retries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    webhookEventId: uuid("webhook_event_id").notNull(),
    attemptCount: integer("attempt_count").notNull(),
    status: text("status").notNull(),
    nextAttemptAt: timestamp("next_attempt_at", {
      withTimezone: true,
      mode: "date",
    }),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    lastErrorCode: text("last_error_code"),
    lastFailedAt: timestamp("last_failed_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("webhook_retries_webhook_event_id_unique").on(table.webhookEventId),
    index("webhook_retries_due_idx").on(table.status, table.nextAttemptAt),
    foreignKey({
      name: "webhook_retries_webhook_event_id_webhook_events_id_fk",
      columns: [table.webhookEventId],
      foreignColumns: [webhookEvents.id],
    }).onDelete("restrict"),
    check(
      "webhook_retries_attempt_count_non_negative",
      sql`${table.attemptCount} >= 0`,
    ),
    check(
      "webhook_retries_status_valid",
      sql`${table.status} IN ('PENDING', 'PROCESSING', 'SUCCEEDED', 'RETRY_SCHEDULED', 'DEAD_LETTERED')`,
    ),
  ],
);
