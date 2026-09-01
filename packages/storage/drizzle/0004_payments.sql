CREATE TABLE "payments" (
	"provider" text NOT NULL,
	"payment_id" text NOT NULL,
	"state" text NOT NULL,
	"amount_minor_units" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"last_occurred_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "payments_provider_payment_id_pk" PRIMARY KEY("provider","payment_id"),
	CONSTRAINT "payments_state_valid" CHECK ("payments"."state" IN ('CREATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED')),
	CONSTRAINT "payments_amount_minor_units_non_negative" CHECK ("payments"."amount_minor_units" >= 0),
	CONSTRAINT "payments_currency_iso" CHECK ("payments"."currency" ~ '^[A-Z]{3}$')
);
