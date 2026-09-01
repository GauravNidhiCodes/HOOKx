import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { paymentId, providerId } from "@hookx/domain";
import type {
  PaymentRepository,
  StoredWebhookEvent,
  WebhookEventRepository,
} from "@hookx/storage";

export type WebhookReadDependencies = {
  readonly repository: WebhookEventRepository;
  readonly payments?: PaymentRepository;
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
};

export function toPublicWebhookEvent(
  record: StoredWebhookEvent,
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

export async function handleGetWebhookEvent(
  context: Context,
  dependencies: WebhookReadDependencies,
): Promise<Response> {
  const id = context.req.param("webhookEventId") ?? "";
  const record = await dependencies.repository.findById(id);
  if (record === null) {
    return notFound(context, "WEBHOOK_NOT_FOUND");
  }
  return context.json({ webhook: toPublicWebhookEvent(record) });
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
  return context.json({ webhooks: records.map(toPublicWebhookEvent) });
}
