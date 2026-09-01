import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { webhookEvents } from "./webhook-events.js";

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity().notNull(),
    eventType: text("event_type").notNull(),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    recordedAt: timestamp("recorded_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    provider: text("provider"),
    paymentId: text("payment_id"),
    webhookEventId: uuid("webhook_event_id"),
    previousState: text("previous_state"),
    resultingState: text("resulting_state"),
    actor: text("actor").notNull(),
    reason: text("reason").notNull(),
    correlationId: text("correlation_id").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, string | number | boolean | null>>()
      .notNull(),
  },
  (table) => [
    index("audit_events_payment_recorded_idx").on(
      table.paymentId,
      table.recordedAt,
    ),
    index("audit_events_webhook_recorded_idx").on(
      table.webhookEventId,
      table.recordedAt,
    ),
    index("audit_events_correlation_recorded_idx").on(
      table.correlationId,
      table.recordedAt,
    ),
    foreignKey({
      name: "audit_events_webhook_event_id_webhook_events_id_fk",
      columns: [table.webhookEventId],
      foreignColumns: [webhookEvents.id],
    }).onDelete("restrict"),
    check(
      "audit_events_event_type_valid",
      sql`${table.eventType} IN (
        'WEBHOOK_RECEIVED',
        'WEBHOOK_REJECTED',
        'WEBHOOK_DUPLICATE',
        'WEBHOOK_CONFLICT',
        'PAYMENT_STATE_CHANGED',
        'WEBHOOK_DELAYED',
        'RETRY_SCHEDULED',
        'RETRY_ATTEMPTED',
        'RETRY_SUCCEEDED',
        'RETRY_DEAD_LETTERED',
        'EXCEPTION_DETECTED',
        'EXCEPTION_STATUS_CHANGED',
        'WEBHOOK_CONFLICT_DETECTED',
        'INVALID_TRANSITION_DETECTED',
        'RETRY_EXHAUSTED',
        'INVESTIGATION_RECORDED'
      )`,
    ),
    check(
      "audit_events_actor_valid",
      sql`${table.actor} IN ('SYSTEM', 'WEBHOOK_PROVIDER', 'RETRY_WORKER', 'OPERATOR')`,
    ),
  ],
);
