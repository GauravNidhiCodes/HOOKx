CREATE TABLE "webhook_retries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_event_id" uuid NOT NULL,
	"attempt_count" integer NOT NULL,
	"status" text NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"last_error_code" text,
	"last_failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_retries_webhook_event_id_unique" UNIQUE("webhook_event_id"),
	CONSTRAINT "webhook_retries_attempt_count_non_negative" CHECK ("webhook_retries"."attempt_count" >= 0),
	CONSTRAINT "webhook_retries_status_valid" CHECK ("webhook_retries"."status" IN ('PENDING', 'PROCESSING', 'SUCCEEDED', 'RETRY_SCHEDULED', 'DEAD_LETTERED'))
);
--> statement-breakpoint
ALTER TABLE "webhook_retries" ADD CONSTRAINT "webhook_retries_webhook_event_id_webhook_events_id_fk" FOREIGN KEY ("webhook_event_id") REFERENCES "webhook_events"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "webhook_retries_due_idx" ON "webhook_retries" USING btree ("status","next_attempt_at");
--> statement-breakpoint
CREATE TABLE "webhook_dead_letters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_event_id" uuid NOT NULL,
	"retry_id" uuid NOT NULL,
	"failure_code" text NOT NULL,
	"attempt_count" integer NOT NULL,
	"dead_lettered_at" timestamp with time zone NOT NULL,
	CONSTRAINT "webhook_dead_letters_webhook_event_id_unique" UNIQUE("webhook_event_id"),
	CONSTRAINT "webhook_dead_letters_attempt_count_non_negative" CHECK ("webhook_dead_letters"."attempt_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "webhook_dead_letters" ADD CONSTRAINT "webhook_dead_letters_webhook_event_id_webhook_events_id_fk" FOREIGN KEY ("webhook_event_id") REFERENCES "webhook_events"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "webhook_dead_letters" ADD CONSTRAINT "webhook_dead_letters_retry_id_webhook_retries_id_fk" FOREIGN KEY ("retry_id") REFERENCES "webhook_retries"("id") ON DELETE restrict ON UPDATE no action;
