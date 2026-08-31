import { describe, expect, it, vi } from "vitest";
import { instant } from "@hookx/domain";
import { unixSecondsFromInstant } from "../unix-time.js";
import { SYNTHETIC_SIGNATURE_HEADER } from "./constants.js";
import { signSyntheticWebhook } from "./sign.js";
import { SyntheticSignatureVerifier } from "./verifier.js";

const SECRET = "dev-only-synthetic-webhook-secret";
const OTHER_SECRET = "a-different-dev-only-secret";
const NOW = instant("2026-01-15T10:00:01.000Z");
const RAW_BODY = '{"infrastructure":"SYNTHETIC","event_ref":"SYNTHETIC:evt:opened"}';

function headers(signature: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (signature !== undefined) {
    map.set(SYNTHETIC_SIGNATURE_HEADER, signature);
  }
  return map;
}

function verifier(secret = SECRET, toleranceSeconds = 300): SyntheticSignatureVerifier {
  return new SyntheticSignatureVerifier({ secret, toleranceSeconds });
}

describe("SyntheticSignatureVerifier", () => {
  it("accepts a valid HMAC-SHA256 timestamp signature", () => {
    const timestampSeconds = unixSecondsFromInstant(NOW);
    const signature = signSyntheticWebhook({
      secret: SECRET,
      rawBody: RAW_BODY,
      timestampSeconds,
    });
    const result = verifier().verify({
      rawBody: RAW_BODY,
      headers: headers(signature),
      now: NOW,
    });
    expect(result.status).toBe("VERIFIED");
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("rejects an invalid signature", () => {
    const timestampSeconds = unixSecondsFromInstant(NOW);
    const signature = signSyntheticWebhook({
      secret: SECRET,
      rawBody: RAW_BODY,
      timestampSeconds,
    });
    const tampered = `${signature.slice(0, -1)}${signature.endsWith("0") ? "1" : "0"}`;
    expect(tampered).not.toBe(signature);
    const result = verifier().verify({
      rawBody: RAW_BODY,
      headers: headers(tampered),
      now: NOW,
    });
    expect(result.status).toBe("INVALID_SIGNATURE");
    expect(result.reason).not.toContain(SECRET);
  });

  it("rejects a missing signature", () => {
    const result = verifier().verify({
      rawBody: RAW_BODY,
      headers: headers(undefined),
      now: NOW,
    });
    expect(result.status).toBe("MISSING_SIGNATURE");
  });

  it("rejects a blank signature header as missing", () => {
    const result = verifier().verify({
      rawBody: RAW_BODY,
      headers: new Map([[SYNTHETIC_SIGNATURE_HEADER, "   "]]),
      now: NOW,
    });
    expect(result.status).toBe("MISSING_SIGNATURE");
  });

  it("rejects a malformed signature", () => {
    const malformed = [
      "not-a-signature",
      "t=123",
      "v1=abcd",
      "t=abc,v1=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "t=1,v1=short",
      "t=1,v1=zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
    ];
    for (const signature of malformed) {
      const result = verifier().verify({
        rawBody: RAW_BODY,
        headers: headers(signature),
        now: NOW,
      });
      expect(result.status).toBe("MALFORMED_SIGNATURE");
    }
  });

  it("rejects a modified payload with an otherwise valid signature", () => {
    const timestampSeconds = unixSecondsFromInstant(NOW);
    const signature = signSyntheticWebhook({
      secret: SECRET,
      rawBody: RAW_BODY,
      timestampSeconds,
    });
    const result = verifier().verify({
      rawBody: `${RAW_BODY} `,
      headers: headers(signature),
      now: NOW,
    });
    expect(result.status).toBe("INVALID_SIGNATURE");
  });

  it("rejects a modified signature over the same payload", () => {
    const timestampSeconds = unixSecondsFromInstant(NOW);
    const signature = signSyntheticWebhook({
      secret: SECRET,
      rawBody: RAW_BODY,
      timestampSeconds,
    });
    const hexStart = signature.indexOf("v1=") + 3;
    const mutated = `${signature.slice(0, hexStart)}${signature[hexStart] === "a" ? "b" : "a"}${signature.slice(hexStart + 1)}`;
    expect(mutated.length).toBe(signature.length);
    const result = verifier().verify({
      rawBody: RAW_BODY,
      headers: headers(mutated),
      now: NOW,
    });
    expect(result.status).toBe("INVALID_SIGNATURE");
  });

  it("rejects a signature computed with the wrong secret", () => {
    const timestampSeconds = unixSecondsFromInstant(NOW);
    const signature = signSyntheticWebhook({
      secret: OTHER_SECRET,
      rawBody: RAW_BODY,
      timestampSeconds,
    });
    const result = verifier(SECRET).verify({
      rawBody: RAW_BODY,
      headers: headers(signature),
      now: NOW,
    });
    expect(result.status).toBe("INVALID_SIGNATURE");
    expect(result.reason).not.toContain(OTHER_SECRET);
    expect(result.reason).not.toContain(SECRET);
  });

  it("verifies the original raw bytes, not a re-serialized JSON object", () => {
    const pretty = `{
  "infrastructure": "SYNTHETIC",
  "event_ref": "SYNTHETIC:evt:opened"
}`;
    const compact = JSON.stringify(JSON.parse(pretty));
    expect(pretty).not.toBe(compact);

    const timestampSeconds = unixSecondsFromInstant(NOW);
    const signature = signSyntheticWebhook({
      secret: SECRET,
      rawBody: pretty,
      timestampSeconds,
    });

    expect(
      verifier().verify({
        rawBody: pretty,
        headers: headers(signature),
        now: NOW,
      }).status,
    ).toBe("VERIFIED");
    expect(
      verifier().verify({
        rawBody: compact,
        headers: headers(signature),
        now: NOW,
      }).status,
    ).toBe("INVALID_SIGNATURE");
  });

  it("rejects timestamps outside the injected replay window", () => {
    const nowSeconds = unixSecondsFromInstant(NOW);
    const expired = signSyntheticWebhook({
      secret: SECRET,
      rawBody: RAW_BODY,
      timestampSeconds: nowSeconds - 301,
    });
    expect(
      verifier().verify({
        rawBody: RAW_BODY,
        headers: headers(expired),
        now: NOW,
      }).status,
    ).toBe("EXPIRED_SIGNATURE");

    const future = signSyntheticWebhook({
      secret: SECRET,
      rawBody: RAW_BODY,
      timestampSeconds: nowSeconds + 301,
    });
    expect(
      verifier().verify({
        rawBody: RAW_BODY,
        headers: headers(future),
        now: NOW,
      }).status,
    ).toBe("EXPIRED_SIGNATURE");
  });

  it("accepts timestamps on the tolerance boundary using injected time", () => {
    const nowSeconds = unixSecondsFromInstant(NOW);
    const signature = signSyntheticWebhook({
      secret: SECRET,
      rawBody: RAW_BODY,
      timestampSeconds: nowSeconds - 300,
    });
    expect(
      verifier().verify({
        rawBody: RAW_BODY,
        headers: headers(signature),
        now: NOW,
      }).status,
    ).toBe("VERIFIED");
  });

  it("does not treat a foreign provider header as the synthetic signature", () => {
    const timestampSeconds = unixSecondsFromInstant(NOW);
    const signature = signSyntheticWebhook({
      secret: SECRET,
      rawBody: RAW_BODY,
      timestampSeconds,
    });
    const result = verifier().verify({
      rawBody: RAW_BODY,
      headers: new Map([["stripe-signature", signature]]),
      now: NOW,
    });
    expect(result.status).toBe("MISSING_SIGNATURE");
  });

  it("does not read Date.now() during verification", () => {
    const nowSpy = vi.spyOn(Date, "now");
    const timestampSeconds = unixSecondsFromInstant(NOW);
    const signature = signSyntheticWebhook({
      secret: SECRET,
      rawBody: RAW_BODY,
      timestampSeconds,
    });
    verifier().verify({
      rawBody: RAW_BODY,
      headers: headers(signature),
      now: NOW,
    });
    expect(nowSpy).not.toHaveBeenCalled();
    nowSpy.mockRestore();
  });
});
