import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Clock } from "../clock.js";
import {
  PIPELINE_ERROR_CODE,
  pipelineHttpBody,
} from "../pipeline/errors.js";
import {
  processIncomingWebhook,
  type ProcessIncomingWebhookDependencies,
} from "../pipeline/process-incoming-webhook.js";

export type WebhookRouteDependencies = ProcessIncomingWebhookDependencies & {
  readonly clock: Clock;
};

/** Reject oversized webhook bodies before signature verification. */
export const WEBHOOK_MAX_BODY_BYTES = 256 * 1024;

function requestHeaderMap(request: Request): Map<string, string> {
  const headers = new Map<string, string>();
  request.headers.forEach((value, key) => {
    headers.set(key.toLowerCase(), value);
  });
  return headers;
}

function resolveRequestId(headers: ReadonlyMap<string, string>): string {
  const incomingRequestId = headers.get("x-request-id")?.trim();
  if (incomingRequestId !== undefined && incomingRequestId.length > 0) {
    return incomingRequestId;
  }
  return randomUUID();
}

/**
 * Razorpay (and the synthetic provider) sign the exact request bytes.
 * `application/json` is required; charset parameters are allowed.
 * JSON is not parsed here — verification uses the raw ArrayBuffer.
 */
function isJsonContentType(value: string | undefined): boolean {
  if (value === undefined || value.length === 0) {
    return false;
  }
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json";
}

function declaredContentLengthExceedsLimit(headers: Headers): boolean {
  const raw = headers.get("content-length");
  if (raw === null || raw.trim().length === 0) {
    return false;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > WEBHOOK_MAX_BODY_BYTES;
}

function rejectEarly(
  context: Context,
  requestId: string,
  httpStatus: ContentfulStatusCode,
  code: string,
): Response {
  context.header("X-Request-Id", requestId);
  return context.json(pipelineHttpBody("error", requestId, code), httpStatus);
}

export async function handleWebhookPost(
  context: Context,
  dependencies: WebhookRouteDependencies,
): Promise<Response> {
  const provider = context.req.param("provider") ?? "";
  const headers = requestHeaderMap(context.req.raw);
  const requestId = resolveRequestId(headers);

  if (!isJsonContentType(context.req.header("content-type"))) {
    return rejectEarly(
      context,
      requestId,
      415,
      PIPELINE_ERROR_CODE.UNSUPPORTED_MEDIA_TYPE,
    );
  }

  if (declaredContentLengthExceedsLimit(context.req.raw.headers)) {
    return rejectEarly(
      context,
      requestId,
      413,
      PIPELINE_ERROR_CODE.PAYLOAD_TOO_LARGE,
    );
  }

  const rawBody = new Uint8Array(await context.req.raw.arrayBuffer());
  if (rawBody.byteLength > WEBHOOK_MAX_BODY_BYTES) {
    return rejectEarly(
      context,
      requestId,
      413,
      PIPELINE_ERROR_CODE.PAYLOAD_TOO_LARGE,
    );
  }

  const result = await processIncomingWebhook(dependencies, {
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
