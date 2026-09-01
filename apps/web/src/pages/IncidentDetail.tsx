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
import { incidentBrief } from "../lib/incident-brief";
import {
  ADVISORY_AUTHORITATIVE,
  AI_GENERATED_INVESTIGATION,
  AI_NO_FINANCIAL_STATE_CHANGES,
  AI_READONLY,
} from "../lib/operator-catalog";
import { Link, useRouter } from "../routing/router";

export function IncidentDetail({ incidentId }: { readonly incidentId: string }) {
  const api = useApi();
  const { href } = useRouter();
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

  useEffect(() => {
    if (loading) {
      return;
    }
    const hash = href.includes("#") ? href.slice(href.indexOf("#") + 1) : "";
    if (hash === "timeline" || hash === "investigation") {
      document.getElementById(hash)?.scrollIntoView?.();
    }
  }, [href, loading, timeline, investigations]);

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
        next="Retry this page, or return to Incidents."
      />
    );
  }
  if (loading || incident === null) {
    return <StatusLine>LOADING INCIDENT…</StatusLine>;
  }

  const latest = investigations[0] ?? null;
  const brief = incidentBrief(incident, timeline);

  return (
    <>
      <p className="crumb">
        <Link href="/incidents">Incidents</Link>
        <span aria-hidden="true"> / </span>
        <span className="mono">{incident.incidentId}</span>
      </p>
      <SyntheticMark show={incident.synthetic} />
      <Section title="WHAT HAPPENED?">
        <p>{brief.what}</p>
      </Section>
      <Section title="WHY?">
        <p className="mono">{brief.why}</p>
      </Section>
      <Section title="WHAT DID THE SYSTEM DO?">
        <p>{brief.systemDid}</p>
      </Section>
      <Section title="WHAT HAPPENED AFTERWARD?">
        <p>{brief.afterward}</p>
      </Section>
      <Section title="WHAT CAN THE OPERATOR DO?">
        <p>{brief.operator}</p>
      </Section>
      <Section title="DETERMINISTIC RESULT">
        <p className="advisory">
          DETERMINISTIC RESULT — PAYMENT STATE IS DECIDED HERE
        </p>
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
            {
              label: "Payment ID",
              value:
                incident.paymentId === null ? (
                  "—"
                ) : (
                  <span className="copyable">
                    <Link href={`/payments/${encodeURIComponent(incident.paymentId)}`}>
                      {incident.paymentId}
                    </Link>
                    <CopyButton value={incident.paymentId} label="payment ID" />
                  </span>
                ),
            },
            { label: "Provider", value: blank(incident.provider) },
            {
              label: "Event ID",
              value:
                incident.eventId === null ? (
                  "—"
                ) : (
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
      </Section>
      <section className="section" id="timeline">
        <h2 className="kicker">TIMELINE</h2>
        {timeline === null ? (
          <StatusLine>LOADING TIMELINE…</StatusLine>
        ) : (
          <IncidentTimeline items={timeline} />
        )}
      </section>
      <section className="section" id="investigation">
        <h2 className="kicker">AI INVESTIGATION</h2>
        <p className="advisory">{AI_GENERATED_INVESTIGATION}</p>
        <p className="advisory">
          {AI_READONLY} · {AI_NO_FINANCIAL_STATE_CHANGES}
        </p>
        <p className="advisory">{ADVISORY_AUTHORITATIVE}</p>
        <p>
          The deterministic engine decided the financial state above. AI
          explains evidence. It does not approve or change payments.
        </p>
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
            safety="Payment state was not changed. The deterministic incident record is unchanged."
            next="Retry the investigation, or inspect the timeline."
          />
        ) : null}
        {latest !== null ? (
          <InvestigationPanel investigation={latest} />
        ) : investigationLoading ? null : (
          <section className="empty">
            <h3 className="kicker">NO INVESTIGATION</h3>
            <p>Run an investigation when evidence is available.</p>
          </section>
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
      </section>
    </>
  );
}
