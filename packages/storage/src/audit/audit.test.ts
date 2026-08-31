import { describe, expect, it, expectTypeOf } from "vitest";
import { instant, paymentId, providerId } from "@hookx/domain";
import { AUDIT_REASON } from "@hookx/audit";
import { MemoryAuditRepository } from "./memory-audit-repository.js";
import type { AuditRepository } from "./repository.js";

const NOW = instant("2026-01-15T10:00:01.000Z");
const EARLIER = instant("2026-01-15T10:00:00.000Z");

type Forbidden = Extract<
  keyof AuditRepository,
  "update" | "delete" | "updateAuditEvent" | "deleteAuditEvent"
>;

describe("AuditRepository", () => {
  it("does not expose update or delete on the type", () => {
    expectTypeOf<Forbidden>().toEqualTypeOf<never>();
  });

  it("appends immutable events and lists them chronologically", async () => {
    const audit = new MemoryAuditRepository();
    const payment = paymentId("SYNTHETIC:pay:audit-1");
    const first = await audit.append({
      eventType: "WEBHOOK_RECEIVED",
      occurredAt: EARLIER,
      recordedAt: EARLIER,
      provider: providerId("SYNTHETIC"),
      paymentId: payment,
      webhookEventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      previousState: null,
      resultingState: null,
      actor: "WEBHOOK_PROVIDER",
      reason: AUDIT_REASON.ACCEPTED,
      correlationId: "corr-1",
    });
    const second = await audit.append({
      eventType: "PAYMENT_STATE_CHANGED",
      occurredAt: EARLIER,
      recordedAt: NOW,
      provider: providerId("SYNTHETIC"),
      paymentId: payment,
      webhookEventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      previousState: null,
      resultingState: "CREATED",
      actor: "SYSTEM",
      reason: AUDIT_REASON.ACCEPTED,
      correlationId: "corr-1",
    });
    const listed = await audit.listByPayment(payment);
    expect(listed.map((row) => row.auditEventId)).toEqual([
      first.auditEventId,
      second.auditEventId,
    ]);
    expect(listed[1]?.previousState).toBeNull();
    expect(listed[1]?.resultingState).toBe("CREATED");
    expect(listed[1]?.occurredAt).toBe(EARLIER);
    expect(listed[1]?.recordedAt).toBe(NOW);
    expect("update" in audit).toBe(false);
    expect("delete" in audit).toBe(false);
    expect("updateAuditEvent" in audit).toBe(false);
    expect("deleteAuditEvent" in audit).toBe(false);
  });

  it("filters by webhook and correlation id", async () => {
    const audit = new MemoryAuditRepository();
    await audit.append({
      eventType: "WEBHOOK_RECEIVED",
      occurredAt: NOW,
      recordedAt: NOW,
      provider: providerId("SYNTHETIC"),
      paymentId: paymentId("SYNTHETIC:pay:a"),
      webhookEventId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      previousState: null,
      resultingState: null,
      actor: "WEBHOOK_PROVIDER",
      reason: AUDIT_REASON.ACCEPTED,
      correlationId: "corr-a",
    });
    await audit.append({
      eventType: "WEBHOOK_REJECTED",
      occurredAt: NOW,
      recordedAt: NOW,
      provider: providerId("SYNTHETIC"),
      paymentId: null,
      webhookEventId: null,
      previousState: null,
      resultingState: null,
      actor: "SYSTEM",
      reason: AUDIT_REASON.INVALID_SIGNATURE,
      correlationId: "corr-b",
    });
    expect(
      await audit.listByWebhook("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
    ).toHaveLength(1);
    expect(await audit.listByCorrelationId("corr-b")).toHaveLength(1);
    expect(await audit.listByCorrelationId("corr-b")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "WEBHOOK_REJECTED" }),
      ]),
    );
  });
});
