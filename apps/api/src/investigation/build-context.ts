import type { AuditEvent } from "@hookx/audit";
import type { Instant } from "@hookx/domain";
import type { ExceptionRecord } from "@hookx/exceptions";
import {
  applicableRulesFor,
  exceptionViewFromRecord,
  incidentViewFromRecord,
  replayViewFromEvidence,
  sanitizeInvestigationContext,
  type InvestigationAuditView,
  type InvestigationContext,
  type InvestigationRetryView,
  type InvestigationWebhookView,
} from "@hookx/investigation";
import type {
  AuditRepository,
  PaymentRepository,
  RetryRepository,
  StoredWebhookEvent,
  WebhookEventRepository,
} from "@hookx/storage";

export const MAX_INVESTIGATION_WEBHOOKS = 32;
export const MAX_INVESTIGATION_AUDIT = 64;
export const MAX_INVESTIGATION_RETRIES = 16;

export type InvestigationContextSources = {
  readonly repository: Pick<WebhookEventRepository, "findById" | "listByPayment">;
  readonly payments?: Pick<PaymentRepository, "get" | "getByPaymentId">;
  readonly retry?: Pick<RetryRepository, "getByWebhookEventId">;
  readonly audit?: Pick<
    AuditRepository,
    "listByPayment" | "listByWebhook" | "listByCorrelationId"
  >;
};

function webhookView(row: StoredWebhookEvent): InvestigationWebhookView {
  return Object.freeze({
    webhookEventId: row.id,
    externalEventId: row.event.externalEventId,
    eventType: row.event.eventType,
    occurredAt: row.event.occurredAt,
    receivedAt: row.event.receivedAt,
    processingStatus: row.processingStatus,
    amountMinor: row.event.amountMinor.toString(),
    currency: row.event.currency,
  });
}

