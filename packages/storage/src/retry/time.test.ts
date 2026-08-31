import { describe, expect, it } from "vitest";
import { instant } from "@hookx/domain";
import { addMilliseconds } from "./time.js";

describe("addMilliseconds", () => {
  it("advances an injected instant without Date.now()", () => {
    const start = instant("2026-01-15T10:00:01.000Z");
    expect(addMilliseconds(start, 1_000)).toBe("2026-01-15T10:00:02.000Z");
    expect(addMilliseconds(start, 0)).toBe(start);
  });
});
