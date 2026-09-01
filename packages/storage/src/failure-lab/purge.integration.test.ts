import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { instant, paymentId, providerId } from "@hookx/domain";
import { createExceptionDraft } from "@hookx/exceptions";
import { syntheticPaymentAuthorized, syntheticPaymentCreated } from "@hookx/testkit";
import { defaultTestDatabaseUrl } from "../config.js";
import {
  applyWebhookEventMigrations,
  openWebhookEventStore,
  recreateDatabase,
  type WebhookEventStore,
} from "../store.js";
import { isFailureLabPaymentId } from "./identity.js";

function failureLabPurgeTestDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const parsed = new URL(defaultTestDatabaseUrl(env));
  parsed.pathname = "/hookx_failure_lab_purge_test";
  return parsed.toString();
}

const TEST_URL = failureLabPurgeTestDatabaseUrl(process.env);
const NOW = instant("2026-01-15T10:00:01.000Z");

describe("purgeSyntheticFailureLab", () => {
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
        `HOOKX Failure Lab purge tests require PostgreSQL. Cause: ${message}`,
        { cause: error },
      );
    }
  }, 30_000);

  afterAll(async () => {
    if (store !== undefined) {
      await store.close();
    }
  });

  it("never deletes non-lab synthetic or live-shaped rows", async () => {
    const labPay = paymentId(
      "SYNTHETIC:pay:lab-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );
    const simPay = paymentId("SYNTHETIC:pay:sim-purge-keep");
    expect(isFailureLabPaymentId(labPay)).toBe(true);
    expect(isFailureLabPaymentId(simPay)).toBe(false);

    const labStored = await store.repository.store(
      syntheticPaymentCreated({
        paymentId: labPay,
        externalEventId:
          "SYNTHETIC:evt:lab-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb-created",
        payloadHash: "SYNTHETIC:hash:lab-purge",
      }),
    );
    const simStored = await store.repository.store(
      syntheticPaymentCreated({
        paymentId: simPay,
        externalEventId: "SYNTHETIC:evt:sim-purge-keep-created",
        payloadHash: "SYNTHETIC:hash:sim-purge",
      }),
    );
    expect(labStored.outcome).toBe("STORED");
    expect(simStored.outcome).toBe("STORED");
    if (labStored.outcome !== "STORED" || simStored.outcome !== "STORED") {
      return;
    }

    await store.exceptions.create(
      createExceptionDraft({
        exceptionCode: "DUPLICATE_EVENT",
        paymentId: labPay,
        webhookEventId: labStored.record.id,
        provider: providerId("SYNTHETIC"),
        reason: "DUPLICATE_EVENT",
        detectedAt: NOW,
        correlationId: "corr-lab-purge",
      }),
    );
    await store.exceptions.create(
      createExceptionDraft({
        exceptionCode: "DUPLICATE_EVENT",
        paymentId: simPay,
        webhookEventId: simStored.record.id,
        provider: providerId("SYNTHETIC"),
        reason: "DUPLICATE_EVENT",
        detectedAt: NOW,
        correlationId: "corr-sim-purge",
      }),
    );

    const deleted = await store.purgeFailureLab();
    expect(deleted.webhooks).toBe(1);
    expect(deleted.exceptions).toBe(1);

    expect(await store.repository.findById(labStored.record.id)).toBeNull();
    expect(await store.repository.findById(simStored.record.id)).not.toBeNull();
    expect(await store.exceptions.listByPayment(labPay)).toHaveLength(0);
    expect(await store.exceptions.listByPayment(simPay)).toHaveLength(1);

    const client = new Client({ connectionString: TEST_URL });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('hookx.allow_failure_lab_purge', 'on', true)",
      );
      await expect(
        client.query("DELETE FROM exceptions WHERE payment_id = $1", [simPay]),
      ).rejects.toThrow(/cannot be deleted/i);
      await client.query("ROLLBACK");
    } finally {
      await client.end();
    }

    expect(await store.exceptions.listByPayment(simPay)).toHaveLength(1);
  });

  it("deletes Razorpay-adapter lab rows keyed by SYNTHETIC:pay:lab-*", async () => {
    const labPay = paymentId(
      "SYNTHETIC:pay:lab-cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    );
    const stored = await store.repository.store(
      syntheticPaymentAuthorized({
        provider: providerId("razorpay"),
        paymentId: labPay,
        externalEventId: "evt_lab-cccccccc-cccc-4ccc-8ccc-cccccccccccc-1",
        payloadHash: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      }),
    );
    expect(stored.outcome).toBe("STORED");
    if (stored.outcome !== "STORED") {
      return;
    }
    const deleted = await store.purgeFailureLab();
    expect(deleted.webhooks).toBeGreaterThanOrEqual(1);
    expect(await store.repository.findById(stored.record.id)).toBeNull();
  });
});
