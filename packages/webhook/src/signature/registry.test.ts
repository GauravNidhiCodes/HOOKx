import { describe, expect, it } from "vitest";
import { RazorpaySignatureVerifier } from "../razorpay/verifier.js";
import { createSignatureVerifierRegistry } from "./registry.js";
import { SyntheticSignatureVerifier } from "./synthetic/verifier.js";

describe("createSignatureVerifierRegistry", () => {
  it("returns the synthetic verifier only for SYNTHETIC", () => {
    const registry = createSignatureVerifierRegistry({
      syntheticSecret: "dev-only-synthetic-webhook-secret",
      syntheticToleranceSeconds: 300,
    });
    expect(registry.get("SYNTHETIC")).toBeInstanceOf(SyntheticSignatureVerifier);
    expect(registry.get("stripe")).toBeNull();
    expect(registry.get("SYNTHETIC ")).toBeNull();
  });

  it("registers Razorpay even when the webhook secret is unset", () => {
    const registry = createSignatureVerifierRegistry({
      syntheticSecret: "dev-only-synthetic-webhook-secret",
      syntheticToleranceSeconds: 300,
    });
    expect(registry.get("razorpay")).toBeInstanceOf(RazorpaySignatureVerifier);
  });
});
