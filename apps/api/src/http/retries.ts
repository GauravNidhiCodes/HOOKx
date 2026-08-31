import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type {
  DeadLetterRecord,
  RetryRecord,
  RetryRepository,
} from "@hookx/storage";

export type RetryRouteDependencies = {
  readonly retry: RetryRepository;
};

type PublicRetry = {
  readonly webhookEventId: string;
  readonly attemptCount: number;
  readonly status: string;
  readonly nextAttemptAt: string | null;
  readonly leaseExpiresAt: string | null;
  readonly lastErrorCode: string | null;
  readonly lastFailedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

type PublicDeadLetter = {
  readonly webhookEventId: string;
  readonly failureCode: string;
  readonly attemptCount: number;
  readonly deadLetteredAt: string;
};

function toPublicRetry(row: RetryRecord): PublicRetry {
  return {
    webhookEventId: row.webhookEventId,
    attemptCount: row.attemptCount,
    status: row.status,
    nextAttemptAt: row.nextAttemptAt,
    leaseExpiresAt: row.leaseExpiresAt,
    lastErrorCode: row.lastErrorCode,
    lastFailedAt: row.lastFailedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toPublicDeadLetter(row: DeadLetterRecord): PublicDeadLetter {
  return {
    webhookEventId: row.webhookEventId,
    failureCode: row.failureCode,
    attemptCount: row.attemptCount,
    deadLetteredAt: row.deadLetteredAt,
  };
}

function notFound(context: Context, requestId: string): Response {
  return context.json(
    { status: "not_found", requestId, code: "NOT_FOUND" },
    404 as ContentfulStatusCode,
  );
}

function requestIdOf(context: Context): string {
  return context.req.header("x-request-id")?.trim() || "operator";
}

export async function handleListRetries(
  context: Context,
  dependencies: RetryRouteDependencies,
): Promise<Response> {
  const retries = await dependencies.retry.listActive();
  return context.json({
    retries: retries.map(toPublicRetry),
  });
}

export async function handleGetRetry(
  context: Context,
  dependencies: RetryRouteDependencies,
): Promise<Response> {
  const webhookEventId = context.req.param("webhookEventId") ?? "";
  const row = await dependencies.retry.getByWebhookEventId(webhookEventId);
  if (row === null) {
    return notFound(context, requestIdOf(context));
  }
  return context.json({ retry: toPublicRetry(row) });
}

export async function handleListDeadLetters(
  context: Context,
  dependencies: RetryRouteDependencies,
): Promise<Response> {
  const deadLetters = await dependencies.retry.listDeadLetters();
  return context.json({
    deadLetters: deadLetters.map(toPublicDeadLetter),
  });
}

export async function handleGetDeadLetter(
  context: Context,
  dependencies: RetryRouteDependencies,
): Promise<Response> {
  const webhookEventId = context.req.param("webhookEventId") ?? "";
  const row =
    await dependencies.retry.getDeadLetterByWebhookEventId(webhookEventId);
  if (row === null) {
    return notFound(context, requestIdOf(context));
  }
  return context.json({ deadLetter: toPublicDeadLetter(row) });
}
