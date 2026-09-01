ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_event_type_valid";
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_event_type_valid" CHECK ("audit_events"."event_type" IN (
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
	'RETRY_EXHAUSTED'
));
--> statement-breakpoint
CREATE TABLE "exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exception_code" text NOT NULL,
	"severity" text NOT NULL,
	"status" text NOT NULL,
	"provider" text,
	"payment_id" text,
	"webhook_event_id" uuid,
	"reason" text NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"correlation_id" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"identity_key" text NOT NULL,
	CONSTRAINT "exceptions_identity_key_unique" UNIQUE("identity_key"),
	CONSTRAINT "exceptions_code_valid" CHECK ("exceptions"."exception_code" IN (
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
	)),
	CONSTRAINT "exceptions_severity_valid" CHECK ("exceptions"."severity" IN ('INFO', 'WARNING', 'ERROR', 'CRITICAL')),
	CONSTRAINT "exceptions_status_valid" CHECK ("exceptions"."status" IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED'))
);
--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_webhook_event_id_webhook_events_id_fk" FOREIGN KEY ("webhook_event_id") REFERENCES "webhook_events"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "exceptions_payment_detected_idx" ON "exceptions" USING btree ("payment_id","detected_at");
--> statement-breakpoint
CREATE INDEX "exceptions_status_detected_idx" ON "exceptions" USING btree ("status","detected_at");
--> statement-breakpoint
CREATE INDEX "exceptions_provider_detected_idx" ON "exceptions" USING btree ("provider","detected_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hookx_forbid_exception_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'exceptions cannot be deleted';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER exceptions_forbid_delete
  BEFORE DELETE ON exceptions
  FOR EACH ROW
  EXECUTE FUNCTION hookx_forbid_exception_delete();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hookx_exceptions_update_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.exception_code IS DISTINCT FROM OLD.exception_code
     OR NEW.severity IS DISTINCT FROM OLD.severity
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.payment_id IS DISTINCT FROM OLD.payment_id
     OR NEW.webhook_event_id IS DISTINCT FROM OLD.webhook_event_id
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.detected_at IS DISTINCT FROM OLD.detected_at
     OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
     OR NEW.metadata IS DISTINCT FROM OLD.metadata
     OR NEW.identity_key IS DISTINCT FROM OLD.identity_key
  THEN
    RAISE EXCEPTION 'exceptions immutable fields cannot change';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER exceptions_update_guard
  BEFORE UPDATE ON exceptions
  FOR EACH ROW
  EXECUTE FUNCTION hookx_exceptions_update_guard();
