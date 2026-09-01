import { useEffect, useMemo, useState } from "react";
import { ApiError, isApiError } from "../api/client";
import { useApi } from "../api/context";
import type { IncidentListQuery, PublicIncident } from "../api/types";
import { IncidentFilters } from "../components/IncidentFilters";
import { IncidentRow } from "../components/IncidentRow";
import { ErrorPanel, StatusLine } from "../components/chrome";
import { useRouter } from "../routing/router";

function queryFromSearch(search: string): IncidentListQuery {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const read = (key: string) => params.get(key)?.trim() || undefined;
  const applied = params.has("ok");
  if (!applied && !params.has("status")) {
    return { status: "OPEN" };
  }
  return {
    status: read("status"),
    severity: read("severity"),
    exceptionCode: read("exceptionCode"),
    provider: read("provider"),
    from: read("from"),
    to: read("to"),
  };
}

function searchFromQuery(query: IncidentListQuery): string {
  const params = new URLSearchParams();
  params.set("ok", "1");
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value.length > 0) {
      params.set(key, value);
    }
  }
  return `/incidents?${params.toString()}`;
}

function IncidentResults({ query }: { readonly query: IncidentListQuery }) {
  const api = useApi();
  const [rows, setRows] = useState<readonly PublicIncident[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .listIncidents(query)
      .then((listed) => {
        if (!cancelled) {
          setRows(listed);
        }
      })
      .catch((caught: unknown) => {
        if (cancelled) {
          return;
        }
        setError(
          isApiError(caught)
            ? caught
            : new ApiError("REQUEST_FAILED", "", 0, "UNABLE TO LOAD INCIDENTS"),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [api, query]);

  if (error !== null) {
    return (
      <ErrorPanel
        title="UNABLE TO LOAD INCIDENTS"
        correlationId={error.correlationId}
        code={error.code}
      />
    );
  }
  if (rows === null) {
    return <StatusLine>LOADING INCIDENTS…</StatusLine>;
  }
  if (rows.length === 0) {
    return (
      <section className="empty">
        <h2 className="kicker">
          {query.status === "OPEN" &&
          query.severity === undefined &&
          query.exceptionCode === undefined &&
          query.provider === undefined &&
          query.from === undefined &&
          query.to === undefined
            ? "NO OPEN INCIDENTS"
            : "NO INCIDENTS MATCH THE FILTERS"}
        </h2>
        <p>
          {query.status === "OPEN"
            ? "No persisted exception has been recorded as an OPEN incident for this filter."
            : "No stored incidents match the selected filters."}
        </p>
      </section>
    );
  }
  return (
    <div className="table-wrap">
      <table className="queue">
        <caption className="visually-hidden">Incidents</caption>
        <thead>
          <tr>
            <th scope="col">Incident</th>
            <th scope="col">Payment ID</th>
            <th scope="col">Provider</th>
            <th scope="col">Event ID</th>
            <th scope="col">Severity</th>
            <th scope="col">Status</th>
            <th scope="col">Detected</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <IncidentRow key={row.incidentId} incident={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function IncidentQueue() {
  const { route, navigate } = useRouter();
  const search = route.name === "incidents" ? route.search : "";
  const query = useMemo(() => queryFromSearch(search), [search]);

  return (
    <>
      <header className="page-head">
        <h1 className="kicker">INCIDENTS</h1>
        <p>
          Incidents are persisted exceptions. Successful webhooks are not listed.
        </p>
      </header>
      <IncidentFilters
        key={`filters:${search || "default"}`}
        value={query}
        onSubmit={(next) => navigate(searchFromQuery(next))}
      />
      <IncidentResults key={`results:${search || "default"}`} query={query} />
    </>
  );
}
