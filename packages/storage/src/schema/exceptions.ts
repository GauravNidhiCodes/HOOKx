import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { webhookEvents } from "./webhook-events.js";

export const exceptions = pgTable(
  "exceptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    exceptionCode: text("exception_code").notNull(),
    severity: text("severity").notNull(),
    status: text("status").notNull(),
    provider: text("provider"),
    paymentId: text("payment_id"),
    webhookEventId: uuid("webhook_event_id"),
    reason: text("reason").notNull(),
    detectedAt: timestamp("detected_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    correlationId: text("correlation_id").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, string | number | boolean | null>>()
      .notNull(),
    identityKey: text("identity_key").notNull(),
  },
  (table) => [
    unique("exceptions_identity_key_unique").on(table.identityKey),
    index("exceptions_payment_detected_idx").on(
      table.paymentId,
      table.detectedAt,
    ),
    index("exceptions_status_detected_idx").on(table.status, table.detectedAt),
    index("exceptions_code_detected_idx").on(
      table.exceptionCode,
      table.detectedAt,
    ),
    index("exceptions_provider_detected_idx").on(
      table.provider,
      table.detectedAt,
    ),
    foreignKey({
      name: "exceptions_webhook_event_id_webhook_events_id_fk",
      columns: [table.webhookEventId],
      foreignColumns: [webhookEvents.id],
    }).onDelete("restrict"),
    check(
      "exceptions_code_valid",
      sql`${table.exceptionCode} IN (
        'INVALID_SIGNATURE',
        'MALFORMED_WEBHOOK',
        'UNSUPPORTED_EVENT',
        'CONFLICTING_EVENT',
        'INVALID_STATE_TRANSITION',
        'PROCESSING_FAILURE',
        'RETRY_EXHAUSTED',
        'OUT_OF_ORDER_EVENT',
        'MISSING_EVENT',
        'DUPLICATE_EVENT'
      )`,
    ),
    check(
      "exceptions_severity_valid",
      sql`${table.severity} IN ('INFO', 'WARNING', 'ERROR', 'CRITICAL')`,
    ),
    check(
      "exceptions_status_valid",
      sql`${table.status} IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')`,
    ),
  ],
);
