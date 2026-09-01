import { describe, expect, it } from "vitest";
import { processingFromAudit } from "./processing.js";

describe("processingFromAudit", () => {
  it("maps stored receipt and delay without exposing secrets", () => {
    expect(
      processingFromAudit("PROCESSED", [
        { eventType: "WEBHOOK_RECEIVED" },
        { eventType: "WEBHOOK_DELAYED" },
      ]),
    ).toEqual({
      verification: "PASSED",
      normalization: "NORMALIZED",
      idempotency: "STORED",
      decision: "DELAYED",
    });
  });

  it("maps duplicate and conflict audit types", () => {
    expect(
      processingFromAudit("PROCESSED", [{ eventType: "WEBHOOK_DUPLICATE" }])
        .idempotency,
    ).toBe("DUPLICATE");
    expect(
      processingFromAudit("CONFLICT", [{ eventType: "WEBHOOK_CONFLICT" }]),
    ).toMatchObject({
      idempotency: "CONFLICT",
      decision: "CONFLICT",
    });
  });
});
