import type {
  ExceptionListQuery,
  IncidentListQuery,
  PaymentListQuery,
  PublicAuditEvent,
  PublicDeadLetter,
  PublicException,
  PublicIncident,
  PublicIncidentTimelineItem,
  PublicInvestigation,
  PublicPayment,
  PublicPaymentListItem,
  PublicRetry,
  PublicWebhookEvent,
  WebhookListQuery,
  FailureLabCatalog,
  FailureLabResetResult,
  FailureLabRunReport,
  FailureLabScenarioId,
} from "./types";

export class ApiError extends Error {
  public readonly code: string;
  public readonly correlationId: string;
  public readonly httpStatus: number;

  public constructor(
    code: string,
    correlationId: string,
    httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.correlationId = correlationId;
    this.httpStatus = httpStatus;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    (value as { name: unknown }).name === "ApiError" &&
    "correlationId" in value &&
    "code" in value &&
    typeof (value as { correlationId: unknown }).correlationId === "string" &&
    typeof (value as { code: unknown }).code === "string"
  );
}

export type HookxApi = {
  listExceptions(query: ExceptionListQuery): Promise<readonly PublicException[]>;
  getException(id: string): Promise<PublicException>;
  listIncidents(query: IncidentListQuery): Promise<readonly PublicIncident[]>;
  getIncident(id: string): Promise<PublicIncident>;
  getIncidentTimeline(
    id: string,
  ): Promise<{
    readonly incident: PublicIncident;
    readonly timeline: readonly PublicIncidentTimelineItem[];
  }>;
  listPayments(query?: PaymentListQuery): Promise<readonly PublicPaymentListItem[]>;
  getPayment(paymentId: string, provider?: string): Promise<PublicPayment | null>;
  listPaymentExceptions(paymentId: string): Promise<readonly PublicException[]>;
  listWebhooks(query?: WebhookListQuery): Promise<readonly PublicWebhookEvent[]>;
  getWebhook(webhookEventId: string): Promise<PublicWebhookEvent | null>;
  listPaymentWebhooks(paymentId: string, provider?: string): Promise<readonly PublicWebhookEvent[]>;
  listPaymentAudit(paymentId: string): Promise<readonly PublicAuditEvent[]>;
  listWebhookAudit(webhookEventId: string): Promise<readonly PublicAuditEvent[]>;
  getRetry(webhookEventId: string): Promise<PublicRetry | null>;
  getDeadLetter(webhookEventId: string): Promise<PublicDeadLetter | null>;
  getInvestigation(exceptionId: string): Promise<PublicInvestigation | null>;
  investigate(exceptionId: string): Promise<PublicInvestigation>;
  getFailureLabCatalog(): Promise<FailureLabCatalog>;
  runFailureLab(scenario: FailureLabScenarioId): Promise<FailureLabRunReport>;
  getFailureLabRun(runId: string): Promise<FailureLabRunReport>;
  resetFailureLab(confirm: string): Promise<FailureLabResetResult>;
};

function queryString(query: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value.length > 0) {
      params.set(key, value);
    }
  }
  const encoded = params.toString();
  return encoded.length === 0 ? "" : `?${encoded}`;
}

