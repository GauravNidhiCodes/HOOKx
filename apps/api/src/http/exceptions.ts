import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { paymentId, providerId } from "@hookx/domain";
import {
  isExceptionCode,
  isExceptionSeverity,
  isExceptionStatus,
  toPublicException,
} from "@hookx/exceptions";
import type { ExceptionListFilter, ExceptionRepository } from "@hookx/storage";

export type ExceptionRouteDependencies = {
  readonly exceptions?: ExceptionRepository;
};

const EXCEPTION_LIST_LIMIT = 200;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function unavailable(context: Context): Response {
  return context.json(
    { status: "not_found", code: "EXCEPTIONS_UNAVAILABLE" },
    404 as ContentfulStatusCode,
  );
}

function badRequest(context: Context, code: string): Response {
  return context.json(
    { status: "bad_request", code },
    400 as ContentfulStatusCode,
  );
}

function parseFilters(context: Context): ExceptionListFilter | Response {
  const status = context.req.query("status")?.trim();
  const severity = context.req.query("severity")?.trim();
  const exceptionCode = context.req.query("exceptionCode")?.trim();
  const provider = context.req.query("provider")?.trim();
  const payment = context.req.query("paymentId")?.trim();
  const webhookEventId = context.req.query("webhookEventId")?.trim();
  const q = context.req.query("q")?.trim();
  let filter: ExceptionListFilter = { limit: EXCEPTION_LIST_LIMIT };
  if (status !== undefined && status.length > 0) {
    if (!isExceptionStatus(status)) {
      return badRequest(context, "INVALID_EXCEPTION_STATUS");
    }
    filter = { ...filter, status };
  }
  if (severity !== undefined && severity.length > 0) {
    if (!isExceptionSeverity(severity)) {
      return badRequest(context, "INVALID_EXCEPTION_SEVERITY");
    }
    filter = { ...filter, severity };
  }
  if (exceptionCode !== undefined && exceptionCode.length > 0) {
    if (!isExceptionCode(exceptionCode)) {
      return badRequest(context, "INVALID_EXCEPTION_CODE");
    }
    filter = { ...filter, exceptionCode };
  }
  if (provider !== undefined && provider.length > 0) {
    try {
      filter = { ...filter, provider: providerId(provider) };
    } catch {
      return badRequest(context, "INVALID_PROVIDER");
    }
  }
  if (payment !== undefined && payment.length > 0) {
    try {
      filter = { ...filter, paymentId: paymentId(payment) };
    } catch {
      return badRequest(context, "INVALID_PAYMENT_ID");
    }
  }
  if (webhookEventId !== undefined && webhookEventId.length > 0) {
    if (!UUID.test(webhookEventId)) {
      return badRequest(context, "INVALID_WEBHOOK_EVENT_ID");
    }
    filter = { ...filter, webhookEventId };
  }
  if (q !== undefined && q.length > 0) {
    filter = { ...filter, q };
  }
  return filter;
}

export async function handleListExceptions(
  context: Context,
  dependencies: ExceptionRouteDependencies,
): Promise<Response> {
  if (dependencies.exceptions === undefined) {
    return unavailable(context);
  }
  const parsed = parseFilters(context);
  if (parsed instanceof Response) {
    return parsed;
  }
  const records = await dependencies.exceptions.list(parsed);
  return context.json({ exceptions: records.map(toPublicException) });
}

export async function handleGetException(
  context: Context,
  dependencies: ExceptionRouteDependencies,
): Promise<Response> {
  if (dependencies.exceptions === undefined) {
    return unavailable(context);
  }
  const id = context.req.param("id") ?? "";
  const record = await dependencies.exceptions.findById(id);
  if (record === null) {
    return context.json(
      { status: "not_found", code: "EXCEPTION_NOT_FOUND" },
      404 as ContentfulStatusCode,
    );
  }
  return context.json({ exception: toPublicException(record) });
}

export async function handlePaymentExceptions(
  context: Context,
  dependencies: ExceptionRouteDependencies,
): Promise<Response> {
  if (dependencies.exceptions === undefined) {
    return unavailable(context);
  }
  const raw = context.req.param("paymentId") ?? "";
  try {
    const id = paymentId(raw);
    const records = await dependencies.exceptions.listByPayment(id);
    return context.json({ exceptions: records.map(toPublicException) });
  } catch {
    return badRequest(context, "INVALID_PAYMENT_ID");
  }
}
