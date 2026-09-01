import { useEffect, useMemo, useState } from "react";
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
import { CopyButton } from "../components/CopyButton";
import { EventFilters } from "../components/EventFilters";
import { EventTable } from "../components/EventTable";
import { ExceptionLinkTable } from "../components/ExceptionLinkTable";
import { InvestigationPanel } from "../components/InvestigationPanel";
import { ReplayVisualization } from "../components/ReplayView";
import { RetryHistory } from "../components/RetryHistory";
import { RetryInformation } from "../components/RetryInformation";
import { StateHistory } from "../components/StateHistory";
import {
  ErrorPanel,
  Section,
  SpecList,
  StatusLine,
  SyntheticMark,
} from "../components/chrome";
import { chronologicalEvents, filterEvents, type EventListFilter } from "../lib/event-filter";
import { isSyntheticRef } from "../lib/format";
import { ADVISORY_AUTHORITATIVE } from "../lib/operator-catalog";
import { buildReplay } from "../lib/replay";
import { hasRetryHistory, retryHistoryFromAudit } from "../lib/retry-history";
import { stateHistoryFromAudit } from "../lib/state-history";
import { Link } from "../routing/router";

export function PaymentDetail({ paymentId }: { readonly paymentId: string }) {
  const api = useApi();
  const [payment, setPayment] = useState<PublicPayment | null>(null);
  const [webhooks, setWebhooks] = useState<readonly PublicWebhookEvent[]>([]);
  const [audit, setAudit] = useState<readonly PublicAuditEvent[]>([]);
  const [exceptions, setExceptions] = useState<readonly PublicException[]>([]);
  const [investigations, setInvestigations] = useState<
    readonly PublicInvestigation[]
  >([]);
  const [retry, setRetry] = useState<PublicRetry | null>(null);
  const [deadLetter, setDeadLetter] = useState<PublicDeadLetter | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [relatedLoading, setRelatedLoading] = useState(true);
  const [investigationLoading, setInvestigationLoading] = useState(false);
  const [missing, setMissing] = useState(false);
  const [eventFilter, setEventFilter] = useState<EventListFilter>({});

  useEffect(() => {
    let cancelled = false;
    void api
      .getPayment(paymentId)
      .then(async (record) => {
        if (cancelled) {
          return;
        }
        if (record === null) {
          setMissing(true);
          setLoading(false);
          setRelatedLoading(false);
          return;
        }
        setPayment(record);
        setLoading(false);
        const [listedWebhooks, listedAudit, listedExceptions] = await Promise.all([
          api.listPaymentWebhooks(record.paymentId, record.provider),
          api.listPaymentAudit(record.paymentId),
          api.listPaymentExceptions(record.paymentId),
        ]);
        if (cancelled) {
          return;
        }
        setWebhooks(listedWebhooks);
        setAudit(listedAudit);
        setExceptions(listedExceptions);
        setRelatedLoading(false);
        const retryIds = new Set<string>();
        for (const row of listedAudit) {
          if (
            row.webhookEventId !== null &&
            row.eventType.startsWith("RETRY_")
          ) {
            retryIds.add(row.webhookEventId);
          }
        }
        const firstRetryId = [...retryIds][0];
        if (firstRetryId !== undefined) {
          const [retryRow, dead] = await Promise.all([
            api.getRetry(firstRetryId),
            api.getDeadLetter(firstRetryId),
          ]);
          if (!cancelled) {
            setRetry(retryRow);
            setDeadLetter(dead);
          }
        }
        setInvestigationLoading(true);
        const loaded = await Promise.all(
          listedExceptions.map((row) => api.getInvestigation(row.exceptionId)),
        );
        if (!cancelled) {
          setInvestigations(loaded.filter((row) => row !== null));
          setInvestigationLoading(false);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setLoading(false);
          setRelatedLoading(false);
          setInvestigationLoading(false);
          setError(
            isApiError(caught)
              ? caught
              : new ApiError("REQUEST_FAILED", "", 0, "UNABLE TO LOAD PAYMENT"),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, paymentId]);

  const transitions = useMemo(
    () => stateHistoryFromAudit(audit, webhooks),
    [audit, webhooks],
  );
  const replay = useMemo(
    () => (payment === null ? null : buildReplay(webhooks, payment.state, audit)),
    [audit, payment, webhooks],
  );
  const retries = useMemo(() => retryHistoryFromAudit(audit), [audit]);
  const visibleEvents = useMemo(
    () => chronologicalEvents(filterEvents(webhooks, eventFilter), "occurredAt"),
    [eventFilter, webhooks],
  );

  if (loading) {
    return <StatusLine>LOADING PAYMENT…</StatusLine>;
  }
  if (error !== null) {
    return (
      <ErrorPanel
        title="UNABLE TO LOAD PAYMENT"
        correlationId={error.correlationId}
        code={error.code}
      />
    );
  }
  if (missing || payment === null) {
    return (
      <section className="empty">
        <h1 className="kicker">NOT FOUND</h1>
        <h2 className="kicker">PAYMENT NOT FOUND</h2>
        <p className="mono">{paymentId}</p>
      </section>
    );
  }

  const synthetic =
    isSyntheticRef(payment.provider) || isSyntheticRef(payment.paymentId);

  return (
    <>
      <p className="crumb">
        <Link href="/payments">Payments</Link>
        <span aria-hidden="true"> / </span>
        <span className="mono">{payment.paymentId}</span>
      </p>
      <SyntheticMark show={synthetic} />
      <Section title="PAYMENT">
        <SpecList
          rows={[
            {
              label: "Payment ID",
              value: (
                <span className="copyable">
                  {payment.paymentId}
                  <CopyButton value={payment.paymentId} label="payment ID" />
                </span>
              ),
            },
            { label: "Provider", value: payment.provider },
            { label: "Current state", value: payment.state },
            { label: "Created", value: payment.createdAt },
            { label: "Updated", value: payment.updatedAt },
            { label: "Currency", value: payment.currency },
            { label: "Amount (minor)", value: payment.amountMinor },
            {
              label: "Classification",
              value: synthetic ? "SYNTHETIC" : "RECORDED",
            },
          ]}
        />
      </Section>
      <Section title="STATE HISTORY">
        {relatedLoading ? (
          <StatusLine>LOADING AUDIT HISTORY…</StatusLine>
        ) : (
          <StateHistory transitions={transitions} />
        )}
      </Section>
      <Section title="EVENTS">
        {relatedLoading ? (
          <StatusLine>LOADING EVENTS…</StatusLine>
        ) : (
          <>
            <EventFilters
              key={`payment-events:${payment.paymentId}`}
              value={eventFilter}
              onSubmit={setEventFilter}
              searchLabel="External event ID"
            />
            <EventTable events={visibleEvents} showPayment={false} />
          </>
        )}
      </Section>
      {replay !== null ? (
        <Section title="REPLAY">
          <ReplayVisualization replay={replay} />
        </Section>
      ) : null}
      <Section title="EXCEPTIONS">
        {relatedLoading ? (
          <StatusLine>LOADING EVENTS…</StatusLine>
        ) : (
          <ExceptionLinkTable exceptions={exceptions} />
        )}
      </Section>
      {hasRetryHistory(retry, deadLetter, retries) ? (
        <Section title="RETRY HISTORY">
          {retries.length > 0 ? <RetryHistory attempts={retries} /> : null}
          {retry !== null || deadLetter !== null ? (
            <RetryInformation retry={retry} deadLetter={deadLetter} />
          ) : null}
        </Section>
      ) : null}
      <Section title="AUDIT HISTORY">
        {relatedLoading ? (
          <StatusLine>LOADING AUDIT HISTORY…</StatusLine>
        ) : (
          <AuditHistory
            events={audit}
            emptyLabel="No audit rows for this payment."
          />
        )}
      </Section>
      <Section title="INVESTIGATION">
        <p className="advisory">{ADVISORY_AUTHORITATIVE}</p>
        {investigationLoading ? (
          <StatusLine>LOADING INVESTIGATION…</StatusLine>
        ) : investigations.length === 0 ? (
          <p>No investigation has been recorded for exceptions on this payment.</p>
        ) : (
          investigations.map((row) => (
            <InvestigationPanel key={row.investigationId} investigation={row} />
          ))
        )}
      </Section>
    </>
  );
}
