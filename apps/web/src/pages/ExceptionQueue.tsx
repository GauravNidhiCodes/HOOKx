import { useEffect, useMemo, useState } from "react";
import { ApiError, isApiError } from "../api/client";
import { useApi } from "../api/context";
import type { ExceptionListQuery, PublicException } from "../api/types";
import { ExceptionFilters } from "../components/ExceptionFilters";
import { ExceptionRow } from "../components/ExceptionRow";
import { ErrorPanel, StatusLine } from "../components/chrome";
import { useRouter } from "../routing/router";

function queryFromSearch(search: string): ExceptionListQuery {
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
    q: read("q"),
  };
}

function searchFromQuery(query: ExceptionListQuery): string {
  const params = new URLSearchParams();
  params.set("ok", "1");
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value.length > 0) {
      params.set(key, value);
    }
  }
  return `/exceptions?${params.toString()}`;
}

function QueueResults({ query }: { readonly query: ExceptionListQuery }) {
  const api = useApi();
  const [rows, setRows] = useState<readonly PublicException[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .listExceptions(query)
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
            : new ApiError("REQUEST_FAILED", "", 0, "UNABLE TO LOAD EXCEPTIONS"),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [api, query]);

  if (error !== null) {
    return (
      <ErrorPanel
        title="UNABLE TO LOAD EXCEPTIONS"
        correlationId={error.correlationId}
        code={error.code}
      />
    );
  }
  if (rows === null) {
    return <StatusLine>LOADING EXCEPTIONS…</StatusLine>;
  }
  if (rows.length === 0) {
    return (
      <section className="empty">
        <h2 className="kicker">
          {query.status === "OPEN" &&
          query.q === undefined &&
          query.severity === undefined &&
          query.exceptionCode === undefined &&
          query.provider === undefined
            ? "NO OPEN EXCEPTIONS"
            : "NO EXCEPTIONS MATCH THE FILTERS"}
        </h2>
        <p>
          {query.status === "OPEN"
            ? "The deterministic engine has not recorded an OPEN exception for this filter."
            : "No stored exceptions match the selected filters or search identifiers."}
        </p>
      </section>
    );
  }
  return (
    <div className="table-wrap">
      <table className="queue">
        <caption className="visually-hidden">Exceptions</caption>
        <thead>
          <tr>
            <th scope="col">Exception</th>
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
            <ExceptionRow key={row.exceptionId} exception={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ExceptionQueue() {
  const { route, navigate } = useRouter();
  const search = route.name === "exceptions" ? route.search : "";
  const query = useMemo(() => queryFromSearch(search), [search]);

  return (
    <>
      <header className="page-head">
        <h1 className="kicker">EXCEPTION QUEUE</h1>
        <p>Deterministic exceptions. AI investigation is a separate, advisory action.</p>
      </header>
      <ExceptionFilters
        key={`filters:${search || "default"}`}
        value={query}
        onSubmit={(next) => navigate(searchFromQuery(next))}
      />
      <QueueResults key={`results:${search || "default"}`} query={query} />
    </>
  );
}
