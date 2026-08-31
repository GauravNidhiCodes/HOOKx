import { describe, expect, it } from "vitest";
import { sanitizeAuditMetadata } from "./metadata.js";

describe("sanitizeAuditMetadata", () => {
  it("drops nested objects and blocked keys", () => {
    expect(
      sanitizeAuditMetadata({
        token: "abc",
        rawBody: "{}",
        attempt: 2,
        ok: true,
        nested: { a: 1 },
      }),
    ).toEqual({ attempt: 2, ok: true });
  });

  it("returns an empty frozen object when omitted", () => {
    const empty = sanitizeAuditMetadata(undefined);
    expect(empty).toEqual({});
    expect(Object.isFrozen(empty)).toBe(true);
  });
});
