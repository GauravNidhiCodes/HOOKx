import { describe, expect, it, expectTypeOf } from "vitest";
import { instant, isoCurrencyCode, paymentId, providerId } from "@hookx/domain";
import { AUDIT_REASON } from "@hookx/audit";
import { createExceptionDraft } from "@hookx/exceptions";
import { serializeInvestigationContext } from "@hookx/investigation";
import {
  MemoryAuditRepository,
  MemoryExceptionRepository,
  MemoryPaymentRepository,
  MemoryRetryRepository,
} from "@hookx/storage";
import { syntheticPaymentCreated } from "@hookx/testkit";
import { MemoryWebhookEventRepository } from "../test-support/memory-webhook-repository.js";
import {
  buildInvestigationContext,
  MAX_INVESTIGATION_WEBHOOKS,
  type InvestigationContextSources,
} from "./build-context.js";

const NOW = instant("2026-01-15T10:00:01.000Z");
const PAYMENT = paymentId("SYNTHETIC:pay:inv-ctx");
const PROVIDER = providerId("SYNTHETIC");

type ForbiddenRepo = Extract<
  keyof InvestigationContextSources["repository"],
  "store" | "markProcessed" | "markRejected" | "markConflict"
>;

describe("buildInvestigationContext", () => {
  it("only receives read methods on the webhook repository", () => {
    expectTypeOf<ForbiddenRepo>().toEqualTypeOf<never>();
  });

  it("minimizes fields and omits payload hashes", async () => {
    const repository = new MemoryWebhookEventRepository();
    const stored = await repository.store(
      syntheticPaymentCreated({
        paymentId: PAYMENT,
        externalEventId: "SYNTHETIC:evt:inv-ctx",
        payloadHash: "SYNTHETIC:hash:inv-ctx",
      }),
    );
    expect(stored.outcome).toBe("STORED");
    if (stored.outcome !== "STORED") {
      return;
    }
    const exceptions = new MemoryExceptionRepository();
    const created = await exceptions.create(
      createExceptionDraft({
        exceptionCode: "CONFLICTING_EVENT",
        paymentId: PAYMENT,
        webhookEventId: stored.record.id,
        provider: PROVIDER,
        reason: "CONFLICTING_EVENT",
        detectedAt: NOW,
        correlationId: "corr-inv-ctx",
        metadata: {
          secret: "dev-only-not-a-real-secret",
          originalAuthoritative: true,
        },
      }),
    );
    const payments = new MemoryPaymentRepository();
    await payments.upsert({
      provider: PROVIDER,
      paymentId: PAYMENT,
      state: "CREATED",
      amountMinor: 10000n,
      currency: isoCurrencyCode("INR"),
      lastOccurredAt: NOW,
      updatedAt: NOW,
    });
    const retry = new MemoryRetryRepository();
    await retry.ensurePending(stored.record.id, NOW);
    const audit = new MemoryAuditRepository();
    await audit.append({
      eventType: "PAYMENT_STATE_CHANGED",
      occurredAt: NOW,
      recordedAt: NOW,
      provider: PROVIDER,
      paymentId: PAYMENT,
      webhookEventId: stored.record.id,
      previousState: null,
      resultingState: "CREATED",
      actor: "SYSTEM",
      reason: AUDIT_REASON.ACCEPTED,
      correlationId: "corr-inv-ctx",
    });
    const context = await buildInvestigationContext(
      { repository, payments, retry, audit },
      created.record,
      NOW,
      "corr-inv-ctx-2",
    );
    expect(context.payment?.amountMinor).toBe("10000");
    expect(typeof context.payment?.amountMinor).toBe("string");
    expect(context.webhooks[0]?.amountMinor).toBe("10000");
    expect(context.webhooks[0]?.webhookEventId).toBe(stored.record.id);
    expect(context.retries).toHaveLength(1);
    expect(context.audit.some((row) => row.eventType === "PAYMENT_STATE_CHANGED")).toBe(
      true,
    );
    const serialized = serializeInvestigationContext(context);
    expect(serialized).not.toContain("payloadHash");
    expect(serialized).not.toContain("SYNTHETIC:hash:inv-ctx");
    expect(serialized).not.toContain("dev-only-not-a-real-secret");
    expect(context.exception.metadata["secret"]).toBeUndefined();
  });

  it("caps related webhooks and always keeps the exception webhook", async () => {
    const repository = new MemoryWebhookEventRepository();
    let pinnedId: string | null = null;
    for (let index = 0; index < MAX_INVESTIGATION_WEBHOOKS + 2; index += 1) {
      const stored = await repository.store(
        syntheticPaymentCreated({
          paymentId: PAYMENT,
          externalEventId: `SYNTHETIC:evt:cap-${String(index)}`,
          payloadHash: `SYNTHETIC:hash:cap-${String(index)}`,
          occurredAt: `2026-01-15T10:00:${String(index).padStart(2, "0")}.000Z`,
        }),
      );
      if (stored.outcome === "STORED" && index === MAX_INVESTIGATION_WEBHOOKS + 1) {
        pinnedId = stored.record.id;
      }
    }
    expect(pinnedId).not.toBeNull();
    const exceptions = new MemoryExceptionRepository();
    const created = await exceptions.create(
      createExceptionDraft({
        exceptionCode: "OUT_OF_ORDER_EVENT",
        paymentId: PAYMENT,
        webhookEventId: pinnedId,
        provider: PROVIDER,
        reason: "AWAITING_PREREQUISITE",
        detectedAt: NOW,
        correlationId: "corr-inv-cap",
      }),
    );
    const context = await buildInvestigationContext(
      { repository },
      created.record,
      NOW,
      "corr-inv-cap",
    );
    expect(context.webhooks.length).toBe(MAX_INVESTIGATION_WEBHOOKS);
    expect(
      context.webhooks.some((row) => row.webhookEventId === pinnedId),
    ).toBe(true);
  });
});
