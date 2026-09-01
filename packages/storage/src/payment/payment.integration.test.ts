import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { instant, isoCurrencyCode, paymentId, providerId } from "@hookx/domain";
import { defaultTestDatabaseUrl } from "../config.js";
import {
  applyWebhookEventMigrations,
  openWebhookEventStore,
  recreateDatabase,
  type WebhookEventStore,
} from "../store.js";

function paymentTestDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const parsed = new URL(defaultTestDatabaseUrl(env));
  parsed.pathname = "/hookx_payment_test";
  return parsed.toString();
}

const TEST_URL = paymentTestDatabaseUrl(process.env);
const NOW = instant("2026-01-15T10:00:01.000Z");
const LATER = instant("2026-01-15T10:00:02.000Z");

describe("payment persistence", () => {
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
        `HOOKX payment integration tests require PostgreSQL. Cause: ${message}`,
        { cause: error },
      );
    }
  }, 30_000);

  afterAll(async () => {
    if (store !== undefined) {
      await store.close();
    }
  });

  it("upserts a payment record and retrieves it by identity", async () => {
    const provider = providerId("SYNTHETIC");
    const id = paymentId(`SYNTHETIC:pay:persist-${Date.now()}`);
    const created = await store.payments.upsert({
      provider,
      paymentId: id,
      state: "CREATED",
      amountMinor: 10000n,
      currency: isoCurrencyCode("INR"),
      lastOccurredAt: NOW,
      updatedAt: NOW,
    });
    expect(created.state).toBe("CREATED");
    const updated = await store.payments.upsert({
      ...created,
      state: "AUTHORIZED",
      lastOccurredAt: LATER,
      updatedAt: LATER,
    });
    expect(updated.state).toBe("AUTHORIZED");
    expect(await store.payments.get(provider, id)).toMatchObject({
      state: "AUTHORIZED",
      amountMinor: 10000n,
    });
    expect(await store.payments.getByPaymentId(id)).toMatchObject({
      provider,
      state: "AUTHORIZED",
    });
    const listed = await store.payments.list({ q: id });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.state).toBe("AUTHORIZED");
  });
});
