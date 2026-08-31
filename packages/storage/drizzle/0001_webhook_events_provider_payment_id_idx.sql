CREATE INDEX "webhook_events_provider_payment_id_idx" ON "webhook_events" USING btree ("provider","payment_id");
