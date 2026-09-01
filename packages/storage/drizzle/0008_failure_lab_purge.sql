CREATE OR REPLACE FUNCTION hookx_failure_lab_purge_active()
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN current_setting('hookx.allow_failure_lab_purge', true) = 'on';
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hookx_is_failure_lab_payment_id(value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT value IS NOT NULL AND value LIKE 'SYNTHETIC:pay:lab-%';
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hookx_forbid_exception_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  webhook_payment text;
BEGIN
  IF hookx_failure_lab_purge_active() AND hookx_is_failure_lab_payment_id(OLD.payment_id) THEN
    RETURN OLD;
  END IF;
  IF hookx_failure_lab_purge_active() AND OLD.webhook_event_id IS NOT NULL THEN
    SELECT payment_id INTO webhook_payment
    FROM webhook_events
    WHERE id = OLD.webhook_event_id;
    IF hookx_is_failure_lab_payment_id(webhook_payment) THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'exceptions cannot be deleted';
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hookx_forbid_investigation_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  exception_payment text;
BEGIN
  IF hookx_failure_lab_purge_active() THEN
    SELECT payment_id INTO exception_payment
    FROM exceptions
    WHERE id = OLD.exception_id;
    IF hookx_is_failure_lab_payment_id(exception_payment) THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'investigations cannot be deleted';
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hookx_forbid_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  webhook_payment text;
BEGIN
  IF TG_OP = 'DELETE'
     AND hookx_failure_lab_purge_active()
     AND hookx_is_failure_lab_payment_id(OLD.payment_id) THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'DELETE'
     AND hookx_failure_lab_purge_active()
     AND OLD.webhook_event_id IS NOT NULL THEN
    SELECT payment_id INTO webhook_payment
    FROM webhook_events
    WHERE id = OLD.webhook_event_id;
    IF hookx_is_failure_lab_payment_id(webhook_payment) THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$;
