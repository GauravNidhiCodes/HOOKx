import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signaturesEqual } from "./compare.js";

describe("signaturesEqual", () => {
  it("accepts identical equal-length digests", () => {
    const digest = createHmac("sha256", "secret").update("body").digest();
    expect(signaturesEqual(digest, digest)).toBe(true);
    expect(signaturesEqual(digest, Buffer.from(digest))).toBe(true);
  });

  it("rejects different equal-length digests without throwing", () => {
    const left = createHmac("sha256", "secret").update("left").digest();
    const right = createHmac("sha256", "secret").update("right").digest();
    expect(left.length).toBe(right.length);
    expect(signaturesEqual(left, right)).toBe(false);
  });

  it("rejects different-length buffers without throwing", () => {
    const left = new Uint8Array([1, 2, 3]);
    const right = new Uint8Array([1, 2]);
    expect(signaturesEqual(left, right)).toBe(false);
    expect(signaturesEqual(new Uint8Array(), right)).toBe(false);
  });
});
