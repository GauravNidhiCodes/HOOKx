import { createHmac } from "node:crypto";

export function computeSyntheticSignatureDigest(
  secret: string,
  timestampSeconds: number,
  rawBody: Uint8Array,
): Uint8Array {
  const hmac = createHmac("sha256", secret);
  hmac.update(`${timestampSeconds}.`, "utf8");
  hmac.update(rawBody);
  return hmac.digest();
}

export function formatSyntheticSignatureHeader(
  timestampSeconds: number,
  digest: Uint8Array,
): string {
  return `t=${timestampSeconds},v1=${Buffer.from(digest).toString("hex")}`;
}

const HEADER_PATTERN = /^t=([0-9]{1,16}),v1=([0-9a-fA-F]{64})$/;

export type ParsedSyntheticSignature =
  | {
      readonly ok: true;
      readonly timestampSeconds: number;
      readonly digest: Uint8Array;
    }
  | {
      readonly ok: false;
      readonly status: "MISSING_SIGNATURE" | "MALFORMED_SIGNATURE";
    };

export function parseSyntheticSignatureHeader(
  value: string | undefined,
): ParsedSyntheticSignature {
  if (value === undefined) {
    return { ok: false, status: "MISSING_SIGNATURE" };
  }

  const match = HEADER_PATTERN.exec(value);
  if (match === null || match[1] === undefined || match[2] === undefined) {
    return { ok: false, status: "MALFORMED_SIGNATURE" };
  }

  const timestampSeconds = Number(match[1]);
  if (!Number.isInteger(timestampSeconds) || timestampSeconds < 0) {
    return { ok: false, status: "MALFORMED_SIGNATURE" };
  }

  return {
    ok: true,
    timestampSeconds,
    digest: Buffer.from(match[2], "hex"),
  };
}
