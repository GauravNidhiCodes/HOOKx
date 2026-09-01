import { describe, expect, it } from "vitest";
import { instant, isoCurrencyCode, paymentId, providerId } from "@hookx/domain";
import { MemoryPaymentRepository } from "./memory-payment-repository.js";
import type { StoredPayment } from "./types.js";

const NOW = instant("2026-01-15T10:00:02.000Z");
const EARLIER = instant("2026-01-15T10:00:01.000Z");

function payment(
  id: string,
  updatedAt: typeof NOW,
  state: StoredPayment["state"] = "CREATED",
): StoredPayment {
  return {
    provider: providerId("SYNTHETIC"),
    paymentId: paymentId(id),
    state,
    amountMinor: 10000n,
    currency: isoCurrencyCode("INR"),
    lastOccurredAt: updatedAt,
    updatedAt,
  };
}

describe("MemoryPaymentRepository.list", () => {
  it("returns payments newest first and filters by payment id", async () => {
    const repo = new MemoryPaymentRepository();
    await repo.upsert(payment("SYNTHETIC:pay:older", EARLIER));
    await repo.upsert(payment("SYNTHETIC:pay:newer", NOW, "CAPTURED"));
    const listed = await repo.list();
    expect(listed.map((row) => row.paymentId)).toEqual([
      "SYNTHETIC:pay:newer",
      "SYNTHETIC:pay:older",
    ]);
    const found = await repo.list({ q: "pay:newer" });
    expect(found).toHaveLength(1);
    expect(found[0]?.state).toBe("CAPTURED");
  });
});
