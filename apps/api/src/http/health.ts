import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export async function handleHealth(context: Context): Promise<Response> {
  return context.json({ status: "ok" });
}

export async function handleReady(
  context: Context,
  ping?: () => Promise<void>,
): Promise<Response> {
  if (ping === undefined) {
    return context.json(
      { status: "not_configured", code: "READINESS_UNAVAILABLE" },
      503 as ContentfulStatusCode,
    );
  }
  try {
    await ping();
    return context.json({ status: "ready" });
  } catch {
    return context.json(
      { status: "unavailable", code: "DEPENDENCY_UNAVAILABLE" },
      503 as ContentfulStatusCode,
    );
  }
}