function compareWebhooks(
  left: StoredWebhookEvent,
  right: StoredWebhookEvent,
): number {
  if (left.event.occurredAt < right.event.occurredAt) {
    return -1;
  }
  if (left.event.occurredAt > right.event.occurredAt) {
    return 1;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function capWebhooks(
  rows: readonly StoredWebhookEvent[],
  pinnedId: string | null,
): readonly StoredWebhookEvent[] {
  const sorted = rows.slice().sort(compareWebhooks);
  if (sorted.length <= MAX_INVESTIGATION_WEBHOOKS) {
    return sorted;
  }
  const pinned =
    pinnedId === null ? [] : sorted.filter((row) => row.id === pinnedId);
  const others = sorted.filter((row) => row.id !== pinnedId);
  return [...pinned, ...others].slice(0, MAX_INVESTIGATION_WEBHOOKS);
}

function auditView(row: AuditEvent): InvestigationAuditView {
  return Object.freeze({
    auditEventId: row.auditEventId,
    eventType: row.eventType,
    occurredAt: row.occurredAt,
    recordedAt: row.recordedAt,
    previousState: row.previousState,
    resultingState: row.resultingState,
    reason: row.reason,
    actor: row.actor,
  });
}

const AUDIT_PRIORITY = new Set([
  "PAYMENT_STATE_CHANGED",
  "WEBHOOK_CONFLICT",
  "WEBHOOK_CONFLICT_DETECTED",
  "EXCEPTION_DETECTED",
  "INVALID_TRANSITION_DETECTED",
  "RETRY_EXHAUSTED",
]);

function compareAudit(left: AuditEvent, right: AuditEvent): number {
  if (left.recordedAt < right.recordedAt) {
    return -1;
  }
  if (left.recordedAt > right.recordedAt) {
    return 1;
  }
  return left.auditEventId < right.auditEventId
    ? -1
    : left.auditEventId > right.auditEventId
      ? 1
      : 0;
}

function capAudit(rows: readonly AuditEvent[]): readonly AuditEvent[] {
  const unique = new Map<string, AuditEvent>();
  for (const row of rows) {
    unique.set(row.auditEventId, row);
  }
  const all = [...unique.values()];
  if (all.length <= MAX_INVESTIGATION_AUDIT) {
    return all.sort(compareAudit);
  }
  const important = all.filter((row) => AUDIT_PRIORITY.has(row.eventType));
  const rest = all.filter((row) => !AUDIT_PRIORITY.has(row.eventType));
  const selected = [...important];
  for (const row of rest) {
    if (selected.length >= MAX_INVESTIGATION_AUDIT) {
      break;
    }
    selected.push(row);
  }
  return selected.slice(0, MAX_INVESTIGATION_AUDIT).sort(compareAudit);
}

/**
 * Assemble a minimized investigation context from read-only store methods.
 * Never pass writers, secrets, raw payloads, or payload hashes into the model.
 */
export async function buildInvestigationContext(
  sources: InvestigationContextSources,
  exception: ExceptionRecord,
  investigatedAt: Instant,
  correlationId: string,
): Promise<InvestigationContext> {
  const loaded: StoredWebhookEvent[] = [];
  if (exception.provider !== null && exception.paymentId !== null) {
    loaded.push(
      ...(await sources.repository.listByPayment(
        exception.provider,
        exception.paymentId,
      )),
    );
  }
  if (exception.webhookEventId !== null) {
    const already = loaded.some((row) => row.id === exception.webhookEventId);
    if (!already) {
      const pinned = await sources.repository.findById(exception.webhookEventId);
      if (pinned !== null) {
        loaded.push(pinned);
      }
    }
  }
  const webhooks = capWebhooks(loaded, exception.webhookEventId);

  let payment = null;
  if (exception.paymentId !== null && sources.payments !== undefined) {
    const record =
      exception.provider !== null
        ? await sources.payments.get(exception.provider, exception.paymentId)
        : await sources.payments.getByPaymentId(exception.paymentId);
    if (record !== null) {
      payment = Object.freeze({
        paymentId: record.paymentId,
        provider: record.provider,
        state: record.state,
        amountMinor: record.amountMinor.toString(),
        currency: record.currency,
        lastOccurredAt: record.lastOccurredAt,
      });
    }
  }

  const retries: InvestigationRetryView[] = [];
  if (sources.retry !== undefined) {
    for (const webhook of webhooks) {
      if (retries.length >= MAX_INVESTIGATION_RETRIES) {
        break;
      }
      const retry = await sources.retry.getByWebhookEventId(webhook.id);
      if (retry !== null) {
        retries.push(
          Object.freeze({
            retryId: retry.id,
            webhookEventId: retry.webhookEventId,
            attemptCount: retry.attemptCount,
            status: retry.status,
            lastErrorCode: retry.lastErrorCode,
            lastFailedAt: retry.lastFailedAt,
            deadLettered: retry.status === "DEAD_LETTERED",
          }),
        );
      }
    }
  }

  const auditRows: AuditEvent[] = [];
  if (sources.audit !== undefined) {
    if (exception.paymentId !== null) {
      auditRows.push(
        ...(await sources.audit.listByPayment(
          exception.paymentId,
          exception.provider ?? undefined,
        )),
      );
    }
    if (exception.webhookEventId !== null) {
      auditRows.push(
        ...(await sources.audit.listByWebhook(exception.webhookEventId)),
      );
    }
    auditRows.push(
      ...(await sources.audit.listByCorrelationId(exception.correlationId)),
    );
  }

  const auditViews = Object.freeze(capAudit(auditRows).map(auditView));
  const webhookViews = Object.freeze(webhooks.map(webhookView));
  return sanitizeInvestigationContext({
    investigatedAt,
    correlationId,
    incident: incidentViewFromRecord(exception),
    exception: exceptionViewFromRecord(exception),
    payment,
    webhooks: webhookViews,
    retries: Object.freeze(retries),
    audit: auditViews,
    replay: replayViewFromEvidence(webhookViews, auditViews),
    applicableRules: applicableRulesFor(exception.exceptionCode),
    evidenceHash: "",
  });
}
