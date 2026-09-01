import { sanitizeAuditMetadata } from "@hookx/audit";
import {
  composeIncidentTimeline,
  type ComposedIncidentTimeline,
} from "@hookx/observability";
import { classifyFailure } from "@hookx/storage";
import type {
  AuditRepository,
  ExceptionRepository,
  InvestigationRepository,
  RetryRepository,
  StoredWebhookEvent,
  WebhookEventRepository,
} from "@hookx/storage";
import type { AuditEvent } from "@hookx/audit";

export type TimelineLoadDependencies = {
  readonly exceptions: ExceptionRepository;
  readonly audit: AuditRepository;
  readonly repository: WebhookEventRepository;
  readonly retry: RetryRepository;
  readonly investigations?: InvestigationRepository;
  readonly liveProviders?: readonly string[];
};

function toTimelineWebhook(row: StoredWebhookEvent) {
  return {
    webhookEventId: row.id,
    occurredAt: row.event.occurredAt,
    receivedAt: row.event.receivedAt,
    eventType: row.event.eventType,
    provider: row.event.provider,
    paymentId: row.event.paymentId,
  };
}

function toTimelineAudit(event: AuditEvent) {
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
    reason: event.reason,
    correlationId: event.correlationId,
    metadata: sanitizeAuditMetadata(event.metadata),
  };
}

export async function loadIncidentTimeline(
  dependencies: TimelineLoadDependencies,
  exceptionId: string,
  page: { readonly offset?: number; readonly limit?: number } = {},
): Promise<ComposedIncidentTimeline | null> {
  const record = await dependencies.exceptions.findById(exceptionId);
  if (record === null) {
    return null;
  }

  let webhooks: StoredWebhookEvent[] = [];
  let audit: AuditEvent[];
  if (record.paymentId !== null) {
    if (record.provider !== null) {
      webhooks = [
        ...(await dependencies.repository.listByPayment(
          record.provider,
          record.paymentId,
        )),
      ];
      audit = [
        ...(await dependencies.audit.listByPayment(
          record.paymentId,
          record.provider,
        )),
      ];
    } else {
      audit = [...(await dependencies.audit.listByPayment(record.paymentId))];
    }
  } else if (record.webhookEventId !== null) {
    const stored = await dependencies.repository.findById(record.webhookEventId);
    if (stored !== null) {
      webhooks = [stored];
    }
    audit = [...(await dependencies.audit.listByWebhook(record.webhookEventId))];
  } else {
    audit = [
      ...(await dependencies.audit.listByCorrelationId(record.correlationId)),
    ];
  }

  const retry =
    record.webhookEventId === null
      ? null
      : await dependencies.retry.getByWebhookEventId(record.webhookEventId);
  const deadLetter =
    record.webhookEventId === null
      ? null
      : await dependencies.retry.getDeadLetterByWebhookEventId(
          record.webhookEventId,
        );
  const investigation =
    dependencies.investigations === undefined
      ? null
      : await dependencies.investigations.findLatestByExceptionId(exceptionId);

  return composeIncidentTimeline({
    exception: {
      exceptionId: record.exceptionId,
      exceptionCode: record.exceptionCode,
      severity: record.severity,
      status: record.status,
      paymentId: record.paymentId,
      webhookEventId: record.webhookEventId,
      provider: record.provider,
      reason: record.reason,
      detectedAt: record.detectedAt,
      correlationId: record.correlationId,
    },
    audit: audit.map(toTimelineAudit),
    webhooks: webhooks.map(toTimelineWebhook),
    retry:
      retry === null
        ? null
        : {
            webhookEventId: retry.webhookEventId,
            attemptCount: retry.attemptCount,
            status: retry.status,
            nextAttemptAt: retry.nextAttemptAt,
            lastErrorCode: retry.lastErrorCode,
            lastFailedAt: retry.lastFailedAt,
          },
    deadLetter:
      deadLetter === null
        ? null
        : {
            webhookEventId: deadLetter.webhookEventId,
            failureCode: deadLetter.failureCode,
            attemptCount: deadLetter.attemptCount,
            deadLetteredAt: deadLetter.deadLetteredAt,
          },
    investigation:
      investigation === null
        ? null
        : {
            investigationId: investigation.investigationId,
            createdAt: investigation.createdAt,
            correlationId: investigation.correlationId,
          },
    liveProviders: dependencies.liveProviders,
    classifyFailure,
    offset: page.offset,
    limit: page.limit,
  });
}
