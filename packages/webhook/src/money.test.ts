import { describe, expect, it } from "vitest";
import { WebhookError, parseAmountMinorString } from "./index.js";

describe("amount minor-unit parsing", () => {
  it("accepts a decimal integer string as bigint", () => {
    expect(parseAmountMinorString("0")).toBe(0n);
    expect(parseAmountMinorString("10000")).toBe(10000n);
  });

  it("rejects floating-point and numeric inputs", () => {
    expect(() => parseAmountMinorString("10000.0")).toThrow(WebhookError);
    expect(() => parseAmountMinorString("1e4")).toThrow(WebhookError);
    expect(() => parseAmountMinorString(10000)).toThrow(WebhookError);
    expect(() => parseAmountMinorString("-1")).toThrow(WebhookError);
  });
});
