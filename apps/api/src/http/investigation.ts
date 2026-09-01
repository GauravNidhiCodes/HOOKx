import { randomUUID } from "node:crypto";
import type { Instant } from "@hookx/domain";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  InvestigationError,
  UnavailableInvestigator,
  type InvestigationRecord,
  type Investigator,
} from "@hookx/investigation";
import type {
  AuditRepository,
  ExceptionRepository,
  InvestigationRepository,
  PaymentRepository,
  RetryRepository,
  WebhookEventRepository,
} from "@hookx/storage";
import type { Clock } from "../clock.js";
import { buildInvestigationContext } from "../investigation/build-context.js";

export type InvestigationRouteDependencies = {
  readonly clock: Clock;
  readonly repository: WebhookEventRepository;
  readonly exceptions?: ExceptionRepository;
  readonly investigations?: InvestigationRepository;
  readonly investigator?: Investigator;
  readonly payments?: PaymentRepository;
  readonly retry?: RetryRepository;
  readonly audit?: AuditRepository;
};

type PublicInvestigation = {
  readonly investigationId: string;
  readonly exceptionId: string;
  readonly investigator: string;
  readonly modelId: string | null;
  readonly promptVersion: string;
  readonly createdAt: string;
  readonly correlationId: string;
  readonly result: InvestigationRecord["result"];
};

const CORRELATION = /^[A-Za-z0-9._:~-]+$/;

function toPublic(record: InvestigationRecord): PublicInvestigation {
  return {
    investigationId: record.investigationId,
    exceptionId: record.exceptionId,
    investigator: record.investigator,
    modelId: record.modelId,
    promptVersion: record.promptVersion,
    createdAt: record.createdAt,
    correlationId: record.correlationId,
    result: record.result,
  };
}

function unavailable(context: Context, code: string): Response {
  return context.json(
    { status: "not_found", code },
    404 as ContentfulStatusCode,
  );
}

function investigationCorrelationId(raw: string | undefined): string {
  const value = raw?.trim() ?? "";
  if (value.length > 0 && CORRELATION.test(value)) {
    return value;
  }
  return randomUUID();
}

function resolveInvestigator(investigator: Investigator | undefined): Investigator {
  return investigator ?? new UnavailableInvestigator("Investigator is not configured");
}

async function persistUnavailable(
  investigations: InvestigationRepository,
  exceptionId: string,
  context: Awaited<ReturnType<typeof buildInvestigationContext>>,
  createdAt: Instant,
  correlationId: string,
  reason: string,
): Promise<InvestigationRecord> {
  const fallback = new UnavailableInvestigator(reason);
  const result = await fallback.investigate(context);
  return investigations.create({
    exceptionId,
    investigator: fallback.implementation,
    modelId: fallback.modelId,
    promptVersion: fallback.promptVersion,
    result,
    createdAt,
    correlationId,
  });
}

export async function handleGetInvestigation(
  context: Context,
  dependencies: InvestigationRouteDependencies,
): Promise<Response> {
  if (
    dependencies.exceptions === undefined ||
    dependencies.investigations === undefined
  ) {
    return unavailable(context, "INVESTIGATIONS_UNAVAILABLE");
  }
  const id = context.req.param("id") ?? "";
  const exception = await dependencies.exceptions.findById(id);
  if (exception === null) {
    return unavailable(context, "EXCEPTION_NOT_FOUND");
  }
  const record = await dependencies.investigations.findLatestByExceptionId(id);
  if (record === null) {
    return unavailable(context, "INVESTIGATION_NOT_FOUND");
  }
  return context.json({ investigation: toPublic(record) });
}

export async function handlePostInvestigate(
  context: Context,
  dependencies: InvestigationRouteDependencies,
): Promise<Response> {
  if (
    dependencies.exceptions === undefined ||
    dependencies.investigations === undefined
  ) {
    return unavailable(context, "INVESTIGATIONS_UNAVAILABLE");
  }
  const id = context.req.param("id") ?? "";
  const exception = await dependencies.exceptions.findById(id);
  if (exception === null) {
    return unavailable(context, "EXCEPTION_NOT_FOUND");
  }
  const now = dependencies.clock.now();
  const correlationId = investigationCorrelationId(
    context.req.header("x-request-id"),
  );
  const investigationContext = await buildInvestigationContext(
    {
      repository: dependencies.repository,
      payments: dependencies.payments,
      retry: dependencies.retry,
      audit: dependencies.audit,
    },
    exception,
    now,
    correlationId,
  );
  const investigator = resolveInvestigator(dependencies.investigator);
  try {
    const result = await investigator.investigate(investigationContext);
    const record = await dependencies.investigations.create({
      exceptionId: exception.exceptionId,
      investigator: investigator.implementation,
      modelId: investigator.modelId,
      promptVersion: investigator.promptVersion,
      result,
      createdAt: now,
      correlationId,
    });
    return context.json({ investigation: toPublic(record) });
  } catch (error) {
    const reason =
      error instanceof InvestigationError
        ? error.message
        : "AI provider unavailable";
    const record = await persistUnavailable(
      dependencies.investigations,
      exception.exceptionId,
      investigationContext,
      now,
      correlationId,
      reason,
    );
    return context.json({ investigation: toPublic(record) });
  }
}
