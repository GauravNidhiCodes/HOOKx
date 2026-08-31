CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"external_event_id" text NOT NULL,
	"payment_id" text NOT NULL,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"amount_minor_units" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"payload_hash" text NOT NULL,
	"processing_status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_events_provider_external_event_id_unique" UNIQUE("provider","external_event_id"),
	CONSTRAINT "webhook_events_amount_minor_units_non_negative" CHECK ("webhook_events"."amount_minor_units" >= 0),
	CONSTRAINT "webhook_events_currency_iso" CHECK ("webhook_events"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "webhook_events_processing_status_valid" CHECK ("webhook_events"."processing_status" IN ('RECEIVED', 'PROCESSING', 'PROCESSED', 'REJECTED', 'CONFLICT')),
	CONSTRAINT "webhook_events_event_type_valid" CHECK ("webhook_events"."event_type" IN ('payment.created', 'payment.authorized', 'payment.captured', 'payment.failed', 'refund.created'))
);
