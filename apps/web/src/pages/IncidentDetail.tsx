import { useEffect, useState } from "react";
import { ApiError, isApiError } from "../api/client";
import { useApi } from "../api/context";
import type {
  PublicIncident,
  PublicIncidentTimelineItem,
} from "../api/types";
import { CopyButton } from "../components/CopyButton";
import { IncidentTimeline } from "../components/IncidentTimeline";
import {
  ErrorPanel,
  Section,
  SpecList,
  StatusLine,
  SyntheticMark,
} from "../components/chrome";
import { blank } from "../lib/format";
import { Link } from "../routing/router";

export function IncidentDetail({ incidentId }: { readonly incidentId: string }) {
  const api = useApi();
  const [incident, setIncident] = useState<PublicIncident | null>(null);
  const [timeline, setTimeline] = useState<readonly PublicIncidentTimelineItem[] | null>(
    null,
  );
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);

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
        if (cancelled) {
          return;
        }
        setTimeline(composed.timeline);
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
    </>
  );
}
