import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { instant } from "@hookx/domain";
import { RazorpaySignatureVerifier } from "./verifier.js";
import { signRazorpayWebhook } from "./sign.js";
import { RAZORPAY_SIGNATURE_HEADER } from "./constants.js";
import { razorpayPaymentAuthorizedPayload } from "./fixtures.js";

const SECRET = "dev-only-razorpay-webhook-secret";
const NOW = instant("2026-01-15T10:00:01.000Z");
const RAW = JSON.stringify(razorpayPaymentAuthorizedPayload());

function headers(signature: string | undefined): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  if (signature !== undefined) {
    map.set(RAZORPAY_SIGNATURE_HEADER, signature);
  }
  return map;
}

describe("RazorpaySignatureVerifier", () => {
  const verifier = new RazorpaySignatureVerifier({ secret: SECRET });

  it("accepts a valid HMAC-SHA256 hex signature over the raw body", () => {
    const signature = signRazorpayWebhook({ secret: SECRET, rawBody: RAW });
    expect(
      verifier.verify({ rawBody: RAW, headers: headers(signature), now: NOW }).status,
    ).toBe("VERIFIED");
    expect(signature).toBe(
      createHmac("sha256", SECRET).update(RAW, "utf8").digest("hex"),
    );
  });

  it("rejects an invalid signature", () => {
    const signature = signRazorpayWebhook({ secret: SECRET, rawBody: RAW });
    const flipped = `${signature.slice(0, -1)}${signature.endsWith("a") ? "b" : "a"}`;
    expect(
      verifier.verify({
        rawBody: RAW,
        headers: headers(flipped),
        now: NOW,
      }).status,
    ).toBe("INVALID_SIGNATURE");
  });

  it("rejects a modified body with the original signature", () => {
    const signature = signRazorpayWebhook({ secret: SECRET, rawBody: RAW });
    const modified = `${RAW.slice(0, -1)} `;
    expect(
      verifier.verify({
        rawBody: modified,
        headers: headers(signature),
        now: NOW,
      }).status,
    ).toBe("INVALID_SIGNATURE");
  });

  it("rejects a missing signature header", () => {
    expect(
      verifier.verify({ rawBody: RAW, headers: headers(undefined), now: NOW })
        .status,
    ).toBe("MISSING_SIGNATURE");
  });

  it("rejects a malformed signature header", () => {
    expect(
      verifier.verify({
        rawBody: RAW,
        headers: headers("not-a-hex-digest"),
        now: NOW,
      }).status,
    ).toBe("MALFORMED_SIGNATURE");
  });

  it("fails closed when the webhook secret is not configured", () => {
    const unsigned = new RazorpaySignatureVerifier({ secret: undefined });
    const signature = signRazorpayWebhook({ secret: SECRET, rawBody: RAW });
    const result = unsigned.verify({
      rawBody: RAW,
      headers: headers(signature),
      now: NOW,
    });
    expect(result.status).toBe("INVALID_SIGNATURE");
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("does not parse JSON before HMAC", () => {
    const spaced = `${RAW.slice(0, -1)} `;
    const signature = signRazorpayWebhook({ secret: SECRET, rawBody: spaced });
    expect(
      verifier.verify({
        rawBody: spaced,
        headers: headers(signature),
        now: NOW,
      }).status,
    ).toBe("VERIFIED");
    expect(
      verifier.verify({
        rawBody: RAW,
        headers: headers(signature),
        now: NOW,
      }).status,
    ).toBe("INVALID_SIGNATURE");
  });
});
