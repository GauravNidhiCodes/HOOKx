export type AuditMetadataValue = string | number | boolean | null;

export type AuditMetadata = Readonly<Record<string, AuditMetadataValue>>;

const BLOCKED_KEY =
  /(secret|signature|password|authorization|credential|payload|token|cookie|rawbody)/i;

const MAX_KEYS = 16;
const MAX_STRING_LENGTH = 128;

export function sanitizeAuditMetadata(
  input: Readonly<Record<string, unknown>> | undefined,
): AuditMetadata {
  if (input === undefined) {
    return Object.freeze({});
  }
  const cleaned: Record<string, AuditMetadataValue> = {};
  for (const [key, value] of Object.entries(input)) {
    if (Object.keys(cleaned).length >= MAX_KEYS) {
      break;
    }
    if (BLOCKED_KEY.test(key)) {
      continue;
    }
    if (typeof value === "string") {
      if (value.length <= MAX_STRING_LENGTH) {
        cleaned[key] = value;
      }
      continue;
    }
    if (
      typeof value === "number" &&
      Number.isFinite(value) &&
      !Number.isNaN(value)
    ) {
      cleaned[key] = value;
      continue;
    }
    if (typeof value === "boolean" || value === null) {
      cleaned[key] = value;
    }
  }
  return Object.freeze(cleaned);
}
