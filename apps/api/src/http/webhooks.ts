import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Clock } from "../clock.js";
import { ingestWebhook, type IngestDependencies } from "../ingest/ingest-webhook.js";

export type WebhookRouteDependencies = IngestDependencies & {
  readonly clock: Clock;
};

function requestHeaderMap(request: Request): Map<string, string> {
  const headers = new Map<string, string>();
  request.headers.forEach((value, key) => {
    headers.set(key.toLowerCase(), value);
  });
  return headers;
}

export async function handleWebhookPost(
  context: Context,
  dependencies: WebhookRouteDependencies,
): Promise<Response> {
  const provider = context.req.param("provider") ?? "";
  const rawBody = new Uint8Array(await context.req.raw.arrayBuffer());
  const headers = requestHeaderMap(context.req.raw);
  const incomingRequestId = headers.get("x-request-id")?.trim();
  const requestId =
    incomingRequestId !== undefined && incomingRequestId.length > 0
      ? incomingRequestId
      : randomUUID();

  const result = await ingestWebhook(dependencies, {
    provider,
    rawBody,
    headers,
    requestId,
    now: dependencies.clock.now(),
  });

  context.header("X-Request-Id", result.body.requestId);
  return context.json(
    result.body,
    result.httpStatus as ContentfulStatusCode,
  );
}
