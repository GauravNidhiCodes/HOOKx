import { useEffect, useRef, useState } from "react";
import { ApiError, isApiError } from "../api/client";
import { useApi } from "../api/context";
import type {
  PublicAuditEvent,
  PublicDeadLetter,
  PublicException,
  PublicInvestigation,
  PublicPayment,
  PublicRetry,
  PublicWebhookEvent,
} from "../api/types";
import { AuditHistory } from "../components/AuditHistory";
import { EventTimeline } from "../components/EventTimeline";
import { InvestigationPanel } from "../components/InvestigationPanel";
import { RetryInformation } from "../components/RetryInformation";
import {
  ErrorPanel,
  Section,
  SpecList,
  StatusLine,
  SyntheticMark,
} from "../components/chrome";
import { blank, isSyntheticRef } from "../lib/format";
import { buildTimeline } from "../lib/timeline";
import { Link } from "../routing/router";

export function ExceptionDetail({ exceptionId }: { readonly exceptionId: string }) {
  const api = useApi();
  const [exception, setException] = useState<PublicException | null>(null);
  const [payment, setPayment] = useState<PublicPayment | null>(null);
  const [webhook, setWebhook] = useState<PublicWebhookEvent | null>(null);
  const [webhooks, setWebhooks] = useState<readonly PublicWebhookEvent[]>([]);
  const [audit, setAudit] = useState<readonly PublicAuditEvent[]>([]);
  const [retry, setRetry] = useState<PublicRetry | null>(null);
  const [deadLetter, setDeadLetter] = useState<PublicDeadLetter | null>(null);
  const [investigation, setInvestigation] = useState<PublicInvestigation | null>(
    null,
  );
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [investigationLoading, setInvestigationLoading] = useState(false);
  const [investigationError, setInvestigationError] = useState<ApiError | null>(
    null,
  );
  const investigationLocked = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .getException(exceptionId)
      .then(async (record) => {
        if (cancelled) {
          return;
        }
        setException(record);
        setLoading(false);
        const paymentRow =
          record.paymentId === null
            ? null
            : await api.getPayment(record.paymentId, record.provider ?? undefined);
        const webhookRow =
          record.webhookEventId === null
            ? null
            : await api.getWebhook(record.webhookEventId);
        const paymentWebhooks =
          record.paymentId === null
            ? webhookRow === null
              ? []
              : [webhookRow]
            : await api.listPaymentWebhooks(
                record.paymentId,
                record.provider ?? undefined,
              );
        const auditRows =
          record.paymentId !== null
            ? await api.listPaymentAudit(record.paymentId)
            : record.webhookEventId !== null
              ? await api.listWebhookAudit(record.webhookEventId)
              : [];
        const retryRow =
          record.webhookEventId === null
            ? null
            : await api.getRetry(record.webhookEventId);
        const dead =
          record.webhookEventId === null
            ? null
            : await api.getDeadLetter(record.webhookEventId);
        const existing = await api.getInvestigation(record.exceptionId);
        if (cancelled) {
          return;
        }
        setPayment(paymentRow);
        setWebhook(webhookRow);
        setWebhooks(paymentWebhooks);
        setAudit(auditRows);
        setRetry(retryRow);
        setDeadLetter(dead);
        if (!investigationLocked.current) {
          setInvestigation(existing);
        }
        setHistoryLoading(false);
      })
      .catch((caught: unknown) => {
        if (cancelled) {
          return;
        }
        setLoading(false);
        setHistoryLoading(false);
        setError(
          isApiError(caught)
            ? caught
            : new ApiError("REQUEST_FAILED", "", 0, "UNABLE TO LOAD EXCEPTION"),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [api, exceptionId]);

  async function runInvestigation() {
    investigationLocked.current = true;
    setInvestigationLoading(true);
    setInvestigationError(null);
    try {
      const result = await api.investigate(exceptionId);
      setInvestigation(result);
    } catch (caught: unknown) {
      setInvestigationError(
        isApiError(caught)
          ? caught
          : new ApiError("REQUEST_FAILED", "", 0, "INVESTIGATION REQUEST FAILED"),
      );
    } finally {
      setInvestigationLoading(false);
    }
  }

  if (error !== null) {
    return (
      <ErrorPanel
        title="UNABLE TO LOAD EXCEPTION"
        correlationId={error.correlationId}
        code={error.code}
      />
    );
  }
  if (loading || exception === null) {
    return <StatusLine>LOADING EXCEPTION…</StatusLine>;
  }

  const synthetic =
    isSyntheticRef(exception.provider) ||
    isSyntheticRef(exception.paymentId) ||
    isSyntheticRef(payment?.provider);
  const retryRelated =
    exception.exceptionCode === "PROCESSING_FAILURE" ||
    exception.exceptionCode === "RETRY_EXHAUSTED" ||
    retry !== null ||
    deadLetter !== null;
  const timeline = buildTimeline(webhooks, audit);

  return (
    <>
      <p className="crumb">
        <Link href="/exceptions">Exceptions</Link>
        <span aria-hidden="true"> / </span>
        <span className="mono">{exception.exceptionId}</span>
      </p>
      <SyntheticMark show={synthetic} />
      <Section title="EXCEPTION">
        <SpecList
          rows={[
            { label: "Code", value: exception.exceptionCode },
            { label: "Severity", value: exception.severity },
            { label: "Status", value: exception.status },
          ]}
        />
      </Section>
      <Section title="PAYMENT">
        {exception.paymentId === null && payment === null ? (
          <p>No payment is attached to this exception.</p>
        ) : (
          <SpecList
            rows={[
              {
                label: "Payment ID",
                value: exception.paymentId ? (
                  <Link href={`/payments/${encodeURIComponent(exception.paymentId)}`}>
                    {exception.paymentId}
                  </Link>
                ) : (
                  "—"
                ),
              },
              { label: "Provider", value: blank(exception.provider ?? payment?.provider) },
              { label: "Current state", value: payment?.state ?? "NOT PROJECTED" },
            ]}
          />
        )}
      </Section>
      <Section title="EVENT">
        {webhook === null && exception.webhookEventId === null ? (
          <p>No webhook row was stored for this exception.</p>
        ) : (
          <SpecList
            rows={[
              { label: "Event ID", value: blank(webhook?.webhookEventId ?? exception.webhookEventId) },
              { label: "Event type", value: blank(webhook?.eventType) },
              { label: "occurredAt", value: blank(webhook?.occurredAt) },
              { label: "receivedAt", value: blank(webhook?.receivedAt) },
            ]}
          />
        )}
      </Section>
      <Section title="REASON">
        <p className="mono">{exception.reason}</p>
        <p>Assigned by the deterministic exception engine.</p>
      </Section>
      <Section title="EVENT TIMELINE">
        {historyLoading ? (
          <StatusLine>LOADING EVENT HISTORY…</StatusLine>
        ) : (
          <EventTimeline items={timeline} />
        )}
      </Section>
      {retryRelated ? (
        <Section title="RETRY">
          <RetryInformation retry={retry} deadLetter={deadLetter} />
        </Section>
      ) : null}
      <Section title="AUDIT HISTORY">
        {historyLoading ? (
          <StatusLine>LOADING EVENT HISTORY…</StatusLine>
        ) : (
          <AuditHistory events={audit} />
        )}
      </Section>
      <Section title="INVESTIGATION">
        <p className="advisory">
          ADVISORY — SYSTEM OF RECORD REMAINS DETERMINISTIC
        </p>
        <button
          type="button"
          onClick={() => {
            void runInvestigation();
          }}
          disabled={investigationLoading}
        >
          Investigate
        </button>
        {investigationLoading ? (
          <StatusLine>LOADING INVESTIGATION…</StatusLine>
        ) : null}
        {investigationError !== null ? (
          <ErrorPanel
            title="INVESTIGATION REQUEST FAILED"
            correlationId={investigationError.correlationId}
            code={investigationError.code}
          />
        ) : null}
        {investigation !== null ? (
          <InvestigationPanel investigation={investigation} />
        ) : investigationLoading ? null : (
          <p>No investigation has been recorded for this exception.</p>
        )}
      </Section>
    </>
  );
}
