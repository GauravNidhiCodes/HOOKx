import { sanitizeAuditMetadata } from "@hookx/audit";
import type { InvestigationContext } from "./context.js";
import { withEvidenceHash } from "./context.js";

const SECRET_VALUE =
  /\bsk-[A-Za-z0-9-]{8,}\b|\bwhsec_[A-Za-z0-9]+\b|Bearer\s+\S+/i;
const SIGNATURE_BLOB = /(?:^|[,;\s])t=\d+,v1=[A-Fa-f0-9]{16,}/i;
const CREDENTIAL_BLOB =
  /(?:api[_-]?key|webhook[_-]?secret|authorization)\s*[:=]\s*\S+/i;

export function redactSecretString(value: string): string {
  if (
    SECRET_VALUE.test(value.trim()) ||
    SIGNATURE_BLOB.test(value) ||
    CREDENTIAL_BLOB.test(value)
  ) {
    return "[REDACTED]";
  }
  return value;
}

function redactMetadata(
  metadata: InvestigationContext["exception"]["metadata"],
): InvestigationContext["exception"]["metadata"] {
  const cleaned: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(sanitizeAuditMetadata(metadata))) {
    if (typeof value === "string") {
      cleaned[key] = redactSecretString(value);
    } else {
      cleaned[key] = value;
    }
  }
  return Object.freeze(cleaned);
}

/**
 * Final minimization pass before a model sees evidence. Secrets, signatures,
 * and credential-shaped strings are removed. Instruction-like payload text is
 * retained as DATA so the model can be tested for injection resistance.
 */
export function sanitizeInvestigationContext(
  context: InvestigationContext,
): InvestigationContext {
  const sanitized = {
    investigatedAt: context.investigatedAt,
    correlationId: context.correlationId,
    incident: context.incident,
    exception: Object.freeze({
      ...context.exception,
      metadata: redactMetadata(context.exception.metadata),
    }),
    payment: context.payment,
    webhooks: context.webhooks,
    retries: context.retries,
    audit: context.audit,
    replay: context.replay,
    applicableRules: context.applicableRules,
  };
  return withEvidenceHash(sanitized);
}

export function serializedContextContainsForbiddenMaterial(
  serialized: string,
): boolean {
  return (
    /payloadHash/i.test(serialized) ||
    /api[_-]?key/i.test(serialized) ||
    /authorization/i.test(serialized) ||
    /webhook[_-]?secret/i.test(serialized) ||
    /"signature"/i.test(serialized) ||
    /Bearer\s+[A-Za-z0-9._-]+/.test(serialized) ||
    /sk-[A-Za-z0-9-]{8,}/.test(serialized) ||
    /whsec_[A-Za-z0-9]+/.test(serialized)
  );
}
