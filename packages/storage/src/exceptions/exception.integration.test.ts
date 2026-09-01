import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { instant, providerId } from "@hookx/domain";
import { createExceptionDraft } from "@hookx/exceptions";
import { syntheticPaymentCreated } from "@hookx/testkit";
import { defaultTestDatabaseUrl } from "../config.js";
import {
  applyWebhookEventMigrations,
  openWebhookEventStore,
  recreateDatabase,
  type WebhookEventStore,
} from "../store.js";

function exceptionTestDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const parsed = new URL(defaultTestDatabaseUrl(env));
  parsed.pathname = "/hookx_exception_test";
  return parsed.toString();
}

const TEST_URL = exceptionTestDatabaseUrl(process.env);
const NOW = instant("2026-01-15T10:00:01.000Z");

describe("exception persistence", () => {
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
        `HOOKX exception integration tests require PostgreSQL. Cause: ${message}`,
        { cause: error },
      );
    }
  }, 30_000);

  afterAll(async () => {
    if (store !== undefined) {
      await store.close();
    }
  });

  it("persists, deduplicates, lists open, and forbids delete", async () => {
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
    const draft = createExceptionDraft({
      exceptionCode: "DUPLICATE_EVENT",
      paymentId: stored.record.event.paymentId,
      webhookEventId: stored.record.id,
      provider: stored.record.event.provider,
      reason: "DUPLICATE_EVENT",
      detectedAt: NOW,
      correlationId: `corr-${randomUUID()}`,
    });
    const first = await store.exceptions.create(draft);
    const second = await store.exceptions.create(draft);
    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    expect(second.record.exceptionId).toBe(first.record.exceptionId);
    expect(
      await store.exceptions.listByPayment(stored.record.event.paymentId),
    ).toHaveLength(1);
    expect(
      (await store.exceptions.listOpen()).some(
        (row) => row.exceptionId === first.record.exceptionId,
      ),
    ).toBe(true);

    const client = new Client({ connectionString: TEST_URL });
    await client.connect();
    try {
      await expect(
        client.query("DELETE FROM exceptions WHERE id = $1", [
          first.record.exceptionId,
        ]),
      ).rejects.toThrow(/cannot be deleted/i);
    } finally {
      await client.end();
    }

    const acknowledged = await store.exceptions.updateStatus(
      first.record.exceptionId,
      "ACKNOWLEDGED",
    );
    expect(acknowledged.status).toBe("ACKNOWLEDGED");
    expect(await store.exceptions.findById(first.record.exceptionId)).toMatchObject(
      { status: "ACKNOWLEDGED", exceptionCode: "DUPLICATE_EVENT" },
    );
  });

  it("does not leak drizzle types from the repository", async () => {
    const listed = await store.exceptions.list({
      provider: providerId("SYNTHETIC"),
      status: "OPEN",
    });
    for (const row of listed) {
      expect(row).toHaveProperty("exceptionId");
      expect(row).not.toHaveProperty("identityKey");
    }
  });
});
