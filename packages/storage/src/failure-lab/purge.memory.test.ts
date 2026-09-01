import { describe, expect, it } from "vitest";
import { instant, isoCurrencyCode, paymentId, providerId } from "@hookx/domain";
import { createExceptionDraft } from "@hookx/exceptions";
import { syntheticPaymentAuthorized, syntheticPaymentCreated } from "@hookx/testkit";
import { MemoryAuditRepository } from "../audit/memory-audit-repository.js";
import { MemoryExceptionRepository } from "../exceptions/memory-exception-repository.js";
import { MemoryInvestigationRepository } from "../investigations/memory-investigation-repository.js";
import { MemoryPaymentRepository } from "../payment/memory-payment-repository.js";
import { MemoryRetryRepository } from "../retry/memory-retry-repository.js";
import type { StoredWebhookEvent } from "../types.js";
import { isFailureLabPaymentId } from "./identity.js";
import { purgeMemoryFailureLab } from "./memory-purge.js";

const NOW = instant("2026-01-15T10:00:01.000Z");

describe("purgeMemoryFailureLab", () => {
  it("deletes lab rows and leaves simulator and non-synthetic rows", async () => {
    const webhooks: { readonly records: StoredWebhookEvent[] } = {
      records: [],
    };
    const payments = new MemoryPaymentRepository();
    const exceptions = new MemoryExceptionRepository();
    const audit = new MemoryAuditRepository();
    const retry = new MemoryRetryRepository();
    const investigations = new MemoryInvestigationRepository();

    const labPay = paymentId(
      "SYNTHETIC:pay:lab-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    const simPay = paymentId("SYNTHETIC:pay:sim-keep");
    const livePay = paymentId("pay_live_keep");

    webhooks.records.push(
      {
        id: "11111111-1111-4111-8111-111111111111",
        event: syntheticPaymentCreated({
          paymentId: labPay,
          externalEventId:
            "SYNTHETIC:evt:lab-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa-created",
        }),
        processingStatus: "PROCESSED",
        createdAt: NOW,
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        event: syntheticPaymentAuthorized({
          provider: providerId("razorpay"),
          paymentId: labPay,
          externalEventId: "evt_lab-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa-1",
        }),
        processingStatus: "PROCESSED",
        createdAt: NOW,
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        event: syntheticPaymentCreated({
          paymentId: simPay,
          externalEventId: "SYNTHETIC:evt:sim-keep-created",
        }),
        processingStatus: "PROCESSED",
        createdAt: NOW,
      },
    );

    await payments.upsert({
      provider: providerId("SYNTHETIC"),
      paymentId: labPay,
      state: "CREATED",
      amountMinor: 10000n,
      currency: isoCurrencyCode("INR"),
      lastOccurredAt: NOW,
      updatedAt: NOW,
    });
    await payments.upsert({
      provider: providerId("SYNTHETIC"),
      paymentId: simPay,
      state: "CREATED",
      amountMinor: 10000n,
      currency: isoCurrencyCode("INR"),
      lastOccurredAt: NOW,
      updatedAt: NOW,
    });
    await payments.upsert({
      provider: providerId("razorpay"),
      paymentId: livePay,
      state: "CAPTURED",
      amountMinor: 500n,
      currency: isoCurrencyCode("INR"),
      lastOccurredAt: NOW,
      updatedAt: NOW,
    });

    await exceptions.create(
      createExceptionDraft({
        exceptionCode: "DUPLICATE_EVENT",
        paymentId: labPay,
        webhookEventId: "11111111-1111-4111-8111-111111111111",
        provider: providerId("SYNTHETIC"),
        reason: "DUPLICATE_EVENT",
        detectedAt: NOW,
        correlationId: "corr-lab",
      }),
    );
    await exceptions.create(
      createExceptionDraft({
        exceptionCode: "DUPLICATE_EVENT",
        paymentId: simPay,
        webhookEventId: "22222222-2222-4222-8222-222222222222",
        provider: providerId("SYNTHETIC"),
        reason: "DUPLICATE_EVENT",
        detectedAt: NOW,
        correlationId: "corr-sim",
      }),
    );

    const deleted = purgeMemoryFailureLab({
      webhooks,
      payments,
      exceptions,
      audit,
      retry,
      investigations,
    });

    expect(deleted.webhooks).toBe(2);
    expect(deleted.payments).toBe(1);
    expect(deleted.exceptions).toBe(1);
    expect(webhooks.records).toHaveLength(1);
    expect(webhooks.records[0]?.event.paymentId).toBe(simPay);
    expect(payments.records.map((row) => row.paymentId).sort()).toEqual(
      [livePay, simPay].sort(),
    );
    expect(exceptions.records[0]?.paymentId).toBe(simPay);
    expect(isFailureLabPaymentId(simPay)).toBe(false);
  });
});
