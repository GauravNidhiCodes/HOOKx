CREATE TABLE "investigations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exception_id" uuid NOT NULL,
	"investigator" text NOT NULL,
	"model_id" text,
	"prompt_version" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"correlation_id" text NOT NULL,
	CONSTRAINT "investigations_investigator_present" CHECK (char_length("investigations"."investigator") > 0)
);
--> statement-breakpoint
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_exception_id_exceptions_id_fk" FOREIGN KEY ("exception_id") REFERENCES "exceptions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "investigations_exception_created_idx" ON "investigations" USING btree ("exception_id","created_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hookx_forbid_investigation_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'investigations cannot be deleted';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER investigations_forbid_delete
  BEFORE DELETE ON investigations
  FOR EACH ROW
  EXECUTE FUNCTION hookx_forbid_investigation_delete();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hookx_forbid_investigation_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'investigations cannot be updated';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER investigations_forbid_update
  BEFORE UPDATE ON investigations
  FOR EACH ROW
  EXECUTE FUNCTION hookx_forbid_investigation_update();
