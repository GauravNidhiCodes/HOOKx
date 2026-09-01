import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  isPaymentState,
  paymentId,
  providerId,
  type Instant,
} from "@hookx/domain";
import type {
  ExceptionRepository,
  PaymentListFilter,
  PaymentRepository,
  StoredPayment,
  StoredWebhookEvent,
  WebhookEventRepository,
} from "@hookx/storage";

export type PaymentRouteDependencies = {
  readonly payments?: PaymentRepository;
  readonly repository?: WebhookEventRepository;
  readonly exceptions?: ExceptionRepository;
};

export type PublicPayment = {
  readonly provider: string;
  readonly paymentId: string;
  readonly state: string;
  readonly amountMinor: string;
  readonly currency: string;
  readonly createdAt: string;
  readonly lastOccurredAt: string;
  readonly updatedAt: string;
};

export type PublicPaymentListItem = PublicPayment & {
  readonly exceptionCount: number;
};

export function createdAtFromWebhooks(
  fallback: Instant,
  records: readonly StoredWebhookEvent[],
): Instant {
  let earliest = fallback;
  for (const row of records) {
    if (row.event.occurredAt < earliest) {
      earliest = row.event.occurredAt;
    }
  }
  return earliest;
}

function toPublic(record: StoredPayment, createdAt: Instant): PublicPayment {
  return {
    provider: record.provider,
    paymentId: record.paymentId,
    state: record.state,
    amountMinor: record.amountMinor.toString(),
    currency: record.currency,
    createdAt,
    lastOccurredAt: record.lastOccurredAt,
    updatedAt: record.updatedAt,
  };
}

function unavailable(context: Context): Response {
  return context.json(
    { status: "not_found", code: "PAYMENTS_UNAVAILABLE" },
    404 as ContentfulStatusCode,
  );
}

function badRequest(context: Context, code: string): Response {
  return context.json(
    { status: "bad_request", code },
    400 as ContentfulStatusCode,
  );
}

function parseListFilter(context: Context): PaymentListFilter | Response {
  const q = context.req.query("q")?.trim();
  const provider = context.req.query("provider")?.trim();
  const state = context.req.query("state")?.trim();
  let filter: PaymentListFilter = {};
  if (q !== undefined && q.length > 0) {
    filter = { ...filter, q };
  }
  if (provider !== undefined && provider.length > 0) {
    try {
      filter = { ...filter, provider: providerId(provider) };
    } catch {
      return badRequest(context, "INVALID_PROVIDER");
    }
  }
  if (state !== undefined && state.length > 0) {
    if (!isPaymentState(state)) {
      return badRequest(context, "INVALID_PAYMENT_STATE");
    }
    filter = { ...filter, state };
  }
  return filter;
}

async function createdAtFor(
  record: StoredPayment,
  repository: WebhookEventRepository | undefined,
): Promise<Instant> {
  if (repository === undefined) {
    return record.lastOccurredAt;
  }
  const events = await repository.listByPayment(
    record.provider,
    record.paymentId,
  );
  return createdAtFromWebhooks(record.lastOccurredAt, events);
}

export async function handleListPayments(
  context: Context,
  dependencies: PaymentRouteDependencies,
): Promise<Response> {
  if (dependencies.payments === undefined) {
    return unavailable(context);
  }
  const parsed = parseListFilter(context);
  if (parsed instanceof Response) {
    return parsed;
  }
  const records = await dependencies.payments.list(parsed);
  const counts = new Map<string, number>();
  const exceptions = dependencies.exceptions;
  if (exceptions !== undefined) {
    await Promise.all(
      records.map(async (record) => {
        const n = await exceptions.count({ paymentId: record.paymentId });
        counts.set(record.paymentId, n);
      }),
    );
  }
  const earliestByKey = new Map<string, Instant>();
  if (dependencies.repository !== undefined) {
    const webhooks = await dependencies.repository.list();
    for (const row of webhooks) {
      const key = `${row.event.provider}\0${row.event.paymentId}`;
      const current = earliestByKey.get(key);
      if (current === undefined || row.event.occurredAt < current) {
        earliestByKey.set(key, row.event.occurredAt);
      }
    }
  }
  const payments: PublicPaymentListItem[] = records.map((record) => {
    const key = `${record.provider}\0${record.paymentId}`;
    const createdAt = earliestByKey.get(key) ?? record.lastOccurredAt;
    return {
      ...toPublic(record, createdAt),
      exceptionCount: counts.get(record.paymentId) ?? 0,
    };
  });
  return context.json({ payments });
}

export async function handleGetPayment(
  context: Context,
  dependencies: PaymentRouteDependencies,
): Promise<Response> {
  if (dependencies.payments === undefined) {
    return context.json(
      { status: "not_found", code: "PAYMENT_NOT_FOUND" },
      404 as ContentfulStatusCode,
    );
  }
  const raw = context.req.param("paymentId") ?? "";
  let id;
  try {
    id = paymentId(raw);
  } catch {
    return context.json(
      { status: "bad_request", code: "INVALID_PAYMENT_ID" },
      400 as ContentfulStatusCode,
    );
  }
  const providerParam = context.req.query("provider")?.trim();
  let record;
  try {
    record =
      providerParam !== undefined && providerParam.length > 0
        ? await dependencies.payments.get(providerId(providerParam), id)
        : await dependencies.payments.getByPaymentId(id);
  } catch {
    return context.json(
      { status: "bad_request", code: "INVALID_PROVIDER" },
      400 as ContentfulStatusCode,
    );
  }
  if (record === null) {
    return context.json(
      { status: "not_found", code: "PAYMENT_NOT_FOUND" },
      404 as ContentfulStatusCode,
    );
  }
  const createdAt = await createdAtFor(record, dependencies.repository);
  return context.json({ payment: toPublic(record, createdAt) });
}
