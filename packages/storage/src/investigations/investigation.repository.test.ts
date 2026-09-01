import { describe, expect, it, expectTypeOf } from "vitest";
import { instant } from "@hookx/domain";
import { createExceptionDraft } from "@hookx/exceptions";
import { createInvestigationResult } from "@hookx/investigation";
import { MemoryExceptionRepository } from "../exceptions/memory-exception-repository.js";
import { MemoryInvestigationRepository } from "./memory-investigation-repository.js";
import type { InvestigationRepository } from "./repository.js";

const NOW = instant("2026-01-15T10:00:01.000Z");
const LATER = instant("2026-01-15T10:00:02.000Z");

type Forbidden = Extract<
  keyof InvestigationRepository,
  "update" | "delete" | "remove" | "upsert" | "updateStatus"
>;

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

describe("InvestigationRepository", () => {
  it("does not expose mutation besides append-only create", () => {
    expectTypeOf<Forbidden>().toEqualTypeOf<never>();
  });

  it("appends investigations without replacing earlier rows", async () => {
    const exceptions = new MemoryExceptionRepository();
    const created = await exceptions.create(
      createExceptionDraft({
        exceptionCode: "CONFLICTING_EVENT",
        paymentId: null,
        webhookEventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        provider: null,
        reason: "CONFLICTING_EVENT",
        detectedAt: NOW,
        correlationId: "corr-inv-mem-1",
      }),
    );
    const repo = new MemoryInvestigationRepository();
    const first = await repo.create({
      exceptionId: created.record.exceptionId,
      investigator: "stub",
      modelId: null,
      promptVersion: "investigation-v1",
      result: advisoryResult(created.record.exceptionId),
      createdAt: NOW,
      correlationId: "corr-inv-mem-1",
    });
    const second = await repo.create({
      exceptionId: created.record.exceptionId,
      investigator: "unavailable",
      modelId: null,
      promptVersion: "investigation-v1",
      result: advisoryResult(created.record.exceptionId),
      createdAt: LATER,
      correlationId: "corr-inv-mem-2",
    });
    expect(first.investigationId).not.toBe(second.investigationId);
    expect(await repo.listByException(created.record.exceptionId)).toHaveLength(2);
    expect(
      (await repo.findLatestByExceptionId(created.record.exceptionId))
        ?.investigationId,
    ).toBe(second.investigationId);
    expect(await exceptions.findById(created.record.exceptionId)).toMatchObject({
      exceptionCode: "CONFLICTING_EVENT",
      status: "OPEN",
    });
    expect("delete" in repo).toBe(false);
    expect("update" in repo).toBe(false);
  });
});
