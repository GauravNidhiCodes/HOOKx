import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { paymentId, providerId } from "@hookx/domain";
import type { PaymentRepository, StoredPayment } from "@hookx/storage";

export type PaymentRouteDependencies = {
  readonly payments?: PaymentRepository;
};

type PublicPayment = {
  readonly provider: string;
  readonly paymentId: string;
  readonly state: string;
  readonly amountMinor: string;
  readonly currency: string;
  readonly lastOccurredAt: string;
  readonly updatedAt: string;
};

function toPublic(record: StoredPayment): PublicPayment {
  return {
    provider: record.provider,
    paymentId: record.paymentId,
    state: record.state,
    amountMinor: record.amountMinor.toString(),
    currency: record.currency,
    lastOccurredAt: record.lastOccurredAt,
    updatedAt: record.updatedAt,
  };
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
  return context.json({ payment: toPublic(record) });
}
