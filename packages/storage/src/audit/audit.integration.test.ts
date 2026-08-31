import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { AUDIT_REASON } from "@hookx/audit";
import { instant, paymentId, providerId } from "@hookx/domain";
import { defaultTestDatabaseUrl } from "../config.js";
import {
  applyWebhookEventMigrations,
  openWebhookEventStore,
  recreateDatabase,
  type WebhookEventStore,
} from "../store.js";
import { syntheticPaymentCreated } from "@hookx/testkit";

const NOW = instant("2026-01-15T10:00:01.000Z");
const EARLIER = instant("2026-01-15T10:00:00.000Z");

function auditTestDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const parsed = new URL(defaultTestDatabaseUrl(env));
  parsed.pathname = "/hookx_audit_test";
  return parsed.toString();
}

const TEST_URL = auditTestDatabaseUrl(process.env);

describe("audit event persistence", () => {
  let store: WebhookEventStore;

  beforeAll(async () => {
    try {
      await recreateDatabase({ url: TEST_URL });
      await applyWebhookEventMigrations({ url: TEST_URL });
      store = await openWebhookEventStore({ url: TEST_URL });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "unknown database error";
      throw new Error(
        `HOOKX audit integration tests require PostgreSQL. Cause: ${message}`,
        { cause: error },
      );
    }
  }, 30_000);

  afterAll(async () => {
    if (store !== undefined) {
      await store.close();
    }
  });

  it("persists and retrieves audit rows chronologically", async () => {
    const stored = await store.repository.store(
      syntheticPaymentCreated({
        externalEventId: `SYNTHETIC:evt:${randomUUID()}`,
        payloadHash: `SYNTHETIC:hash:${randomUUID()}`,
        paymentId: `SYNTHETIC:pay:${randomUUID()}`,
      }),
    );
    expect(stored.outcome).toBe("STORED");
    if (stored.outcome !== "STORED") {
      return;
    }
    const correlationId = `corr-${randomUUID()}`;
    await store.audit.append({
      eventType: "WEBHOOK_RECEIVED",
      occurredAt: EARLIER,
      recordedAt: EARLIER,
      provider: stored.record.event.provider,
      paymentId: stored.record.event.paymentId,
      webhookEventId: stored.record.id,
      previousState: null,
      resultingState: null,
      actor: "WEBHOOK_PROVIDER",
      reason: AUDIT_REASON.ACCEPTED,
      correlationId,
    });
    await store.audit.append({
      eventType: "PAYMENT_STATE_CHANGED",
      occurredAt: EARLIER,
      recordedAt: NOW,
      provider: stored.record.event.provider,
      paymentId: stored.record.event.paymentId,
      webhookEventId: stored.record.id,
      previousState: null,
      resultingState: "CREATED",
      actor: "SYSTEM",
      reason: AUDIT_REASON.ACCEPTED,
      correlationId,
    });
    const byPayment = await store.audit.listByPayment(
      stored.record.event.paymentId,
      stored.record.event.provider,
    );
    expect(byPayment.map((row) => row.eventType)).toEqual([
      "WEBHOOK_RECEIVED",
      "PAYMENT_STATE_CHANGED",
    ]);
    const byWebhook = await store.audit.listByWebhook(stored.record.id);
    expect(byWebhook).toHaveLength(2);
    const byCorrelation = await store.audit.listByCorrelationId(correlationId);
    expect(byCorrelation).toHaveLength(2);
    expect(byPayment[0]?.occurredAt).toBe(EARLIER);
    expect(byPayment[1]?.recordedAt).toBe(NOW);
  });

  it("rejects update and delete through ordinary SQL", async () => {
    const stored = await store.repository.store(
      syntheticPaymentCreated({
        externalEventId: `SYNTHETIC:evt:${randomUUID()}`,
        payloadHash: `SYNTHETIC:hash:${randomUUID()}`,
        paymentId: `SYNTHETIC:pay:${randomUUID()}`,
      }),
    );
    if (stored.outcome !== "STORED") {
      throw new Error("expected store");
    }
    const created = await store.audit.append({
      eventType: "WEBHOOK_RECEIVED",
      occurredAt: NOW,
      recordedAt: NOW,
      provider: providerId("SYNTHETIC"),
      paymentId: stored.record.event.paymentId,
      webhookEventId: stored.record.id,
      previousState: null,
      resultingState: null,
      actor: "WEBHOOK_PROVIDER",
      reason: AUDIT_REASON.ACCEPTED,
      correlationId: `corr-${randomUUID()}`,
    });
    const client = new Client({ connectionString: TEST_URL });
    await client.connect();
    try {
      await expect(
        client.query("UPDATE audit_events SET reason = $1 WHERE id = $2", [
          "MUTATED",
          created.auditEventId,
        ]),
      ).rejects.toThrow(/append-only/);
      await expect(
        client.query("DELETE FROM audit_events WHERE id = $1", [
          created.auditEventId,
        ]),
      ).rejects.toThrow(/append-only/);
    } finally {
      await client.end();
    }
    const still = await store.audit.listByWebhook(stored.record.id);
    expect(still).toHaveLength(1);
    expect(still[0]?.reason).toBe(AUDIT_REASON.ACCEPTED);
    expect(paymentId(still[0]!.paymentId!)).toBe(stored.record.event.paymentId);
  });
});
