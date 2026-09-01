import { describe, expect, it } from "vitest";
import { WebhookError } from "../errors.js";
import { parseRazorpayAmountMinor } from "./amount.js";

describe("parseRazorpayAmountMinor", () => {
  it("accepts a safe integer JSON number as bigint minor units", () => {
    expect(parseRazorpayAmountMinor(0)).toBe(0n);
    expect(parseRazorpayAmountMinor(1)).toBe(1n);
    expect(parseRazorpayAmountMinor(10000)).toBe(10000n);
    expect(parseRazorpayAmountMinor(Number.MAX_SAFE_INTEGER)).toBe(
      BigInt(Number.MAX_SAFE_INTEGER),
    );
  });

  it("rejects values outside the safe integer range without coercing", () => {
    expect(() => parseRazorpayAmountMinor(Number.MAX_SAFE_INTEGER + 1)).toThrow(
      WebhookError,
    );
  });

  it("accepts an integer decimal string without using floating-point math", () => {
    expect(parseRazorpayAmountMinor("10000")).toBe(10000n);
  });

  it("rejects floats, scientific notation, and negatives", () => {
    expect(() => parseRazorpayAmountMinor(10.5)).toThrow(WebhookError);
    expect(() => parseRazorpayAmountMinor(-1)).toThrow(WebhookError);
    expect(() => parseRazorpayAmountMinor("10000.0")).toThrow(WebhookError);
    expect(() => parseRazorpayAmountMinor("1e4")).toThrow(WebhookError);
    expect(() => parseRazorpayAmountMinor("-1")).toThrow(WebhookError);
    try {
      parseRazorpayAmountMinor(1.5);
      throw new Error("expected INVALID_AMOUNT");
    } catch (error) {
      expect(error).toBeInstanceOf(WebhookError);
      if (error instanceof WebhookError) {
        expect(error.code).toBe("INVALID_AMOUNT");
      }
    }
  });
});
