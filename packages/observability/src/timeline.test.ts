import { describe, expect, it } from "vitest";
import {
  composeIncidentTimeline,
  isSyntheticOrigin,
  type TimelineAudit,
  type TimelineException,
  type TimelineWebhook,
} from "./index.js";

const EXCEPTION: TimelineException = {
  exceptionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  exceptionCode: "CONFLICTING_EVENT",
  severity: "ERROR",
  status: "OPEN",
  paymentId: "SYNTHETIC:pay:tl",
  webhookEventId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  provider: "SYNTHETIC",
  reason: "CONFLICTING_EVENT",
  detectedAt: "2026-01-15T14:02:12.000Z",
  correlationId: "corr-tl-1",
};

const CREATED: TimelineWebhook = {
  webhookEventId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  occurredAt: "2026-01-15T14:02:11.000Z",
  receivedAt: "2026-01-15T14:02:11.100Z",
  eventType: "payment.created",
  provider: "SYNTHETIC",
  paymentId: "SYNTHETIC:pay:tl",
};

function audit(
  partial: Partial<TimelineAudit> &
    Pick<TimelineAudit, "auditEventId" | "eventType" | "recordedAt">,
): TimelineAudit {
  return {
    occurredAt: partial.occurredAt ?? partial.recordedAt,
    provider: "SYNTHETIC",
    paymentId: "SYNTHETIC:pay:tl",
    webhookEventId: CREATED.webhookEventId,
    previousState: null,
    resultingState: null,
    reason: "ACCEPTED",
    correlationId: "corr-tl-1",
    metadata: {},
    ...partial,
  };
}

