import { describe, expect, it } from "vitest";
import { externalEventId, providerId } from "@hookx/domain";
import { identitiesEqual, webhookIdentityKey } from "./identity.js";

describe("webhook identity", () => {
  it("is provider + externalEventId", () => {
    const left = webhookIdentityKey(
      providerId("SYNTHETIC"),
      externalEventId("SYNTHETIC:evt:001"),
    );
    const right = webhookIdentityKey(
      providerId("SYNTHETIC"),
      externalEventId("SYNTHETIC:evt:001"),
    );
    expect(left).toBe(right);
  });

  it("does not collide across providers with the same externalEventId", () => {
    const eventId = externalEventId("shared-external-id");
    const synthetic = webhookIdentityKey(providerId("SYNTHETIC"), eventId);
    const other = webhookIdentityKey(providerId("OTHER-PROVIDER"), eventId);
    expect(synthetic).not.toBe(other);
  });

  it("treats different event ids from one provider as distinct", () => {
    const provider = providerId("SYNTHETIC");
    expect(
      identitiesEqual(
        { provider, externalEventId: externalEventId("SYNTHETIC:evt:001") },
        { provider, externalEventId: externalEventId("SYNTHETIC:evt:002") },
      ),
    ).toBe(false);
  });
});
