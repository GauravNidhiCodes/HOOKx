import { describe, expect, it } from "vitest";
import { eventIdentityKey } from "@hookx/webhook";
import {
  syntheticPaymentAuthorized,
  syntheticPaymentCaptured,
  syntheticPaymentCreated,
} from "@hookx/testkit";
import { compareWebhookEvents, orderWebhookEvents } from "./order-events.js";

const SAME_INSTANT = "2026-01-15T10:00:00.000Z";

describe("compareWebhookEvents / orderWebhookEvents", () => {
  it("orders by occurredAt, not receivedAt or input position", () => {
    const later = syntheticPaymentAuthorized({
      occurredAt: "2026-01-15T10:00:02.000Z",
      receivedAt: "2026-01-15T09:00:00.000Z",
    });
    const earlier = syntheticPaymentCreated({
      occurredAt: "2026-01-15T10:00:00.000Z",
      receivedAt: "2026-01-15T11:00:00.000Z",
    });

    const ordered = orderWebhookEvents([later, earlier]);
    expect(ordered.map((event) => event.eventType)).toEqual([
      "payment.created",
      "payment.authorized",
    ]);
    expect(compareWebhookEvents(earlier, later)).toBe(-1);
  });

  it("breaks identical occurredAt ties with webhook identity, not arrival time", () => {
    const created = syntheticPaymentCreated({
      occurredAt: SAME_INSTANT,
      receivedAt: "2026-01-15T12:00:00.000Z",
    });
    const authorized = syntheticPaymentAuthorized({
      occurredAt: SAME_INSTANT,
      receivedAt: "2026-01-15T08:00:00.000Z",
    });

    expect(created.occurredAt).toBe(authorized.occurredAt);
    expect(eventIdentityKey(authorized) < eventIdentityKey(created)).toBe(true);

    const forward = orderWebhookEvents([created, authorized]);
    const reverse = orderWebhookEvents([authorized, created]);
    expect(forward.map((event) => event.externalEventId)).toEqual(
      reverse.map((event) => event.externalEventId),
    );
    expect(forward[0]?.eventType).toBe("payment.authorized");
    expect(forward[1]?.eventType).toBe("payment.created");
  });

  it("does not mutate the input array", () => {
    const created = syntheticPaymentCreated({
      occurredAt: "2026-01-15T10:00:02.000Z",
    });
    const captured = syntheticPaymentCaptured({
      occurredAt: "2026-01-15T10:00:00.000Z",
    });
    const input = [created, captured];
    const copy = [...input];
    orderWebhookEvents(input);
    expect(input).toEqual(copy);
  });
});
