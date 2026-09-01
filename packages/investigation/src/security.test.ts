import { describe, expect, it } from "vitest";
import { createException } from "@hookx/exceptions";
import { instant, paymentId, providerId } from "@hookx/domain";
import { exceptionViewFromRecord } from "./from-exception.js";
import { serializeInvestigationContext } from "./context.js";
import { sampleInvestigationContext } from "./sample-context.js";
import { INVESTIGATION_SYSTEM_PROMPT } from "./prompt.js";

describe("data minimization", () => {
  it("does not serialize payload hashes, signatures, or secrets", () => {
    const serialized = serializeInvestigationContext(sampleInvestigationContext());
    expect(serialized).not.toContain("payloadHash");
    expect(serialized).not.toContain("payload_hash");
    expect(serialized).not.toMatch(/signature/i);
    expect(serialized).not.toMatch(/api[_-]?key/i);
    expect(serialized).not.toContain("authorization");
  });

  it("strips secret metadata keys from the exception view", () => {
    const view = exceptionViewFromRecord(
      createException({
        exceptionId: "55555555-5555-4555-8555-555555555555",
        exceptionCode: "INVALID_SIGNATURE",
        paymentId: paymentId("SYNTHETIC:pay:inv-2"),
        webhookEventId: null,
        provider: providerId("SYNTHETIC"),
        reason: "INVALID_SIGNATURE",
        detectedAt: instant("2026-01-15T10:00:00.000Z"),
        correlationId: "corr-inv-2",
        metadata: {
          secret: "dev-only-not-a-real-secret",
          signature: "t=1,v1=abc",
          originalAuthoritative: true,
        },
      }),
    );
    expect(view.metadata["secret"]).toBeUndefined();
    expect(view.metadata["signature"]).toBeUndefined();
    expect(view.metadata["originalAuthoritative"]).toBe(true);
  });

  it("keeps privileged instructions free of payment data", () => {
    expect(INVESTIGATION_SYSTEM_PROMPT).toContain(
      "You are investigating a payment webhook exception",
    );
    expect(INVESTIGATION_SYSTEM_PROMPT).toContain(
      "You are not authorized to modify financial state",
    );
    expect(INVESTIGATION_SYSTEM_PROMPT).not.toContain("SYNTHETIC:pay:");
    expect(INVESTIGATION_SYSTEM_PROMPT).not.toContain("11111111-1111-4111-8111-111111111111");
  });
});
