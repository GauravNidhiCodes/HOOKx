import { describe, expect, it } from "vitest";
import {
  deriveDemoSteps,
  failureClassification,
  retryExhausted,
  unexpectedDemoOutcome,
  webhookRecovered,
} from "./demo-lifecycle";
import {
  sampleFailureLabRun,
  sampleGoldenDemoExhausted,
  sampleGoldenDemoRun,
} from "../test-support/fixtures";

describe("demo lifecycle derivation", () => {
  it("keeps every step pending until a report exists", () => {
    const steps = deriveDemoSteps(null, false);
    expect(steps.every((step) => !step.complete)).toBe(true);
  });

  it("marks receive through audit from a recovered golden report", () => {
    const steps = deriveDemoSteps(sampleGoldenDemoRun.run, false);
    const done = Object.fromEntries(steps.map((step) => [step.id, step.complete]));
    expect(webhookRecovered(sampleGoldenDemoRun.run)).toBe(true);
    expect(done["RECEIVE"]).toBe(true);
    expect(done["VERIFY"]).toBe(true);
    expect(done["PROCESS"]).toBe(true);
    expect(done["FAIL"]).toBe(true);
    expect(done["RETRY"]).toBe(true);
    expect(done["RECOVER"]).toBe(true);
    expect(done["AUDIT"]).toBe(true);
    expect(done["INVESTIGATE"]).toBe(false);
  });

  it("marks investigate only after the investigation callback", () => {
    const steps = deriveDemoSteps(sampleGoldenDemoRun.run, true);
    expect(steps.find((step) => step.id === "INVESTIGATE")?.complete).toBe(true);
  });

  it("does not mark recover when retry is exhausted", () => {
    expect(retryExhausted(sampleGoldenDemoExhausted.run)).toBe(true);
    expect(webhookRecovered(sampleGoldenDemoExhausted.run)).toBe(false);
    const steps = deriveDemoSteps(sampleGoldenDemoExhausted.run, false);
    expect(steps.find((step) => step.id === "RECOVER")?.complete).toBe(false);
  });

  it("reads failure classification from the report", () => {
    const failure = failureClassification(sampleGoldenDemoRun.run);
    expect(failure?.code).toBe("TEMPORARY_PROCESSING_FAILURE");
    expect(failure?.failureClass).toBe("RETRYABLE");
  });

  it("flags a fail-once run that recorded no processing error", () => {
    expect(unexpectedDemoOutcome(sampleGoldenDemoRun.run)).toBe(false);
    expect(
      unexpectedDemoOutcome({
        ...sampleFailureLabRun,
        failureMode: "FAIL_ONCE",
        result: { ...sampleFailureLabRun.result, error: 0 },
      }),
    ).toBe(true);
  });
});
