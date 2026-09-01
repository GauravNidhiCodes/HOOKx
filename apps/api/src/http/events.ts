import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { paymentId, providerId } from "@hookx/domain";
import type {
  AuditRepository,
  PaymentRepository,
  RetryRepository,
  StoredWebhookEvent,
  WebhookEventRepository,
  WebhookListFilter,
} from "@hookx/storage";
import { isWebhookProcessingStatus } from "@hookx/storage";
import { isWebhookEventType } from "@hookx/webhook";
import { processingFromAudit } from "./processing.js";

export type WebhookReadDependencies = {
  readonly repository: WebhookEventRepository;
  readonly payments?: PaymentRepository;
  readonly retry?: RetryRepository;
  readonly audit?: AuditRepository;
};

export type PublicWebhookEvent = {
  readonly webhookEventId: string;
  readonly provider: string;
  readonly externalEventId: string;
  readonly paymentId: string;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly receivedAt: string;
  readonly amountMinor: string;
  readonly currency: string;
  readonly processingStatus: string;
  readonly deliveryAttempt: number;
};

export function toPublicWebhookEvent(
  record: StoredWebhookEvent,
  deliveryAttempt = 1,
): PublicWebhookEvent {
  return {
    webhookEventId: record.id,
    provider: record.event.provider,
    externalEventId: record.event.externalEventId,
    paymentId: record.event.paymentId,
    eventType: record.event.eventType,
    occurredAt: record.event.occurredAt,
    receivedAt: record.event.receivedAt,
    amountMinor: record.event.amountMinor.toString(),
    currency: record.event.currency,
    processingStatus: record.processingStatus,
    deliveryAttempt,
  };
}

function notFound(context: Context, code: string): Response {
  return context.json(
    { status: "not_found", code },
    404 as ContentfulStatusCode,
  );
}

function badRequest(context: Context, code: string): Response {
  return context.json(
    { status: "bad_request", code },
    400 as ContentfulStatusCode,
  );
}

function parseListFilter(context: Context): WebhookListFilter | Response {
  const q = context.req.query("q")?.trim();
  const eventType = context.req.query("eventType")?.trim();
  const processingStatus = context.req.query("processingStatus")?.trim();
  const payment = context.req.query("paymentId")?.trim();
  const provider = context.req.query("provider")?.trim();
  let filter: WebhookListFilter = {};
  if (q !== undefined && q.length > 0) {
    filter = { ...filter, q };
  }
  if (eventType !== undefined && eventType.length > 0) {
    if (!isWebhookEventType(eventType)) {
      return badRequest(context, "INVALID_EVENT_TYPE");
    }
    filter = { ...filter, eventType };
  }
  if (processingStatus !== undefined && processingStatus.length > 0) {
    if (!isWebhookProcessingStatus(processingStatus)) {
      return badRequest(context, "INVALID_PROCESSING_STATUS");
    }
    filter = { ...filter, processingStatus };
  }
  if (payment !== undefined && payment.length > 0) {
    try {
      filter = { ...filter, paymentId: paymentId(payment) };
    } catch {
      return badRequest(context, "INVALID_PAYMENT_ID");
    }
  }
  if (provider !== undefined && provider.length > 0) {
    try {
      filter = { ...filter, provider: providerId(provider) };
    } catch {
      return badRequest(context, "INVALID_PROVIDER");
    }
  }
  return filter;
}

async function deliveryAttemptsById(
  retry: RetryRepository | undefined,
): Promise<ReadonlyMap<string, number>> {
  const map = new Map<string, number>();
  if (retry === undefined) {
    return map;
  }
  const [active, dead] = await Promise.all([
    retry.listActive(),
    retry.listDeadLetters(),
  ]);
  for (const row of active) {
    map.set(row.webhookEventId, Math.max(1, row.attemptCount));
  }
  for (const row of dead) {
    map.set(row.webhookEventId, Math.max(1, row.attemptCount));
  }
  return map;
}

function attemptOf(
  map: ReadonlyMap<string, number>,
  webhookEventId: string,
): number {
  return map.get(webhookEventId) ?? 1;
}

export async function handleListWebhooks(
  context: Context,
  dependencies: WebhookReadDependencies,
): Promise<Response> {
  const parsed = parseListFilter(context);
  if (parsed instanceof Response) {
    return parsed;
  }
  const records = await dependencies.repository.list(parsed);
  const attempts = await deliveryAttemptsById(dependencies.retry);
  return context.json({
    webhooks: records.map((row) =>
      toPublicWebhookEvent(row, attemptOf(attempts, row.id)),
    ),
  });
}

export async function handleGetWebhookEvent(
  context: Context,
  dependencies: WebhookReadDependencies,
): Promise<Response> {
  const id = context.req.param("webhookEventId") ?? "";
  const record = await dependencies.repository.findById(id);
  if (record === null) {
    return notFound(context, "WEBHOOK_NOT_FOUND");
  }
  const attempts = await deliveryAttemptsById(dependencies.retry);
  const audit =
    dependencies.audit === undefined
      ? []
      : await dependencies.audit.listByWebhook(record.id);
  return context.json({
    webhook: toPublicWebhookEvent(record, attemptOf(attempts, record.id)),
    processing: processingFromAudit(record.processingStatus, audit),
  });
}

export async function handlePaymentWebhooks(
  context: Context,
  dependencies: WebhookReadDependencies,
): Promise<Response> {
  const raw = context.req.param("paymentId") ?? "";
  let id;
  try {
    id = paymentId(raw);
  } catch {
    return badRequest(context, "INVALID_PAYMENT_ID");
  }
  const providerParam = context.req.query("provider")?.trim();
  let provider;
  try {
    if (providerParam !== undefined && providerParam.length > 0) {
      provider = providerId(providerParam);
    } else if (dependencies.payments !== undefined) {
      const payment = await dependencies.payments.getByPaymentId(id);
      provider = payment?.provider;
    }
  } catch {
    return badRequest(context, "INVALID_PROVIDER");
  }
  if (provider === undefined) {
    return notFound(context, "PAYMENT_NOT_FOUND");
  }
  const records = await dependencies.repository.listByPayment(provider, id);
  const attempts = await deliveryAttemptsById(dependencies.retry);
  return context.json({
    webhooks: records.map((row) =>
      toPublicWebhookEvent(row, attemptOf(attempts, row.id)),
    ),
  });
}
