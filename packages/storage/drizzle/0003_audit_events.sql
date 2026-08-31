CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"provider" text,
	"payment_id" text,
	"webhook_event_id" uuid,
	"previous_state" text,
	"resulting_state" text,
	"actor" text NOT NULL,
	"reason" text NOT NULL,
	"correlation_id" text NOT NULL,
	"metadata" jsonb NOT NULL,
	CONSTRAINT "audit_events_event_type_valid" CHECK ("audit_events"."event_type" IN (
		'WEBHOOK_RECEIVED',
		'WEBHOOK_REJECTED',
		'WEBHOOK_DUPLICATE',
		'WEBHOOK_CONFLICT',
		'PAYMENT_STATE_CHANGED',
		'WEBHOOK_DELAYED',
		'RETRY_SCHEDULED',
		'RETRY_ATTEMPTED',
		'RETRY_SUCCEEDED',
		'RETRY_DEAD_LETTERED'
	)),
	CONSTRAINT "audit_events_actor_valid" CHECK ("audit_events"."actor" IN ('SYSTEM', 'WEBHOOK_PROVIDER', 'RETRY_WORKER', 'OPERATOR'))
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_webhook_event_id_webhook_events_id_fk" FOREIGN KEY ("webhook_event_id") REFERENCES "webhook_events"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "audit_events_payment_recorded_idx" ON "audit_events" USING btree ("payment_id","recorded_at");
--> statement-breakpoint
CREATE INDEX "audit_events_webhook_recorded_idx" ON "audit_events" USING btree ("webhook_event_id","recorded_at");
--> statement-breakpoint
CREATE INDEX "audit_events_correlation_recorded_idx" ON "audit_events" USING btree ("correlation_id","recorded_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hookx_forbid_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_events_forbid_update
  BEFORE UPDATE ON audit_events
  FOR EACH ROW
  EXECUTE FUNCTION hookx_forbid_audit_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_events_forbid_delete
  BEFORE DELETE ON audit_events
  FOR EACH ROW
  EXECUTE FUNCTION hookx_forbid_audit_mutation();
