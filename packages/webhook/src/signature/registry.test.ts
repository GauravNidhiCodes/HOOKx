import { describe, expect, it } from "vitest";
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
    expect(registry.get("razorpay")).toBeNull();
    expect(registry.get("SYNTHETIC ")).toBeNull();
  });
});
