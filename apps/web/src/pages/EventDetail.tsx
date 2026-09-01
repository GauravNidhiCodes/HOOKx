import { useEffect, useMemo, useState } from "react";
import { ApiError, isApiError } from "../api/client";
import { useApi } from "../api/context";
import type {
  PublicAuditEvent,
  PublicDeadLetter,
  PublicRetry,
  PublicWebhookEvent,
} from "../api/types";
import { AuditHistory } from "../components/AuditHistory";
import { CopyButton } from "../components/CopyButton";
import { RetryHistory } from "../components/RetryHistory";
import { RetryInformation } from "../components/RetryInformation";
import { SanitizedPayload } from "../components/SanitizedPayload";
import {
  ErrorPanel,
  Section,
  SpecList,
  StatusLine,
  SyntheticMark,
} from "../components/chrome";
import { isSyntheticRef } from "../lib/format";
import { processingFromAudit } from "../lib/processing";
import { hasRetryHistory, retryHistoryFromAudit } from "../lib/retry-history";
import { Link } from "../routing/router";

export function EventDetail({
  webhookEventId,
}: {
  readonly webhookEventId: string;
}) {
  const api = useApi();
  const [webhook, setWebhook] = useState<PublicWebhookEvent | null>(null);
  const [audit, setAudit] = useState<readonly PublicAuditEvent[]>([]);
  const [retry, setRetry] = useState<PublicRetry | null>(null);
  const [deadLetter, setDeadLetter] = useState<PublicDeadLetter | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .getWebhook(webhookEventId)
      .then(async (record) => {
        if (cancelled) {
          return;
        }
        if (record === null) {
          setMissing(true);
          setLoading(false);
          return;
        }
        const [rows, retryRow, dead] = await Promise.all([
          api.listWebhookAudit(webhookEventId),
          api.getRetry(webhookEventId),
          api.getDeadLetter(webhookEventId),
        ]);
        if (cancelled) {
          return;
        }
        setWebhook(record);
        setAudit(rows);
        setRetry(retryRow);
        setDeadLetter(dead);
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setLoading(false);
          setError(
            isApiError(caught)
              ? caught
              : new ApiError("REQUEST_FAILED", "", 0, "UNABLE TO LOAD EVENT"),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, webhookEventId]);

  const processing = useMemo(
    () =>
      webhook === null
        ? null
        : processingFromAudit(webhook.processingStatus, audit),
    [audit, webhook],
  );
  const retries = useMemo(
    () => retryHistoryFromAudit(audit, webhookEventId),
    [audit, webhookEventId],
  );

  if (loading) {
    return <StatusLine>LOADING EVENT…</StatusLine>;
  }
  if (error !== null) {
    return (
      <ErrorPanel
        title="UNABLE TO LOAD EVENT"
        correlationId={error.correlationId}
        code={error.code}
      />
    );
  }
  if (missing || webhook === null) {
    return (
      <section className="empty">
        <h1 className="kicker">NOT FOUND</h1>
        <h2 className="kicker">EVENT NOT FOUND</h2>
        <p className="mono">{webhookEventId}</p>
      </section>
    );
  }

  return (
    <>
      <p className="crumb">
        <Link href="/events">Events</Link>
        <span aria-hidden="true"> / </span>
        <span className="mono">{webhook.webhookEventId}</span>
      </p>
      <SyntheticMark
        show={isSyntheticRef(webhook.provider) || isSyntheticRef(webhook.paymentId)}
      />
      <Section title="EVENT">
        <SpecList
          rows={[
            {
              label: "Event ID",
              value: (
                <span className="copyable">
                  {webhook.webhookEventId}
                  <CopyButton value={webhook.webhookEventId} label="event ID" />
                </span>
              ),
            },
            { label: "Provider", value: webhook.provider },
            { label: "Event type", value: webhook.eventType },
            { label: "External ID", value: webhook.externalEventId },
            { label: "occurredAt", value: webhook.occurredAt },
            { label: "receivedAt", value: webhook.receivedAt },
            { label: "Processing status", value: webhook.processingStatus },
            {
              label: "Payment ID",
              value: (
                <span className="copyable">
                  <Link href={`/payments/${encodeURIComponent(webhook.paymentId)}`}>
                    {webhook.paymentId}
                  </Link>
                  <CopyButton value={webhook.paymentId} label="payment ID" />
                </span>
              ),
            },
          ]}
        />
      </Section>
      <Section title="PROCESSING">
        {processing === null ? null : (
          <SpecList
            rows={[
              { label: "Verification", value: processing.verification },
              { label: "Normalization", value: processing.normalization },
              { label: "Idempotency", value: processing.idempotency },
              { label: "Decision", value: processing.decision },
            ]}
          />
        )}
      </Section>
      <SanitizedPayload />
      {hasRetryHistory(retry, deadLetter, retries) ? (
        <Section title="RETRY HISTORY">
          {retries.length > 0 ? <RetryHistory attempts={retries} /> : null}
          <RetryInformation retry={retry} deadLetter={deadLetter} />
        </Section>
      ) : null}
      <Section title="AUDIT HISTORY">
        <AuditHistory
          events={audit}
          emptyLabel="No audit rows for this event."
        />
      </Section>
    </>
  );
}
