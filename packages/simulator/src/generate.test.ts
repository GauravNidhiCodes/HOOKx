import { describe, expect, it } from "vitest";
import { instant } from "@hookx/domain";
import {
  createSignatureVerifierRegistry,
  SYNTHETIC_SIGNATURE_HEADER,
} from "@hookx/webhook";
import { getScenario } from "./catalog.js";
import { generateDeliveries, parseLabeledPayload } from "./generate.js";
import { SIMULATOR_NOW, SIMULATOR_SECRET } from "./notice.js";
import { SCENARIO_ID } from "./types.js";

describe("generateDeliveries", () => {
  it("produces deterministic labeled payloads and valid signatures", () => {
    const scenario = getScenario(SCENARIO_ID.NORMAL_FLOW);
    const first = generateDeliveries(scenario);
    const second = generateDeliveries(scenario);
    expect(first.map((row) => row.rawBody)).toEqual(
      second.map((row) => row.rawBody),
    );
    expect(first.map((row) => row.signature)).toEqual(
      second.map((row) => row.signature),
    );
    expect(first.map((row) => row.eventType)).toEqual([
      "payment.created",
      "payment.authorized",
      "payment.captured",
    ]);

    const verifier = createSignatureVerifierRegistry({
      syntheticSecret: SIMULATOR_SECRET,
      syntheticToleranceSeconds: 300,
    }).get("SYNTHETIC");
    expect(verifier).not.toBeNull();
    for (const delivery of first) {
      const labeled = parseLabeledPayload(delivery.rawBody);
      expect(labeled.synthetic).toBe(true);
      expect(labeled.infrastructure).toBe("SYNTHETIC");
      const result = verifier!.verify({
        rawBody: new TextEncoder().encode(delivery.rawBody),
        headers: new Map([[SYNTHETIC_SIGNATURE_HEADER, delivery.signature]]),
        now: instant(SIMULATOR_NOW),
      });
      expect(result.status).toBe("VERIFIED");
      expect(JSON.stringify(delivery)).not.toContain(SIMULATOR_SECRET);
    }
  });

  it("resends an identical body for duplicate delivery", () => {
    const deliveries = generateDeliveries(
      getScenario(SCENARIO_ID.DUPLICATE_DELIVERY),
    );
    expect(deliveries).toHaveLength(2);
    expect(deliveries[0]?.rawBody).toBe(deliveries[1]?.rawBody);
    expect(deliveries[0]?.signature).toBe(deliveries[1]?.signature);
    expect(deliveries[1]?.kind).toBe("RESEND_IDENTICAL");
  });

  it("changes only the amount for a conflicting second payload", () => {
    const deliveries = generateDeliveries(getScenario(SCENARIO_ID.CONFLICT));
    const first = parseLabeledPayload(deliveries[0]!.rawBody);
    const second = parseLabeledPayload(deliveries[1]!.rawBody);
    expect(first.event_ref).toBe(second.event_ref);
    expect(first.entity.money.minor_units).toBe("10000");
    expect(second.entity.money.minor_units).toBe("25000");
    expect(deliveries[0]?.rawBody).not.toBe(deliveries[1]?.rawBody);
  });

  it("interleaves two payments in MULTI_PAYMENT", () => {
    const deliveries = generateDeliveries(getScenario(SCENARIO_ID.MULTI_PAYMENT));
    expect(deliveries.map((row) => `${row.paymentId}:${row.eventType}`)).toEqual([
      "SYNTHETIC:pay:sim-multi-a:payment.created",
      "SYNTHETIC:pay:sim-multi-b:payment.created",
      "SYNTHETIC:pay:sim-multi-a:payment.authorized",
      "SYNTHETIC:pay:sim-multi-b:payment.authorized",
      "SYNTHETIC:pay:sim-multi-a:payment.captured",
      "SYNTHETIC:pay:sim-multi-b:payment.captured",
    ]);
  });
});
