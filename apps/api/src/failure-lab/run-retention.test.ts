import { describe, expect, it } from "vitest";
import { retainLabRuns } from "./run-retention.js";

describe("retainLabRuns", () => {
  it("drops the oldest entries when the map exceeds the cap", () => {
    const runs = new Map<string, number>();
    for (let index = 0; index < 5; index += 1) {
      runs.set(`run-${index}`, index);
    }
    retainLabRuns(runs, 3);
    expect([...runs.keys()]).toEqual(["run-2", "run-3", "run-4"]);
    expect(runs.size).toBe(3);
  });

  it("does nothing when at or under the cap", () => {
    const runs = new Map([["a", 1], ["b", 2]]);
    retainLabRuns(runs, 2);
    expect(runs.size).toBe(2);
  });
});
