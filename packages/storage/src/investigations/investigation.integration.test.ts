import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { instant, providerId } from "@hookx/domain";
import { createExceptionDraft } from "@hookx/exceptions";
import { createInvestigationResult } from "@hookx/investigation";
import { syntheticPaymentCreated } from "@hookx/testkit";
import { defaultTestDatabaseUrl } from "../config.js";
import {
  applyWebhookEventMigrations,
  openWebhookEventStore,
  recreateDatabase,
  type WebhookEventStore,
} from "../store.js";

function investigationTestDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const parsed = new URL(defaultTestDatabaseUrl(env));
  parsed.pathname = "/hookx_investigation_test";
  return parsed.toString();
}

const TEST_URL = investigationTestDatabaseUrl(process.env);
const NOW = instant("2026-01-15T10:00:01.000Z");
const LATER = instant("2026-01-15T10:00:02.000Z");

function advisoryResult(exceptionId: string) {
  return createInvestigationResult({
    summary: "Advisory investigation. Financial state was not modified.",
    facts: ["Exception classification is owned by the deterministic engine."],
    evidence: [
      {
        sourceType: "EXCEPTION",
        sourceId: exceptionId,
        fact: "Stored exception remains classified by detection rules.",
      },
    ],
    likelyCause: "The provider may have delivered a conflicting payload.",
    incidentType: "CONFLICTING_EVENT",
    severity: "ERROR",
    rootCause: "The provider may have delivered a conflicting payload.",
    impact: "Payment state was not modified by this advisory record.",
    recommendedAction: {
      code: "INVESTIGATE_CONFLICTING_PAYLOAD",
      detail: "Review the stored event. Advisory only.",
    },
    confidence: "MEDIUM",
    confidenceReason: "Only the stored exception citation is attached to this record.",
    limitations: [
      "This record is advisory.",
      "Classification remains the deterministic exception engine.",
    ],
  });
}

describe("investigation persistence", () => {
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
        `HOOKX investigation integration tests require PostgreSQL. Cause: ${message}`,
        { cause: error },
      );
    }
  }, 30_000);

  afterAll(async () => {
    if (store !== undefined) {
      await store.close();
    }
  });

  it("persists advisory rows without changing the exception or forbidding history rewrite", async () => {
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
    const created = await store.exceptions.create(
      createExceptionDraft({
        exceptionCode: "CONFLICTING_EVENT",
        paymentId: stored.record.event.paymentId,
        webhookEventId: stored.record.id,
        provider: providerId("SYNTHETIC"),
        reason: "CONFLICTING_EVENT",
        detectedAt: NOW,
        correlationId: `corr-${randomUUID()}`,
      }),
    );
    const exceptionBefore = created.record;
    const first = await store.investigations.create({
      exceptionId: exceptionBefore.exceptionId,
      investigator: "stub",
      modelId: null,
      promptVersion: "investigation-v1",
      result: advisoryResult(exceptionBefore.exceptionId),
      createdAt: NOW,
      correlationId: `corr-${randomUUID()}`,
    });
    const second = await store.investigations.create({
      exceptionId: exceptionBefore.exceptionId,
      investigator: "unavailable",
      modelId: null,
      promptVersion: "investigation-v1",
      result: advisoryResult(exceptionBefore.exceptionId),
      createdAt: LATER,
      correlationId: `corr-${randomUUID()}`,
    });
    expect(
      (await store.investigations.findLatestByExceptionId(
        exceptionBefore.exceptionId,
      ))?.investigationId,
    ).toBe(second.investigationId);
    expect(
      await store.exceptions.findById(exceptionBefore.exceptionId),
    ).toEqual(exceptionBefore);
    expect(first.investigationId).not.toBe(second.investigationId);

    const client = new Client({ connectionString: TEST_URL });
    await client.connect();
    try {
      await expect(
        client.query("DELETE FROM investigations WHERE id = $1", [
          first.investigationId,
        ]),
      ).rejects.toThrow(/cannot be deleted/i);
      await expect(
        client.query(
          "UPDATE investigations SET investigator = $1 WHERE id = $2",
          ["openai", first.investigationId],
        ),
      ).rejects.toThrow(/cannot be updated/i);
    } finally {
      await client.end();
    }
  });

  it("does not leak drizzle column names from the repository", async () => {
    const listed = await store.exceptions.list({
      provider: providerId("SYNTHETIC"),
    });
    const latest = await store.investigations.findLatestByExceptionId(
      listed[0]?.exceptionId ?? "",
    );
    expect(latest).toHaveProperty("investigationId");
    expect(latest).not.toHaveProperty("exception_id");
    expect(latest).not.toHaveProperty("prompt_version");
  });
});
