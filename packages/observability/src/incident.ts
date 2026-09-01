import { isSyntheticOrigin } from "./synthetic.js";

export type PublicIncident = {
  readonly incidentId: string;
  readonly exceptionId: string;
  readonly exceptionCode: string;
  readonly severity: string;
  readonly status: string;
  readonly paymentId: string | null;
  readonly eventId: string | null;
  readonly correlationId: string;
  readonly provider: string | null;
  readonly detectedAt: string;
  readonly reason: string;
  readonly synthetic: boolean;
};

export type IncidentIdentifiers = {
  readonly exceptionId: string;
  readonly paymentId: string | null;
  readonly eventId: string | null;
  readonly correlationId: string;
};

export function toPublicIncident(
  record: {
    readonly exceptionId: string;
    readonly exceptionCode: string;
    readonly severity: string;
    readonly status: string;
    readonly paymentId: string | null;
    readonly webhookEventId: string | null;
    readonly correlationId: string;
    readonly provider: string | null;
    readonly detectedAt: string;
    readonly reason: string;
  },
  liveProviders: readonly string[] = [],
): PublicIncident {
  return {
    incidentId: record.exceptionId,
    exceptionId: record.exceptionId,
    exceptionCode: record.exceptionCode,
    severity: record.severity,
    status: record.status,
    paymentId: record.paymentId,
    eventId: record.webhookEventId,
    correlationId: record.correlationId,
    provider: record.provider,
    detectedAt: record.detectedAt,
    reason: record.reason,
    synthetic: isSyntheticOrigin(
      record.provider,
      record.paymentId,
      liveProviders,
    ),
  };
}