export function createBrowserApi(baseUrl = ""): HookxApi {
  async function request(
    path: string,
    init: RequestInit = {},
  ): Promise<{ status: number; body: unknown; correlationId: string }> {
    const correlationId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `corr-${Date.now()}`;
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        "x-request-id": correlationId,
        ...init.headers,
      },
    });
    const body: unknown = await response.json().catch(() => null);
    return { status: response.status, body, correlationId };
  }

  function fail(
    status: number,
    body: unknown,
    correlationId: string,
    fallback: string,
  ): never {
    const code =
      typeof body === "object" &&
      body !== null &&
      "code" in body &&
      typeof body.code === "string"
        ? body.code
        : fallback;
    throw new ApiError(code, correlationId, status, fallback);
  }

  return {
    async listExceptions(query) {
      const { status, body, correlationId } = await request(
        `/exceptions${queryString({
          status: query.status,
          severity: query.severity,
          exceptionCode: query.exceptionCode,
          provider: query.provider,
          q: query.q,
          paymentId: query.paymentId,
        })}`,
      );
      if (status !== 200) {
        fail(status, body, correlationId, "UNABLE TO LOAD EXCEPTIONS");
      }
      if (typeof body !== "object" || body === null || !("exceptions" in body)) {
        fail(status, body, correlationId, "UNABLE TO LOAD EXCEPTIONS");
      }
      return (body as { exceptions: PublicException[] }).exceptions;
    },

    async getException(id) {
      const { status, body, correlationId } = await request(
        `/exceptions/${encodeURIComponent(id)}`,
      );
      if (status !== 200) {
        fail(status, body, correlationId, "UNABLE TO LOAD EXCEPTION");
      }
      if (typeof body !== "object" || body === null || !("exception" in body)) {
        fail(status, body, correlationId, "UNABLE TO LOAD EXCEPTION");
      }
      return (body as { exception: PublicException }).exception;
    },

    async listIncidents(query) {
      const { status, body, correlationId } = await request(
        `/incidents${queryString({
          status: query.status,
          severity: query.severity,
          exceptionCode: query.exceptionCode,
          provider: query.provider,
          from: query.from,
          to: query.to,
        })}`,
      );
      if (status !== 200) {
        fail(status, body, correlationId, "UNABLE TO LOAD INCIDENTS");
      }
      if (typeof body !== "object" || body === null || !("incidents" in body)) {
        fail(status, body, correlationId, "UNABLE TO LOAD INCIDENTS");
      }
      return (body as { incidents: PublicIncident[] }).incidents;
    },

    async getIncident(id) {
      const { status, body, correlationId } = await request(
        `/incidents/${encodeURIComponent(id)}`,
      );
      if (status !== 200) {
        fail(status, body, correlationId, "UNABLE TO LOAD INCIDENT");
      }
      if (typeof body !== "object" || body === null || !("incident" in body)) {
        fail(status, body, correlationId, "UNABLE TO LOAD INCIDENT");
      }
      return (body as { incident: PublicIncident }).incident;
    },

    async getIncidentTimeline(id) {
      const { status, body, correlationId } = await request(
        `/incidents/${encodeURIComponent(id)}/timeline`,
      );
      if (status !== 200) {
        fail(status, body, correlationId, "UNABLE TO LOAD TIMELINE");
      }
      if (
        typeof body !== "object" ||
        body === null ||
        !("incident" in body) ||
        !("timeline" in body)
      ) {
        fail(status, body, correlationId, "UNABLE TO LOAD TIMELINE");
      }
      const payload = body as {
        incident: PublicIncident;
        timeline: PublicIncidentTimelineItem[];
      };
      return { incident: payload.incident, timeline: payload.timeline };
    },

    async listPayments(query = {}) {
      const { status, body, correlationId } = await request(
        `/payments${queryString({
          q: query.q,
          provider: query.provider,
          state: query.state,
        })}`,
      );
      if (status !== 200) {
        fail(status, body, correlationId, "UNABLE TO LOAD PAYMENT");
      }
      if (typeof body !== "object" || body === null || !("payments" in body)) {
        fail(status, body, correlationId, "UNABLE TO LOAD PAYMENT");
      }
      return (body as { payments: PublicPaymentListItem[] }).payments;
    },

    async getPayment(paymentId, provider) {
      const { status, body, correlationId } = await request(
        `/payments/${encodeURIComponent(paymentId)}${queryString({ provider })}`,
      );
      if (status === 404) {
        return null;
      }
      if (status !== 200) {
        fail(status, body, correlationId, "UNABLE TO LOAD PAYMENT");
      }
      return (body as { payment: PublicPayment }).payment;
    },

    async listPaymentExceptions(paymentId) {
      const { status, body, correlationId } = await request(
        `/payments/${encodeURIComponent(paymentId)}/exceptions`,
      );
      if (status === 404) {
        return [];
      }
      if (status !== 200) {
        fail(status, body, correlationId, "UNABLE TO LOAD EXCEPTION");
      }
      return (body as { exceptions: PublicException[] }).exceptions;
    },

    async listWebhooks(query = {}) {
      const { status, body, correlationId } = await request(
        `/webhooks${queryString({
          q: query.q,
          eventType: query.eventType,
          processingStatus: query.processingStatus,
          paymentId: query.paymentId,
          provider: query.provider,
        })}`,
      );
      if (status !== 200) {
        fail(status, body, correlationId, "UNABLE TO LOAD EVENT");
      }
      if (typeof body !== "object" || body === null || !("webhooks" in body)) {
        fail(status, body, correlationId, "UNABLE TO LOAD EVENT");
      }
      return (body as { webhooks: PublicWebhookEvent[] }).webhooks;
    },

    async getWebhook(webhookEventId) {
      const { status, body, correlationId } = await request(
        `/webhooks/${encodeURIComponent(webhookEventId)}`,
      );
      if (status === 404) {
        return null;
      }
      if (status !== 200) {
        fail(status, body, correlationId, "UNABLE TO LOAD EVENT");
      }
      return (body as { webhook: PublicWebhookEvent }).webhook;
    },

    async listPaymentWebhooks(paymentId, provider) {
      const { status, body, correlationId } = await request(
        `/payments/${encodeURIComponent(paymentId)}/webhooks${queryString({ provider })}`,
      );
      if (status === 404) {
        return [];
      }
      if (status !== 200) {
        fail(status, body, correlationId, "UNABLE TO LOAD EVENT HISTORY");
      }
      return (body as { webhooks: PublicWebhookEvent[] }).webhooks;
    },

    async listPaymentAudit(paymentId) {
      const { status, body, correlationId } = await request(
        `/payments/${encodeURIComponent(paymentId)}/audit`,
      );
      if (status !== 200) {
        fail(status, body, correlationId, "UNABLE TO LOAD AUDIT HISTORY");
      }
      return (body as { audit: PublicAuditEvent[] }).audit;
    },

    async listWebhookAudit(webhookEventId) {
      const { status, body, correlationId } = await request(
        `/webhooks/${encodeURIComponent(webhookEventId)}/audit`,
      );
      if (status !== 200) {
        fail(status, body, correlationId, "UNABLE TO LOAD AUDIT HISTORY");
      }
      return (body as { audit: PublicAuditEvent[] }).audit;
    },

    async getRetry(webhookEventId) {
      const { status, body } = await request(
        `/retries/${encodeURIComponent(webhookEventId)}`,
      );
      if (status === 404) {
        return null;
      }
      if (status !== 200) {
        return null;
      }
      return (body as { retry: PublicRetry }).retry;
    },

    async getDeadLetter(webhookEventId) {
      const { status, body } = await request(
        `/dead-letters/${encodeURIComponent(webhookEventId)}`,
      );
      if (status === 404) {
        return null;
      }
      if (status !== 200) {
        return null;
      }
      return (body as { deadLetter: PublicDeadLetter }).deadLetter;
    },

    async getInvestigation(exceptionId) {
      const { status, body, correlationId } = await request(
        `/exceptions/${encodeURIComponent(exceptionId)}/investigation`,
      );
      if (status === 404) {
        return null;
      }
      if (status !== 200) {
        fail(status, body, correlationId, "UNABLE TO LOAD INVESTIGATION");
      }
      return (body as { investigation: PublicInvestigation }).investigation;
    },

    async investigate(exceptionId) {
      const { status, body, correlationId } = await request(
        `/exceptions/${encodeURIComponent(exceptionId)}/investigate`,
        { method: "POST" },
      );
      if (status !== 200) {
        fail(status, body, correlationId, "INVESTIGATION REQUEST FAILED");
      }
      if (
        typeof body !== "object" ||
        body === null ||
        !("investigation" in body)
      ) {
        fail(status, body, correlationId, "INVESTIGATION REQUEST FAILED");
      }
      return (body as { investigation: PublicInvestigation }).investigation;
    },

    async getFailureLabCatalog() {
      const { status, body, correlationId } = await request("/failure-lab");
      if (status !== 200) {
        fail(status, body, correlationId, "UNABLE TO LOAD FAILURE LAB");
      }
      if (
        typeof body !== "object" ||
        body === null ||
        !("scenarios" in body) ||
        !("notice" in body)
      ) {
        fail(status, body, correlationId, "UNABLE TO LOAD FAILURE LAB");
      }
      return body as FailureLabCatalog;
    },

    async runFailureLab(scenario) {
      const { status, body, correlationId } = await request("/failure-lab/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenario }),
      });
      if (status !== 200) {
        fail(status, body, correlationId, "UNABLE TO RUN FAILURE LAB SCENARIO");
      }
      if (typeof body !== "object" || body === null || !("run" in body)) {
        fail(status, body, correlationId, "UNABLE TO RUN FAILURE LAB SCENARIO");
      }
      return (body as { run: FailureLabRunReport }).run;
    },

    async getFailureLabRun(runId) {
      const { status, body, correlationId } = await request(
        `/failure-lab/runs/${encodeURIComponent(runId)}`,
      );
      if (status !== 200) {
        fail(status, body, correlationId, "UNABLE TO LOAD FAILURE LAB RUN");
      }
      if (typeof body !== "object" || body === null || !("run" in body)) {
        fail(status, body, correlationId, "UNABLE TO LOAD FAILURE LAB RUN");
      }
      return (body as { run: FailureLabRunReport }).run;
    },

    async resetFailureLab(confirm) {
      const { status, body, correlationId } = await request(
        "/failure-lab/reset",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirm }),
        },
      );
      if (status !== 200) {
        fail(status, body, correlationId, "UNABLE TO RESET FAILURE LAB");
      }
      if (typeof body !== "object" || body === null || !("deleted" in body)) {
        fail(status, body, correlationId, "UNABLE TO RESET FAILURE LAB");
      }
      return body as FailureLabResetResult;
    },
  };
}
