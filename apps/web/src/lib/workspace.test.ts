import { describe, expect, it } from "vitest";
import { buildReplay } from "./replay";
import { filterEvents } from "./event-filter";
import { processingFromAudit } from "./processing";
import { hasRetryHistory, retryHistoryFromAudit } from "./retry-history";
import { stateHistoryFromAudit } from "./state-history";
import {
  outOfOrderWebhooks,
  sampleAudit,
  sampleRetryAudit,
  sampleWebhooks,
} from "../test-support/fixtures";

describe("stateHistoryFromAudit", () => {
  it("renders backend PAYMENT_STATE_CHANGED rows in recorded order", () => {
    const history = stateHistoryFromAudit(sampleAudit, outOfOrderWebhooks);
    expect(history.map((row) => row.nextState)).toEqual([
      "CREATED",
      "AUTHORIZED",
      "CAPTURED",
    ]);
    expect(history[0]?.previousState).toBeNull();
    expect(history[2]?.eventType).toBe("payment.captured");
  });

  it("keeps audit list order when recordedAt collides", () => {
    const collided = sampleAudit
      .filter((row) => row.eventType === "PAYMENT_STATE_CHANGED")
      .map((row, index) => ({
        ...row,
        recordedAt: "2026-01-15T10:00:01.000Z",
        auditEventId:
          index === 0
            ? "ffffffff-ffff-4fff-8fff-ffffffffffff"
            : index === 1
              ? "00000000-0000-4000-8000-000000000000"
              : "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }));
    expect(
      stateHistoryFromAudit(collided, outOfOrderWebhooks).map((row) => row.nextState),
    ).toEqual(["CREATED", "AUTHORIZED", "CAPTURED"]);
  });
});

describe("buildReplay", () => {
  it("separates received order from occurred order", () => {
    const replay = buildReplay(outOfOrderWebhooks, "CAPTURED", sampleAudit);
    expect(replay?.outOfOrder).toBe(true);
    expect(replay?.originalDelivery.map((row) => row.eventType)).toEqual([
      "payment.created",
      "payment.captured",
      "payment.authorized",
    ]);
    expect(replay?.logicalOrder.map((row) => row.eventType)).toEqual([
      "payment.created",
      "payment.authorized",
      "payment.captured",
    ]);
    expect(replay?.finalState).toBe("CAPTURED");
  });

  it("uses WEBHOOK_RECEIVED audit order when receivedAt collides", () => {
    const sameReceived = outOfOrderWebhooks.map((row) => ({
      ...row,
      receivedAt: "2026-01-15T14:02:12.000Z",
    }));
    const receiptAudit = sameReceived.map((row, index) => ({
      auditEventId:
        index === 0
          ? "ffffffff-ffff-4fff-8fff-ffffffffffff"
          : index === 1
            ? "00000000-0000-4000-8000-000000000000"
            : "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      eventType: "WEBHOOK_RECEIVED",
      occurredAt: row.occurredAt,
      recordedAt: "2026-01-15T14:02:12.000Z",
      provider: "SYNTHETIC",
      paymentId: row.paymentId,
      webhookEventId: row.webhookEventId,
      previousState: null,
      resultingState: null,
      actor: "WEBHOOK_PROVIDER",
      reason: "ACCEPTED",
      correlationId: `corr-${String(index)}`,
      metadata: {},
    }));
    const replay = buildReplay(sameReceived, "CAPTURED", [
      ...receiptAudit,
      ...sampleAudit.filter((row) => row.eventType === "WEBHOOK_DELAYED"),
    ]);
    expect(replay?.originalDelivery.map((row) => row.eventType)).toEqual([
      "payment.created",
      "payment.captured",
      "payment.authorized",
    ]);
  });

  it("omits replay when delivery matches occurred order and nothing was delayed", () => {
    expect(buildReplay(sampleWebhooks, "CAPTURED", [])).toBeNull();
  });
});

describe("processingFromAudit", () => {
  it("maps stored audit to processing fields", () => {
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
});

describe("retryHistoryFromAudit", () => {
  it("maps retry audit to attempt results without stack traces", () => {
    const attempts = retryHistoryFromAudit(sampleRetryAudit);
    expect(attempts.map((row) => row.result)).toEqual([
      "TEMPORARY FAILURE",
      "ATTEMPTED",
      "SUCCESS",
    ]);
    expect(attempts[0]?.attempt).toBe(1);
    expect(attempts[0]?.failureClass).toBe("TEMPORARY_PROCESSING_FAILURE");
  });
});

describe("hasRetryHistory", () => {
  it("ignores a first-attempt success retry row", () => {
    expect(
      hasRetryHistory(
        {
          webhookEventId: "x",
          attemptCount: 1,
          maxAttempts: 5,
          status: "SUCCEEDED",
          nextAttemptAt: null,
          lastErrorCode: null,
          lastFailedAt: null,
        },
        null,
        [],
      ),
    ).toBe(false);
  });
});

describe("filterEvents", () => {
  it("filters by type, status, and external id", () => {
    expect(
      filterEvents(sampleWebhooks, { eventType: "payment.created" }),
    ).toHaveLength(1);
    expect(
      filterEvents(sampleWebhooks, { processingStatus: "PROCESSED" }),
    ).toHaveLength(2);
    expect(
      filterEvents(sampleWebhooks, { q: "ui-captured" }),
    ).toHaveLength(1);
  });
});
