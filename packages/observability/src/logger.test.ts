import { describe, expect, it } from "vitest";
import {
  collectingLogger,
  createJsonLogger,
  sanitizeLogFields,
  type StructuredLogRecord,
} from "./index.js";

describe("structured logger", () => {
  it("emits timestamp, level, correlation, and processing fields", () => {
    const lines: string[] = [];
    const logger = createJsonLogger({
      write: (line) => {
        lines.push(line);
      },
      now: () => "2026-01-15T14:02:11.000Z",
      minLevel: "DEBUG",
    });
    logger.info("WEBHOOK RECEIVED", {
      timestamp: "2026-01-15T14:02:11.000Z",
      correlationId: "corr-1",
      provider: "SYNTHETIC",
      eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      paymentId: "SYNTHETIC:pay:1",
      eventType: "payment.created",
      processingDecision: "ACCEPTED",
      exceptionCode: "CONFLICTING_EVENT",
      lifecycle: "WEBHOOK_RECEIVED",
    });
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(record).toMatchObject({
      timestamp: "2026-01-15T14:02:11.000Z",
      level: "INFO",
      message: "WEBHOOK RECEIVED",
      correlationId: "corr-1",
      provider: "SYNTHETIC",
      eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      paymentId: "SYNTHETIC:pay:1",
      eventType: "payment.created",
      processingDecision: "ACCEPTED",
      exceptionCode: "CONFLICTING_EVENT",
      lifecycle: "WEBHOOK_RECEIVED",
    });
  });

  it("does not emit DEBUG when the minimum level is INFO", () => {
    const lines: string[] = [];
    const logger = createJsonLogger({
      write: (line) => {
        lines.push(line);
      },
      minLevel: "INFO",
    });
    logger.debug("internal", { correlationId: "corr-quiet" });
    logger.warn("SIGNATURE REJECTED", { lifecycle: "SIGNATURE_REJECTED" });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      level: "WARN",
      lifecycle: "SIGNATURE_REJECTED",
    });
  });

  it("collects records for tests without fabricating fields", () => {
    const records: StructuredLogRecord[] = [];
    const logger = collectingLogger(records);
    logger.error("PROCESSING FAILED", { correlationId: "corr-err" });
    expect(records).toHaveLength(1);
    expect(records[0]?.level).toBe("ERROR");
    expect(records[0]?.correlationId).toBe("corr-err");
    expect(records[0]?.paymentId).toBeUndefined();
  });
});

describe("sensitive-data redaction", () => {
  it("drops secrets, signatures, credentials, and payloads", () => {
    const cleaned = sanitizeLogFields({
      correlationId: "corr-safe",
      webhookSecret: "dev-only-webhook-secret",
      apiKey: "rk_live_not_real",
      signature: "aabbcc",
      authorization: "Bearer secret-token",
      payload: { amount: 1 },
      rawBody: "{\"secret\":true}",
      credential: "password",
      xApiKey: "nope",
      headers: { authorization: "Bearer x" },
    });
    expect(cleaned.correlationId).toBe("corr-safe");
    expect(JSON.stringify(cleaned)).not.toContain("dev-only-webhook-secret");
    expect(JSON.stringify(cleaned)).not.toContain("rk_live_not_real");
    expect(JSON.stringify(cleaned)).not.toContain("aabbcc");
    expect(JSON.stringify(cleaned)).not.toContain("Bearer");
    expect(JSON.stringify(cleaned)).not.toContain("password");
    expect("payload" in cleaned).toBe(false);
    expect("signature" in cleaned).toBe(false);
    expect("webhookSecret" in cleaned).toBe(false);
    expect("headers" in cleaned).toBe(false);
  });
});
