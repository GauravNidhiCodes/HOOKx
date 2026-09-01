import { describe, expect, it } from "vitest";
import { instant } from "@hookx/domain";
import { bigintFromDatabase, toStoredWebhookEvent } from "./mapping.js";
import { StorageError } from "./errors.js";

describe("persistence mapping", () => {
  it("keeps amount_minor_units as bigint", () => {
    const amountMinorUnits = 9007199254740993n;
    const stored = toStoredWebhookEvent({
      id: "11111111-1111-1111-1111-111111111111",
      provider: "SYNTHETIC",
      externalEventId: "SYNTHETIC:evt:map",
      paymentId: "SYNTHETIC:pay:001",
      eventType: "payment.created",
      occurredAt: new Date("2026-01-15T10:00:00.000Z"),
      receivedAt: new Date("2026-01-15T10:00:01.000Z"),
      amountMinorUnits,
      currency: "INR",
      payloadHash: "SYNTHETIC:hash:map",
      processingStatus: "RECEIVED",
      createdAt: new Date("2026-01-15T10:00:02.000Z"),
    });

    expect(typeof stored.event.amountMinor).toBe("bigint");
    expect(stored.event.amountMinor).toBe(amountMinorUnits);
    expect(stored.event.occurredAt).toBe(instant("2026-01-15T10:00:00.000Z"));
    expect(stored.processingStatus).toBe("RECEIVED");
  });

  it("rejects non-integer amounts from the database", () => {
    expect(bigintFromDatabase(10000n)).toBe(10000n);
    expect(bigintFromDatabase("10000")).toBe(10000n);
    expect(() => bigintFromDatabase(10000)).toThrow(StorageError);
    expect(() => bigintFromDatabase(10.5)).toThrow(StorageError);
    expect(() => bigintFromDatabase("10000.0")).toThrow(StorageError);
    expect(() => bigintFromDatabase("-1")).toThrow(StorageError);
  });
});
