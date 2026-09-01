import { describe, expect, it, expectTypeOf } from "vitest";
import { instant, paymentId, providerId } from "@hookx/domain";
import { createExceptionDraft } from "@hookx/exceptions";
import { MemoryExceptionRepository } from "./memory-exception-repository.js";
import type { ExceptionRepository } from "./repository.js";

const NOW = instant("2026-01-15T10:00:01.000Z");
const PAYMENT = paymentId("SYNTHETIC:pay:ex-mem");

type Forbidden = Extract<
  keyof ExceptionRepository,
  "delete" | "remove" | "deleteException"
>;

describe("ExceptionRepository", () => {
  it("does not expose delete", () => {
    expectTypeOf<Forbidden>().toEqualTypeOf<never>();
  });

  it("creates, lists, and suppresses duplicate identities", async () => {
    const repo = new MemoryExceptionRepository();
    const draft = createExceptionDraft({
      exceptionCode: "DUPLICATE_EVENT",
      paymentId: PAYMENT,
      webhookEventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      provider: providerId("SYNTHETIC"),
      reason: "DUPLICATE_EVENT",
      detectedAt: NOW,
      correlationId: "corr-1",
    });
    const first = await repo.create(draft);
    const second = await repo.create(draft);
    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    expect(second.record.exceptionId).toBe(first.record.exceptionId);
    expect(await repo.listByPayment(PAYMENT)).toHaveLength(1);
    expect(await repo.listOpen()).toHaveLength(1);
    expect(await repo.findById(first.record.exceptionId)).toEqual(first.record);
  });

  it("filters by payment id, webhook id, and free-text search", async () => {
    const repo = new MemoryExceptionRepository();
    const created = await repo.create(
      createExceptionDraft({
        exceptionCode: "CONFLICTING_EVENT",
        paymentId: PAYMENT,
        webhookEventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        provider: providerId("SYNTHETIC"),
        reason: "CONFLICTING_EVENT",
        detectedAt: NOW,
        correlationId: "corr-search",
      }),
    );
    await repo.create(
      createExceptionDraft({
        exceptionCode: "DUPLICATE_EVENT",
        paymentId: paymentId("SYNTHETIC:pay:other"),
        webhookEventId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        provider: providerId("SYNTHETIC"),
        reason: "DUPLICATE_EVENT",
        detectedAt: NOW,
        correlationId: "corr-search-2",
      }),
    );
    expect(await repo.list({ paymentId: PAYMENT })).toHaveLength(1);
    expect(
      await repo.list({ webhookEventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    ).toHaveLength(1);
    expect(await repo.list({ q: created.record.exceptionId })).toHaveLength(1);
    expect(await repo.list({ q: "SYNTHETIC:pay:ex-mem" })).toHaveLength(1);
    expect(
      await repo.list({
        detectedFrom: NOW,
        detectedTo: NOW,
      }),
    ).toHaveLength(2);
    expect(
      await repo.list({
        detectedFrom: instant("2026-01-16T00:00:00.000Z"),
      }),
    ).toHaveLength(0);
    expect(await repo.count({ paymentId: PAYMENT })).toBe(1);
    expect(await repo.count()).toBe(2);
  });

  it("keeps independent codes as separate rows", async () => {
    const repo = new MemoryExceptionRepository();
    const webhookEventId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await repo.create(
      createExceptionDraft({
        exceptionCode: "PROCESSING_FAILURE",
        paymentId: PAYMENT,
        webhookEventId,
        provider: providerId("SYNTHETIC"),
        reason: "TEMPORARY_UNAVAILABLE",
        detectedAt: NOW,
        correlationId: "corr-2",
      }),
    );
    await repo.create(
      createExceptionDraft({
        exceptionCode: "RETRY_EXHAUSTED",
        paymentId: PAYMENT,
        webhookEventId,
        provider: providerId("SYNTHETIC"),
        reason: "MAX_RETRIES_EXCEEDED",
        detectedAt: NOW,
        correlationId: "corr-2",
      }),
    );
    expect(await repo.listByPayment(PAYMENT)).toHaveLength(2);
  });

  it("updates status forward and refuses reverse movement", async () => {
    const repo = new MemoryExceptionRepository();
    const created = await repo.create(
      createExceptionDraft({
        exceptionCode: "OUT_OF_ORDER_EVENT",
        paymentId: PAYMENT,
        webhookEventId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        provider: providerId("SYNTHETIC"),
        reason: "AWAITING_PREREQUISITE",
        detectedAt: NOW,
        correlationId: "corr-3",
      }),
    );
    const acknowledged = await repo.updateStatus(
      created.record.exceptionId,
      "ACKNOWLEDGED",
    );
    expect(acknowledged.status).toBe("ACKNOWLEDGED");
    await expect(
      repo.updateStatus(created.record.exceptionId, "OPEN"),
    ).rejects.toThrow(/Cannot move exception/);
    expect("delete" in repo).toBe(false);
  });
});
