import { describe, expect, it } from "vitest";
import { instant, paymentId } from "@hookx/domain";
import { syntheticPaymentAuthorized, syntheticPaymentCreated } from "@hookx/testkit";
import type { StoredWebhookEvent } from "./types.js";
import { selectWebhookList } from "./webhook-list.js";

function stored(
  event: StoredWebhookEvent["event"],
  id: string,
): StoredWebhookEvent {
  return {
    id,
    event,
    processingStatus: "PROCESSED",
    createdAt: event.receivedAt,
  };
}

describe("selectWebhookList", () => {
  it("filters by event type, payment id, and search text", () => {
    const created = stored(
      syntheticPaymentCreated({
        paymentId: paymentId("SYNTHETIC:pay:list-a"),
        externalEventId: "SYNTHETIC:evt:list-created",
        receivedAt: instant("2026-01-15T10:00:02.000Z"),
      }),
      "11111111-1111-4111-8111-111111111111",
    );
    const authorized = stored(
      syntheticPaymentAuthorized({
        paymentId: paymentId("SYNTHETIC:pay:list-a"),
        externalEventId: "SYNTHETIC:evt:list-authorized",
        receivedAt: instant("2026-01-15T10:00:03.000Z"),
      }),
      "22222222-2222-4222-8222-222222222222",
    );
    const other = stored(
      syntheticPaymentCreated({
        paymentId: paymentId("SYNTHETIC:pay:list-b"),
        externalEventId: "SYNTHETIC:evt:list-other",
        receivedAt: instant("2026-01-15T10:00:04.000Z"),
      }),
      "33333333-3333-4333-8333-333333333333",
    );
    const rows = [created, authorized, other];
    expect(selectWebhookList(rows, { eventType: "payment.authorized" })).toEqual([
      authorized,
    ]);
    expect(
      selectWebhookList(rows, { paymentId: paymentId("SYNTHETIC:pay:list-a") }),
    ).toHaveLength(2);
    expect(selectWebhookList(rows, { q: "list-other" })).toEqual([other]);
    expect(selectWebhookList(rows)[0]?.id).toBe(other.id);
  });
});
