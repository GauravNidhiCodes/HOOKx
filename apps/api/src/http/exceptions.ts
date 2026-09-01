import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { sanitizeAuditMetadata } from "@hookx/audit";
import { paymentId, providerId } from "@hookx/domain";
import {
  isExceptionCode,
  isExceptionSeverity,
  isExceptionStatus,
  type ExceptionRecord,
} from "@hookx/exceptions";
import type { ExceptionListFilter, ExceptionRepository } from "@hookx/storage";

export type ExceptionRouteDependencies = {
  readonly exceptions?: ExceptionRepository;
};

type PublicException = {
  readonly exceptionId: string;
  readonly exceptionCode: string;
  readonly severity: string;
  readonly paymentId: string | null;
  readonly webhookEventId: string | null;
  readonly provider: string | null;
  readonly status: string;
  readonly reason: string;
  readonly detectedAt: string;
  readonly correlationId: string;
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
};

function toPublic(record: ExceptionRecord): PublicException {
  return {
    exceptionId: record.exceptionId,
    exceptionCode: record.exceptionCode,
    severity: record.severity,
    paymentId: record.paymentId,
    webhookEventId: record.webhookEventId,
    provider: record.provider,
    status: record.status,
    reason: record.reason,
    detectedAt: record.detectedAt,
    correlationId: record.correlationId,
    metadata: sanitizeAuditMetadata(record.metadata),
  };
}

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
  let filter: ExceptionListFilter = {};
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
  return context.json({ exceptions: records.map(toPublic) });
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
  return context.json({ exception: toPublic(record) });
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
    return context.json({ exceptions: records.map(toPublic) });
  } catch {
    return badRequest(context, "INVALID_PAYMENT_ID");
  }
}