describe("incident timeline construction", () => {
  it("expands persisted receipt into verify/normalize/persist without new clocks", () => {
    const composed = composeIncidentTimeline({
      exception: EXCEPTION,
      audit: [
        audit({
          auditEventId: "11111111-1111-4111-8111-111111111111",
          eventType: "WEBHOOK_RECEIVED",
          recordedAt: "2026-01-15T14:02:11.200Z",
          occurredAt: "2026-01-15T14:02:11.000Z",
        }),
        audit({
          auditEventId: "22222222-2222-4222-8222-222222222222",
          eventType: "WEBHOOK_CONFLICT",
          recordedAt: "2026-01-15T14:02:12.000Z",
          reason: "CONFLICTING_EVENT",
        }),
        audit({
          auditEventId: "33333333-3333-4333-8333-333333333333",
          eventType: "WEBHOOK_CONFLICT_DETECTED",
          recordedAt: "2026-01-15T14:02:12.100Z",
          reason: "CONFLICTING_EVENT",
          metadata: {
            exceptionId: EXCEPTION.exceptionId,
            exceptionCode: "CONFLICTING_EVENT",
          },
        }),
      ],
      webhooks: [CREATED],
      retry: null,
      deadLetter: null,
      investigation: {
        investigationId: "44444444-4444-4444-8444-444444444444",
        createdAt: "2026-01-15T14:02:15.000Z",
        correlationId: "corr-invest",
      },
    });
    expect(composed.incident.incidentId).toBe(EXCEPTION.exceptionId);
    expect(composed.incident.synthetic).toBe(true);
    expect(composed.items.map((row) => row.lifecycle)).toEqual([
      "WEBHOOK_RECEIVED",
      "SIGNATURE_VERIFIED",
      "WEBHOOK_NORMALIZED",
      "EVENT_PERSISTED",
      "PROCESSING_STARTED",
      "WEBHOOK_RECEIVED",
      "SIGNATURE_VERIFIED",
      "CONFLICT_DETECTED",
      "CONFLICT_DETECTED",
      "EXCEPTION_CREATED",
      "INVESTIGATION_AVAILABLE",
    ]);
    const created = composed.items.find((row) => row.lifecycle === "EXCEPTION_CREATED");
    expect(created?.exceptionId).toBe(EXCEPTION.exceptionId);
    expect(created?.eventId).toBe(CREATED.webhookEventId);
    expect(created?.paymentId).toBe(EXCEPTION.paymentId);
    expect(created?.correlationId).toBe("corr-tl-1");
  });

  it("orders by recorded/received clocks, not provider event time", () => {
    const capture: TimelineWebhook = {
      webhookEventId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      occurredAt: "2026-01-15T14:02:14.000Z",
      receivedAt: "2026-01-15T14:02:12.000Z",
      eventType: "payment.captured",
      provider: "SYNTHETIC",
      paymentId: "SYNTHETIC:pay:tl",
    };
    const authorized: TimelineWebhook = {
      webhookEventId: "99999999-9999-4999-8999-999999999999",
      occurredAt: "2026-01-15T14:02:13.000Z",
      receivedAt: "2026-01-15T14:02:15.000Z",
      eventType: "payment.authorized",
      provider: "SYNTHETIC",
      paymentId: "SYNTHETIC:pay:tl",
    };
    const composed = composeIncidentTimeline({
      exception: {
        ...EXCEPTION,
        exceptionCode: "OUT_OF_ORDER_EVENT",
        reason: "OUT_OF_ORDER_EVENT",
        webhookEventId: capture.webhookEventId,
      },
      audit: [
        audit({
          auditEventId: "11111111-1111-4111-8111-111111111111",
          eventType: "WEBHOOK_RECEIVED",
          recordedAt: "2026-01-15T14:02:11.200Z",
          webhookEventId: CREATED.webhookEventId,
          occurredAt: CREATED.occurredAt,
        }),
        audit({
          auditEventId: "22222222-2222-4222-8222-222222222222",
          eventType: "WEBHOOK_RECEIVED",
          recordedAt: "2026-01-15T14:02:12.200Z",
          webhookEventId: capture.webhookEventId,
          occurredAt: capture.occurredAt,
        }),
        audit({
          auditEventId: "33333333-3333-4333-8333-333333333333",
          eventType: "WEBHOOK_DELAYED",
          recordedAt: "2026-01-15T14:02:12.300Z",
          webhookEventId: capture.webhookEventId,
          occurredAt: capture.occurredAt,
          reason: "OUT_OF_ORDER",
          previousState: "CREATED",
          resultingState: "CREATED",
        }),
        audit({
          auditEventId: "44444444-4444-4444-8444-444444444444",
          eventType: "WEBHOOK_RECEIVED",
          recordedAt: "2026-01-15T14:02:15.200Z",
          webhookEventId: authorized.webhookEventId,
          occurredAt: authorized.occurredAt,
        }),
        audit({
          auditEventId: "55555555-5555-4555-8555-555555555555",
          eventType: "PAYMENT_STATE_CHANGED",
          recordedAt: "2026-01-15T14:02:15.400Z",
          webhookEventId: capture.webhookEventId,
          occurredAt: capture.occurredAt,
          previousState: "AUTHORIZED",
          resultingState: "CAPTURED",
        }),
      ],
      webhooks: [CREATED, capture, authorized],
      retry: null,
      deadLetter: null,
      investigation: null,
    });
    const delayed = composed.items.find((row) => row.lifecycle === "REPLAY_STARTED");
    const replayed = composed.items.find((row) => row.lifecycle === "REPLAY_COMPLETED");
    expect(delayed?.clock).toBe("2026-01-15T14:02:12.300Z");
    expect(delayed?.eventTime).toBe(capture.occurredAt);
    expect(delayed?.receivedTime).toBe(capture.receivedAt);
    expect(delayed?.replay?.trigger).toBe("OUT_OF_ORDER");
    expect(replayed?.clock).toBe("2026-01-15T14:02:15.400Z");
    expect(replayed?.replay?.replayId).toBe("55555555-5555-4555-8555-555555555555");
    const clocks = composed.items.map((row) => row.clock);
    expect([...clocks].sort()).toEqual(clocks);
  });

  it("marks replay completed on a later delivery after a delay", () => {
    const capture: TimelineWebhook = {
      webhookEventId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      occurredAt: "2026-01-15T14:02:14.000Z",
      receivedAt: "2026-01-15T14:02:12.000Z",
      eventType: "payment.captured",
      provider: "SYNTHETIC",
      paymentId: "SYNTHETIC:pay:tl",
    };
    const authorized: TimelineWebhook = {
      webhookEventId: "99999999-9999-4999-8999-999999999999",
      occurredAt: "2026-01-15T14:02:13.000Z",
      receivedAt: "2026-01-15T14:02:15.000Z",
      eventType: "payment.authorized",
      provider: "SYNTHETIC",
      paymentId: "SYNTHETIC:pay:tl",
    };
    const composed = composeIncidentTimeline({
      exception: {
        ...EXCEPTION,
        exceptionCode: "OUT_OF_ORDER_EVENT",
        reason: "OUT_OF_ORDER_EVENT",
        webhookEventId: capture.webhookEventId,
      },
      audit: [
        audit({
          auditEventId: "11111111-1111-4111-8111-111111111111",
          eventType: "WEBHOOK_DELAYED",
          recordedAt: "2026-01-15T14:02:12.300Z",
          webhookEventId: capture.webhookEventId,
          occurredAt: capture.occurredAt,
          reason: "OUT_OF_ORDER",
        }),
        audit({
          auditEventId: "22222222-2222-4222-8222-222222222222",
          eventType: "PAYMENT_STATE_CHANGED",
          recordedAt: "2026-01-15T14:02:15.400Z",
          webhookEventId: authorized.webhookEventId,
          occurredAt: authorized.occurredAt,
          previousState: "CREATED",
          resultingState: "AUTHORIZED",
        }),
      ],
      webhooks: [CREATED, capture, authorized],
      retry: null,
      deadLetter: null,
      investigation: null,
    });
    expect(
      composed.items.map((row) => row.lifecycle),
    ).toContain("REPLAY_COMPLETED");
    const completed = composed.items.find((row) => row.lifecycle === "REPLAY_COMPLETED");
    expect(completed?.replay?.replayId).toBe(
      "22222222-2222-4222-8222-222222222222",
    );
    expect(completed?.eventId).toBe(authorized.webhookEventId);
  });

  it("exposes retry attempt, schedule, attempt time, result, and class", () => {
    const composed = composeIncidentTimeline({
      exception: {
        ...EXCEPTION,
        exceptionCode: "PROCESSING_FAILURE",
        reason: "PROCESSING_FAILURE",
      },
      audit: [
        audit({
          auditEventId: "11111111-1111-4111-8111-111111111111",
          eventType: "RETRY_SCHEDULED",
          recordedAt: "2026-01-15T14:02:20.000Z",
          reason: "TEMPORARY_PROCESSING_FAILURE",
          metadata: { attempt: 1 },
        }),
        audit({
          auditEventId: "22222222-2222-4222-8222-222222222222",
          eventType: "RETRY_ATTEMPTED",
          recordedAt: "2026-01-15T14:03:18.000Z",
          reason: "TEMPORARY_PROCESSING_FAILURE",
          metadata: { attempt: 2 },
        }),
        audit({
          auditEventId: "33333333-3333-4333-8333-333333333333",
          eventType: "RETRY_SUCCEEDED",
          recordedAt: "2026-01-15T14:03:18.100Z",
          reason: "ACCEPTED",
          metadata: { attempt: 2 },
        }),
      ],
      webhooks: [CREATED],
      retry: {
        webhookEventId: CREATED.webhookEventId,
        attemptCount: 2,
        status: "SUCCEEDED",
        nextAttemptAt: null,
        lastErrorCode: "TEMPORARY_UNAVAILABLE",
        lastFailedAt: "2026-01-15T14:02:20.000Z",
      },
      deadLetter: null,
      investigation: null,
      classifyFailure: (code) =>
        code === "INVALID_TRANSITION" ? "NON_RETRYABLE" : "RETRYABLE",
    });
    const scheduled = composed.items.find((row) => row.lifecycle === "RETRY_SCHEDULED");
    const attempted = composed.items.find((row) => row.lifecycle === "RETRY_ATTEMPTED");
    const succeeded = composed.items.find((row) => row.lifecycle === "RETRY_SUCCEEDED");
    expect(scheduled?.retry).toMatchObject({
      attempt: 1,
      scheduledAt: null,
      result: "TEMPORARY_PROCESSING_FAILURE",
      failureClass: "RETRYABLE",
    });
    expect(attempted?.retry?.attemptedAt).toBe("2026-01-15T14:03:18.000Z");
    expect(attempted?.retry?.attempt).toBe(2);
    expect(succeeded?.retry?.result).toBe("ACCEPTED");
    expect(JSON.stringify(composed.items)).not.toContain("stack");
  });

  it("labels synthetic Razorpay fixtures unless the provider is opted live", () => {
    expect(isSyntheticOrigin("razorpay", "pay_fixture", [])).toBe(true);
    expect(isSyntheticOrigin("razorpay", "pay_fixture", ["razorpay"])).toBe(false);
    expect(isSyntheticOrigin("SYNTHETIC", "SYNTHETIC:pay:1", ["razorpay"])).toBe(
      true,
    );
  });

  it("returns an empty item list when nothing has been persisted", () => {
    const composed = composeIncidentTimeline({
      exception: EXCEPTION,
      audit: [],
      webhooks: [],
      retry: null,
      deadLetter: null,
      investigation: null,
    });
    expect(composed.items).toEqual([]);
    expect(composed.total).toBe(0);
    expect(composed.incident.exceptionCode).toBe("CONFLICTING_EVENT");
  });

  it("does not put secrets in timeline items", () => {
    const composed = composeIncidentTimeline({
      exception: EXCEPTION,
      audit: [
        audit({
          auditEventId: "11111111-1111-4111-8111-111111111111",
          eventType: "WEBHOOK_RECEIVED",
          recordedAt: "2026-01-15T14:02:11.200Z",
          metadata: { secret: "dev-only-webhook-secret", signature: "aabb" },
        }),
      ],
      webhooks: [CREATED],
      retry: null,
      deadLetter: null,
      investigation: null,
    });
    const serialized = JSON.stringify(composed);
    expect(serialized).not.toContain("dev-only-webhook-secret");
    expect(serialized).not.toContain("aabb");
    expect(serialized).not.toContain("payload");
  });
});
