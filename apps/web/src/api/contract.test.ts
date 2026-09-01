import { instant, paymentId, providerId } from "@hookx/domain";
import { createException, toPublicException } from "@hookx/exceptions";
import { createInvestigationResult } from "@hookx/investigation";
import { describe, expect, it } from "vitest";
import {
  INVESTIGATION_RESULT_KEYS,
  PUBLIC_EXCEPTION_KEYS,
} from "./types";

describe("operator API contracts", () => {
  it("keeps PublicException keys aligned with toPublicException", () => {
    const record = createException({
      exceptionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      exceptionCode: "CONFLICTING_EVENT",
      paymentId: paymentId("SYNTHETIC:pay:contract"),
      webhookEventId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      provider: providerId("SYNTHETIC"),
      reason: "CONFLICTING_EVENT",
      detectedAt: instant("2026-01-15T10:00:01.000Z"),
      correlationId: "corr-contract",
    });
    expect(Object.keys(toPublicException(record)).sort()).toEqual(
      [...PUBLIC_EXCEPTION_KEYS].sort(),
    );
  });

  it("keeps investigation result keys aligned with the shared package", () => {
    const result = createInvestigationResult({
      summary: "Advisory explanation of a stored exception.",
      facts: ["The exception code is CONFLICTING_EVENT."],
      evidence: [
        {
          sourceType: "EXCEPTION",
          sourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          fact: "Deterministic engine classified CONFLICTING_EVENT.",
        },
      ],
      incidentType: "CONFLICTING_EVENT",
      severity: "ERROR",
      rootCause: "The provider may have retried an event identity with a different payload.",
      likelyCause: "The provider may have retried an event identity with a different payload.",
      impact: "Payment state remained unchanged according to the supplied projection.",
      recommendedAction: {
        code: "INVESTIGATE_CONFLICTING_PAYLOAD",
        detail: "Compare stored and rejected deliveries. Do not mutate payment state.",
      },
      confidence: "LOW",
      confidenceReason: "Only the exception record and a single citation were supplied.",
      limitations: ["Investigation is advisory."],
    });
    expect(Object.keys(result).sort()).toEqual([...INVESTIGATION_RESULT_KEYS].sort());
  });
});
