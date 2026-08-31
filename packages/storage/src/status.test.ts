import { describe, expect, it } from "vitest";
import {
  canMarkConflict,
  canMarkProcessed,
  canMarkProcessing,
  canMarkRejected,
} from "./status.js";

describe("processing status transitions", () => {
  it("allows RECEIVED → PROCESSING → PROCESSED", () => {
    expect(canMarkProcessing("RECEIVED")).toBe(true);
    expect(canMarkProcessed("PROCESSING")).toBe(true);
    expect(canMarkRejected("PROCESSING")).toBe(true);
  });

  it("rejects illegal processing marks", () => {
    expect(canMarkProcessing("PROCESSING")).toBe(false);
    expect(canMarkProcessed("RECEIVED")).toBe(false);
    expect(canMarkRejected("RECEIVED")).toBe(false);
    expect(canMarkProcessed("PROCESSED")).toBe(false);
  });

  it("allows marking CONFLICT without changing payload columns", () => {
    expect(canMarkConflict("RECEIVED")).toBe(true);
    expect(canMarkConflict("PROCESSING")).toBe(true);
    expect(canMarkConflict("CONFLICT")).toBe(true);
    expect(canMarkConflict("PROCESSED")).toBe(false);
  });
});
