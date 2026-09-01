import { describe, expect, it } from "vitest";
import { DomainError } from "./domain-error.js";
import { addMoney, money, moneyEquals, subtractMoney } from "./money.js";

describe("money representation", () => {
  it("stores minor units as bigint with an ISO currency", () => {
    const value = money(10000n, "INR");

    expect(value.amountMinor).toBe(10000n);
    expect(typeof value.amountMinor).toBe("bigint");
    expect(value.currency).toBe("INR");
  });

  it("rejects number-like amounts at runtime", () => {
    expect(() => money(10000 as unknown as bigint, "INR")).toThrow(DomainError);
    expect(() => money(10000 as unknown as bigint, "INR")).toThrow(
      /bigint minor-unit/,
    );
  });

  it("rejects lowercase currency codes instead of coercing them", () => {
    expect(() => money(1n, "inr")).toThrow(DomainError);
  });

  it("rejects negative minor units", () => {
    expect(() => money(-1n, "INR")).toThrow(DomainError);
  });

  it("compares money by minor units and currency", () => {
    expect(moneyEquals(money(10000n, "INR"), money(10000n, "INR"))).toBe(true);
    expect(moneyEquals(money(10000n, "INR"), money(10001n, "INR"))).toBe(false);
    expect(moneyEquals(money(10000n, "INR"), money(10000n, "USD"))).toBe(false);
  });

  it("adds minor units with bigint arithmetic of the same currency", () => {
    const sum = addMoney(money(10000n, "INR"), money(250n, "INR"));
    expect(sum.amountMinor).toBe(10250n);
    expect(sum.currency).toBe("INR");
  });

  it("refuses to add mixed currencies", () => {
    expect(() => addMoney(money(1n, "INR"), money(1n, "USD"))).toThrow(
      DomainError,
    );
  });

  it("subtracts minor units of the same currency", () => {
    const difference = subtractMoney(money(10000n, "INR"), money(250n, "INR"));
    expect(difference.amountMinor).toBe(9750n);
    expect(difference.currency).toBe("INR");
  });

  it("refuses to subtract mixed currencies", () => {
    expect(() => subtractMoney(money(1n, "INR"), money(1n, "USD"))).toThrow(
      DomainError,
    );
  });

  it("refuses a negative subtraction result", () => {
    expect(() => subtractMoney(money(1n, "INR"), money(2n, "INR"))).toThrow(
      DomainError,
    );
  });
});
