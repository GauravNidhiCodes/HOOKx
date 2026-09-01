import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { paymentId, providerId, instant } from "@hookx/domain";
import {
  INCIDENT_LIST_LIMIT,
  toPublicIncident,
} from "@hookx/observability";
import {
  isExceptionCode,
  isExceptionSeverity,
  isExceptionStatus,
} from "@hookx/exceptions";
import type {
  AuditRepository,
  ExceptionListFilter,
  ExceptionRepository,
  InvestigationRepository,
  RetryRepository,
  WebhookEventRepository,
} from "@hookx/storage";
import { loadIncidentTimeline } from "../observability/load-timeline.js";

export type IncidentRouteDependencies = {
  readonly exceptions?: ExceptionRepository;
  readonly audit: AuditRepository;
  readonly repository: WebhookEventRepository;
  readonly retry: RetryRepository;
  readonly investigations?: InvestigationRepository;
  readonly liveProviders?: readonly string[];
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function unavailable(context: Context): Response {
  return context.json(
    { status: "not_found", code: "INCIDENTS_UNAVAILABLE" },
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
  const from = context.req.query("from")?.trim();
  const to = context.req.query("to")?.trim();
  let filter: ExceptionListFilter = { limit: INCIDENT_LIST_LIMIT };
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
  if (from !== undefined && from.length > 0) {
    try {
      filter = { ...filter, detectedFrom: instant(from) };
    } catch {
      return badRequest(context, "INVALID_INSTANT");
    }
  }
  if (to !== undefined && to.length > 0) {
    try {
      filter = { ...filter, detectedTo: instant(to) };
    } catch {
      return badRequest(context, "INVALID_INSTANT");
    }
  }
  const payment = context.req.query("paymentId")?.trim();
  if (payment !== undefined && payment.length > 0) {
    try {
      filter = { ...filter, paymentId: paymentId(payment) };
    } catch {
      return badRequest(context, "INVALID_PAYMENT_ID");
    }
  }
  return filter;
}

export async function handleListIncidents(
  context: Context,
  dependencies: IncidentRouteDependencies,
): Promise<Response> {
  if (dependencies.exceptions === undefined) {
    return unavailable(context);
  }
  const parsed = parseFilters(context);
  if (parsed instanceof Response) {
    return parsed;
  }
  const records = await dependencies.exceptions.list(parsed);
  return context.json({
    incidents: records.map((row) =>
      toPublicIncident(row, dependencies.liveProviders),
    ),
  });
}

export async function handleGetIncident(
  context: Context,
  dependencies: IncidentRouteDependencies,
): Promise<Response> {
  if (dependencies.exceptions === undefined) {
    return unavailable(context);
  }
  const id = context.req.param("id") ?? "";
  const record = await dependencies.exceptions.findById(id);
  if (record === null) {
    return context.json(
      { status: "not_found", code: "INCIDENT_NOT_FOUND" },
      404 as ContentfulStatusCode,
    );
  }
  return context.json({
    incident: toPublicIncident(record, dependencies.liveProviders),
  });
}

export async function handleGetIncidentTimeline(
  context: Context,
  dependencies: IncidentRouteDependencies,
): Promise<Response> {
  if (dependencies.exceptions === undefined) {
    return unavailable(context);
  }
  const id = context.req.param("id") ?? "";
  if (!UUID.test(id)) {
    return badRequest(context, "INVALID_INCIDENT_ID");
  }
  const offsetRaw = context.req.query("offset")?.trim();
  const limitRaw = context.req.query("limit")?.trim();
  let offset: number | undefined;
  let limit: number | undefined;
  if (offsetRaw !== undefined && offsetRaw.length > 0) {
    const parsed = Number.parseInt(offsetRaw, 10);
    if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== offsetRaw) {
      return badRequest(context, "INVALID_OFFSET");
    }
    offset = parsed;
  }
  if (limitRaw !== undefined && limitRaw.length > 0) {
    const parsed = Number.parseInt(limitRaw, 10);
    if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== limitRaw) {
      return badRequest(context, "INVALID_LIMIT");
    }
    limit = parsed;
  }
  const composed = await loadIncidentTimeline(
    {
      exceptions: dependencies.exceptions,
      audit: dependencies.audit,
      repository: dependencies.repository,
      retry: dependencies.retry,
      investigations: dependencies.investigations,
      liveProviders: dependencies.liveProviders,
    },
    id,
    {
      offset,
      limit,
    },
  );
  if (composed === null) {
    return context.json(
      { status: "not_found", code: "INCIDENT_NOT_FOUND" },
      404 as ContentfulStatusCode,
    );
  }
  return context.json({
    incident: composed.incident,
    timeline: composed.items,
    page: {
      offset: composed.offset,
      limit: composed.limit,
      total: composed.total,
    },
  });
}
