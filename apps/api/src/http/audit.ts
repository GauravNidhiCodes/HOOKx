import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  sanitizeAuditMetadata,
  type AuditEvent,
} from "@hookx/audit";
import { paymentId } from "@hookx/domain";
import type { AuditRepository } from "@hookx/storage";

export type AuditRouteDependencies = {
  readonly audit: AuditRepository;
};

type PublicAuditEvent = {
  readonly auditEventId: string;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly provider: string | null;
  readonly paymentId: string | null;
  readonly webhookEventId: string | null;
  readonly previousState: string | null;
  readonly resultingState: string | null;
  readonly actor: string;
  readonly reason: string;
  readonly correlationId: string;
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
};

function toPublic(event: AuditEvent): PublicAuditEvent {
  return {
    auditEventId: event.auditEventId,
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    recordedAt: event.recordedAt,
    provider: event.provider,
    paymentId: event.paymentId,
    webhookEventId: event.webhookEventId,
    previousState: event.previousState,
    resultingState: event.resultingState,
    actor: event.actor,
    reason: event.reason,
    correlationId: event.correlationId,
    metadata: sanitizeAuditMetadata(event.metadata),
  };
}

function badRequest(context: Context, code: string): Response {
  return context.json(
    { status: "bad_request", code },
    400 as ContentfulStatusCode,
  );
}

export async function handlePaymentAudit(
  context: Context,
  dependencies: AuditRouteDependencies,
): Promise<Response> {
  const raw = context.req.param("paymentId") ?? "";
  try {
    const id = paymentId(raw);
    const events = await dependencies.audit.listByPayment(id);
    return context.json({ audit: events.map(toPublic) });
  } catch {
    return badRequest(context, "INVALID_PAYMENT_ID");
  }
}

export async function handleWebhookAudit(
  context: Context,
  dependencies: AuditRouteDependencies,
): Promise<Response> {
  const webhookEventId = context.req.param("webhookEventId") ?? "";
  const events = await dependencies.audit.listByWebhook(webhookEventId);
  return context.json({ audit: events.map(toPublic) });
}

export async function handleCorrelationAudit(
  context: Context,
  dependencies: AuditRouteDependencies,
): Promise<Response> {
  const correlationId = context.req.query("correlationId")?.trim() ?? "";
  if (correlationId.length === 0) {
    return badRequest(context, "MISSING_CORRELATION_ID");
  }
  const events = await dependencies.audit.listByCorrelationId(correlationId);
  return context.json({ audit: events.map(toPublic) });
}
