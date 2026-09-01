import { useEffect, useRef, useState } from "react";
import { ApiError, isApiError } from "../api/client";
import { useApi } from "../api/context";
import type {
  PublicIncident,
  PublicIncidentTimelineItem,
  PublicInvestigation,
} from "../api/types";
import { CopyButton } from "../components/CopyButton";
import { IncidentTimeline } from "../components/IncidentTimeline";
import { InvestigationPanel } from "../components/InvestigationPanel";
import {
  ErrorPanel,
  Section,
  SpecList,
  StatusLine,
  SyntheticMark,
} from "../components/chrome";
import { blank } from "../lib/format";
import {
  ADVISORY_AUTHORITATIVE,
  AI_GENERATED_ANALYSIS,
} from "../lib/operator-catalog";
import { Link } from "../routing/router";

export function IncidentDetail({ incidentId }: { readonly incidentId: string }) {
  const api = useApi();
  const [incident, setIncident] = useState<PublicIncident | null>(null);
  const [timeline, setTimeline] = useState<readonly PublicIncidentTimelineItem[] | null>(
    null,
  );
  const [investigations, setInvestigations] = useState<
    readonly PublicInvestigation[]
  >([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [investigationLoading, setInvestigationLoading] = useState(false);
  const [investigationError, setInvestigationError] = useState<ApiError | null>(
    null,
  );
  const investigationLocked = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .getIncident(incidentId)
      .then(async (record) => {
        if (cancelled) {
          return;
        }
        setIncident(record);
        const composed = await api.getIncidentTimeline(record.incidentId);
        const history = await api.listIncidentInvestigations(record.incidentId);
        if (cancelled) {
          return;
        }
        setTimeline(composed.timeline);
        if (!investigationLocked.current) {
          setInvestigations(history);
        }
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (cancelled) {
          return;
        }
        setLoading(false);
        setError(
          isApiError(caught)
            ? caught
            : new ApiError("REQUEST_FAILED", "", 0, "UNABLE TO LOAD INCIDENT"),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [api, incidentId]);

  async function runInvestigation() {
    investigationLocked.current = true;
    setInvestigationLoading(true);
    setInvestigationError(null);
    try {
      const result = await api.investigateIncident(incidentId);
      setInvestigations((current) => {
        const rest = current.filter(
          (row) => row.investigationId !== result.investigationId,
        );
        return [result, ...rest];
      });
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
        title="UNABLE TO LOAD INCIDENT"
        correlationId={error.correlationId}
        code={error.code}
      />
    );
  }
  if (loading || incident === null) {
    return <StatusLine>LOADING INCIDENT…</StatusLine>;
  }

  const latest = investigations[0] ?? null;

  return (
    <>
      <p className="crumb">
        <Link href="/incidents">Incidents</Link>
        <span aria-hidden="true"> / </span>
        <span className="mono">{incident.incidentId}</span>
      </p>
      <SyntheticMark show={incident.synthetic} />
      <Section title="INCIDENT">
        <SpecList
          rows={[
            { label: "Code", value: incident.exceptionCode },
            { label: "Severity", value: incident.severity },
            { label: "Status", value: incident.status },
            {
              label: "Incident ID",
              value: (
                <span className="copyable">
                  {incident.incidentId}
                  <CopyButton value={incident.incidentId} label="incident ID" />
                </span>
              ),
            },
            {
              label: "Exception",
              value: (
                <Link href={`/exceptions/${encodeURIComponent(incident.exceptionId)}`}>
                  {incident.exceptionId}
                </Link>
              ),
            },
            {
              label: "Correlation ID",
              value: (
                <span className="copyable">
                  {incident.correlationId}
                  <CopyButton
                    value={incident.correlationId}
                    label="correlation ID"
                  />
                </span>
              ),
            },
          ]}
        />
      </Section>
      <Section title="PAYMENT">
        {incident.paymentId === null ? (
          <p>No payment is attached to this incident.</p>
        ) : (
          <SpecList
            rows={[
              {
                label: "Payment ID",
                value: (
                  <span className="copyable">
                    <Link href={`/payments/${encodeURIComponent(incident.paymentId)}`}>
                      {incident.paymentId}
                    </Link>
                    <CopyButton value={incident.paymentId} label="payment ID" />
                  </span>
                ),
              },
              { label: "Provider", value: blank(incident.provider) },
            ]}
          />
        )}
      </Section>
      <Section title="EVENT">
        {incident.eventId === null ? (
          <p>No webhook row is attached to this incident.</p>
        ) : (
          <SpecList
            rows={[
              {
                label: "Event ID",
                value: (
                  <span className="copyable">
                    <Link href={`/events/${encodeURIComponent(incident.eventId)}`}>
                      {incident.eventId}
                    </Link>
                    <CopyButton value={incident.eventId} label="event ID" />
                  </span>
                ),
              },
            ]}
          />
        )}
      </Section>
      <Section title="TIMELINE">
        {timeline === null ? (
          <StatusLine>LOADING TIMELINE…</StatusLine>
        ) : (
          <IncidentTimeline items={timeline} />
        )}
      </Section>
      <Section title="AI INVESTIGATION">
        <p className="advisory">{ADVISORY_AUTHORITATIVE}</p>
        <p className="advisory">{AI_GENERATED_ANALYSIS}</p>
        <button
          type="button"
          onClick={() => {
            void runInvestigation();
          }}
          disabled={investigationLoading}
        >
          INVESTIGATE INCIDENT
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
        {latest !== null ? (
          <InvestigationPanel investigation={latest} />
        ) : investigationLoading ? null : (
          <p>No investigation has been recorded for this incident.</p>
        )}
        {investigations.length > 1 ? (
          <>
            <h3 className="kicker">PREVIOUS RUNS</h3>
            <ul className="plain-list">
              {investigations.slice(1).map((row) => (
                <li key={row.investigationId} className="mono">
                  {row.investigationId} · {row.createdAt} · {row.investigator}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Section>
    </>
  );
}
