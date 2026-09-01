import { describe, expect, it } from "vitest";
import { instant } from "@hookx/domain";
import {
  SYNTHETIC_EVENT_NAME,
  SYNTHETIC_EVENT_TYPE_MAP,
  WebhookError,
  createWebhookIdentity,
  eventIdentityKey,
  getProviderAdapter,
  identitiesEqual,
  normalizedEventKeys,
  numericAmountSyntheticPayload,
  parseAmountMinorString,
  syntheticDeclinedPayload,
  syntheticHoldPayload,
  syntheticOpenedPayload,
  syntheticProviderAdapter,
  syntheticReturnPayload,
  syntheticSettledPayload,
  duplicateConflictingSyntheticPayloads,
  duplicateIdenticalSyntheticPayloads,
  invalidAmountSyntheticPayload,
  invalidCurrencySyntheticPayload,
  invalidTimestampSyntheticPayload,
  malformedSyntheticPayload,
  unknownSyntheticEventPayload,
} from "./index.js";

const RECEIVED_AT = instant("2026-01-15T10:00:01.000Z");

function expectWebhookError(code: string, run: () => void): void {
  try {
    run();
    throw new Error(`expected WebhookError ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(WebhookError);
    if (error instanceof WebhookError) {
      expect(error.code).toBe(code);
      expect(error.message).not.toContain("sk_live");
      expect(error.message).not.toContain("{");
    }
  }
}

describe("valid payload normalization", () => {
  it("normalizes a synthetic envelope into the provider-agnostic event", () => {
    const payload = syntheticOpenedPayload();
    const event = syntheticProviderAdapter.normalize(payload, {
      receivedAt: RECEIVED_AT,
    });

    expect(event.provider).toBe("SYNTHETIC");
    expect(event.externalEventId).toBe(payload.event_ref);
    expect(event.paymentId).toBe(payload.entity.payment_ref);
    expect(event.eventType).toBe("payment.created");
    expect(event.occurredAt).toBe("2026-01-15T10:00:00.000Z");
    expect(event.receivedAt).toBe(RECEIVED_AT);
    expect(Object.keys(event).sort()).toEqual([...normalizedEventKeys()].sort());
  });

  it("produces the same normalized event for the same payload", () => {
    const payload = syntheticHoldPayload();
    const first = syntheticProviderAdapter.normalize(payload, {
      receivedAt: RECEIVED_AT,
    });
    const second = syntheticProviderAdapter.normalize(payload, {
      receivedAt: RECEIVED_AT,
    });
    expect(first).toEqual(second);
  });
});

describe("provider and event mapping", () => {
  it("maps synthetic kinds onto internal event types", () => {
    const cases = [
      [syntheticOpenedPayload(), "payment.created"],
      [syntheticHoldPayload(), "payment.authorized"],
      [syntheticSettledPayload(), "payment.captured"],
      [syntheticDeclinedPayload(), "payment.failed"],
      [syntheticReturnPayload(), "refund.created"],
    ] as const;

    for (const [payload, eventType] of cases) {
      const event = syntheticProviderAdapter.normalize(payload, {
        receivedAt: RECEIVED_AT,
      });
      expect(event.eventType).toBe(eventType);
      expect(event.provider).toBe("SYNTHETIC");
    }
  });

  it("keeps the mapping table explicit", () => {
    expect(SYNTHETIC_EVENT_TYPE_MAP[SYNTHETIC_EVENT_NAME.PAYMENT_OPENED]).toBe(
      "payment.created",
    );
    expect(SYNTHETIC_EVENT_TYPE_MAP[SYNTHETIC_EVENT_NAME.PAYMENT_HOLD]).toBe(
      "payment.authorized",
    );
    expect(SYNTHETIC_EVENT_TYPE_MAP[SYNTHETIC_EVENT_NAME.PAYMENT_SETTLED]).toBe(
      "payment.captured",
    );
    expect(SYNTHETIC_EVENT_TYPE_MAP[SYNTHETIC_EVENT_NAME.PAYMENT_DECLINED]).toBe(
      "payment.failed",
    );
    expect(SYNTHETIC_EVENT_TYPE_MAP[SYNTHETIC_EVENT_NAME.PAYMENT_RETURN]).toBe(
      "refund.created",
    );
  });
});

describe("money and currency", () => {
  it("parses minor-unit strings into bigint without Number", () => {
    const amount = parseAmountMinorString("10000");
    expect(amount).toBe(10000n);
    expect(typeof amount).toBe("bigint");
    expect(typeof amount === "bigint").toBe(true);
  });

  it("preserves bigint on the normalized event", () => {
    const event = syntheticProviderAdapter.normalize(syntheticOpenedPayload(), {
      receivedAt: RECEIVED_AT,
    });
    expect(event.amountMinor).toBe(10000n);
    expect(typeof event.amountMinor).toBe("bigint");
  });

  it("normalizes currency casing", () => {
    const event = syntheticProviderAdapter.normalize(
      syntheticOpenedPayload({ ccy: "inr" }),
      { receivedAt: RECEIVED_AT },
    );
    expect(event.currency).toBe("INR");
  });

  it("rejects numeric amounts instead of coercing them", () => {
    expectWebhookError("INVALID_AMOUNT", () => {
      syntheticProviderAdapter.normalize(numericAmountSyntheticPayload(), {
        receivedAt: RECEIVED_AT,
      });
    });
  });
});

describe("timestamp preservation", () => {
  it("keeps occurredAt from the provider and uses supplied receivedAt", () => {
    const event = syntheticProviderAdapter.normalize(
      syntheticOpenedPayload({ booked_at: "2024-03-01T00:00:00Z" }),
      { receivedAt: instant("2024-03-01T00:00:05.000Z") },
    );
    expect(event.occurredAt).toBe("2024-03-01T00:00:00.000Z");
    expect(event.receivedAt).toBe("2024-03-01T00:00:05.000Z");
  });

  it("accepts a UTC offset of zero as UTC", () => {
    const event = syntheticProviderAdapter.normalize(
      syntheticOpenedPayload({ booked_at: "2026-01-15T10:00:00+00:00" }),
      { receivedAt: RECEIVED_AT },
    );
    expect(event.occurredAt).toBe("2026-01-15T10:00:00.000Z");
  });
});

describe("event identity", () => {
  it("is deterministic for provider + externalEventId", () => {
    const payload = syntheticOpenedPayload();
    const event = syntheticProviderAdapter.normalize(payload, {
      receivedAt: RECEIVED_AT,
    });
    const identity = createWebhookIdentity("SYNTHETIC", payload.event_ref);
    expect(eventIdentityKey(event)).toBe(
      JSON.stringify({
        provider: identity.provider,
        externalEventId: identity.externalEventId,
      }),
    );
    expect(
      identitiesEqual(syntheticProviderAdapter.identify(payload), identity),
    ).toBe(true);
  });
});

describe("payload hashing", () => {
  it("is deterministic for the same material payload", () => {
    const payload = syntheticOpenedPayload();
    const first = syntheticProviderAdapter.normalize(payload, {
      receivedAt: RECEIVED_AT,
    });
    const second = syntheticProviderAdapter.normalize(payload, {
      receivedAt: instant("2026-12-01T00:00:00.000Z"),
    });
    expect(first.payloadHash).toBe(second.payloadHash);
    expect(first.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when a meaningful field changes under the same external ID", () => {
    const [original, conflicting] = duplicateConflictingSyntheticPayloads();
    const first = syntheticProviderAdapter.normalize(original, {
      receivedAt: RECEIVED_AT,
    });
    const second = syntheticProviderAdapter.normalize(conflicting, {
      receivedAt: RECEIVED_AT,
    });
    expect(eventIdentityKey(first)).toBe(eventIdentityKey(second));
    expect(first.payloadHash).not.toBe(second.payloadHash);
  });

  it("does not use the hash as event identity", () => {
    const [left, right] = duplicateIdenticalSyntheticPayloads();
    const first = syntheticProviderAdapter.normalize(left, {
      receivedAt: RECEIVED_AT,
    });
    const second = syntheticProviderAdapter.normalize(right, {
      receivedAt: RECEIVED_AT,
    });
    expect(first.payloadHash).toBe(second.payloadHash);
    expect(eventIdentityKey(first)).toBe(eventIdentityKey(second));
    expect(eventIdentityKey(first)).not.toBe(first.payloadHash);
  });
});

describe("validation", () => {
  it("rejects a malformed payload", () => {
    expectWebhookError("INVALID_PAYLOAD", () => {
      syntheticProviderAdapter.normalize(malformedSyntheticPayload(), {
        receivedAt: RECEIVED_AT,
      });
    });
  });

  it("rejects an unsupported event type", () => {
    expectWebhookError("UNSUPPORTED_EVENT", () => {
      syntheticProviderAdapter.normalize(unknownSyntheticEventPayload(), {
        receivedAt: RECEIVED_AT,
      });
    });
  });

  it("rejects invalid amount, currency, and timestamp", () => {
    expectWebhookError("INVALID_AMOUNT", () => {
      syntheticProviderAdapter.normalize(invalidAmountSyntheticPayload(), {
        receivedAt: RECEIVED_AT,
      });
    });
    expectWebhookError("INVALID_CURRENCY", () => {
      syntheticProviderAdapter.normalize(invalidCurrencySyntheticPayload(), {
        receivedAt: RECEIVED_AT,
      });
    });
    expectWebhookError("INVALID_TIMESTAMP", () => {
      syntheticProviderAdapter.normalize(invalidTimestampSyntheticPayload(), {
        receivedAt: RECEIVED_AT,
      });
    });
  });

  it("rejects missing identifiers", () => {
    expectWebhookError("MISSING_EXTERNAL_ID", () => {
      syntheticProviderAdapter.normalize(
        syntheticOpenedPayload({ event_ref: "" }),
        { receivedAt: RECEIVED_AT },
      );
    });
    expectWebhookError("MISSING_PAYMENT_ID", () => {
      syntheticProviderAdapter.normalize(
        {
          ...syntheticOpenedPayload(),
          entity: { ...syntheticOpenedPayload().entity, payment_ref: "" },
        },
        { receivedAt: RECEIVED_AT },
      );
    });
  });

  it("does not leak payload secrets into error messages", () => {
    const secret = "sk_live_SYNTHETIC_not_a_real_key";
    expectWebhookError("UNSUPPORTED_EVENT", () => {
      syntheticProviderAdapter.normalize(
        {
          ...syntheticOpenedPayload(),
          kind: "syn.payment.reversed",
          credential: secret,
        },
        { receivedAt: RECEIVED_AT },
      );
    });
  });
});

describe("provider isolation", () => {
  it("does not copy provider-specific fields onto the normalized event", () => {
    const event = syntheticProviderAdapter.normalize(
      {
        ...syntheticOpenedPayload(),
        razorpayEvent: "payment.authorized",
        signature: "rzp_sig_placeholder",
        notes: { customer_email: "hidden@example.com" },
      },
      { receivedAt: RECEIVED_AT },
    );
    expect(event).not.toHaveProperty("razorpayEvent");
    expect(event).not.toHaveProperty("signature");
    expect(event).not.toHaveProperty("notes");
    expect(event).not.toHaveProperty("entity");
    expect(event).not.toHaveProperty("kind");
  });

  it("rejects an unsupported provider without coupling to a live PSP", () => {
    expectWebhookError("UNSUPPORTED_PROVIDER", () => {
      getProviderAdapter("stripe");
    });
    expect(getProviderAdapter("razorpay").provider).toBe("razorpay");
    expectWebhookError("UNSUPPORTED_PROVIDER", () => {
      syntheticProviderAdapter.normalize(
        { event: "payment.captured", id: "evt_1" },
        { receivedAt: RECEIVED_AT },
      );
    });
  });
});
