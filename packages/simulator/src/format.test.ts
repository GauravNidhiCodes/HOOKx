import { describe, expect, it } from "vitest";
import { getScenario, SCENARIOS } from "./catalog.js";
import { formatScenarioList, formatScenarioReport } from "./format.js";
import { SYNTHETIC_NOTICE } from "./notice.js";
import { CLI_ALIAS, SCENARIO_ID } from "./types.js";

describe("formatScenarioReport", () => {
  it("prints a concise synthetic summary without payloads or secrets", () => {
    const scenario = getScenario(SCENARIO_ID.OUT_OF_ORDER);
    const text = formatScenarioReport({
      scenario,
      deliveries: [
        {
          stepIndex: 1,
          eventType: "payment.created",
          paymentId: "SYNTHETIC:pay:sim-out-of-order",
          httpStatus: 200,
          bodyStatus: "accepted",
        },
        {
          stepIndex: 2,
          eventType: "payment.captured",
          paymentId: "SYNTHETIC:pay:sim-out-of-order",
          httpStatus: 200,
          bodyStatus: "accepted",
          note: "delayed",
        },
        {
          stepIndex: 3,
          eventType: "payment.authorized",
          paymentId: "SYNTHETIC:pay:sim-out-of-order",
          httpStatus: 200,
          bodyStatus: "accepted",
        },
      ],
      payments: [
        { paymentId: "SYNTHETIC:pay:sim-out-of-order", state: "CAPTURED" },
      ],
    });
    expect(text).toContain("Scenario: OUT_OF_ORDER");
    expect(text).toContain(SYNTHETIC_NOTICE);
    expect(text).toContain("captured initially delayed");
    expect(text).toContain("final state: CAPTURED");
    expect(text).not.toContain("event_ref");
    expect(text).not.toContain("v1=");
    expect(formatScenarioList(SCENARIOS, CLI_ALIAS)).toContain(
      "pnpm simulate out-of-order",
    );
  });
});
