import { useEffect, useMemo, useState } from "react";
import { ApiError, isApiError } from "../api/client";
import { useApi } from "../api/context";
import type { PublicWebhookEvent } from "../api/types";
import { ErrorPanel, StatusLine } from "../components/chrome";
import { EventFilters } from "../components/EventFilters";
import { EventTable } from "../components/EventTable";
import type { EventListFilter } from "../lib/event-filter";
import { useRouter } from "../routing/router";

function queryFromSearch(search: string): EventListFilter {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const read = (key: string) => params.get(key)?.trim() || undefined;
  return {
    eventType: read("eventType"),
    processingStatus: read("processingStatus"),
    q: read("q"),
  };
}

function searchFromQuery(query: EventListFilter): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value.length > 0) {
      params.set(key, value);
    }
  }
  const encoded = params.toString();
  return encoded.length === 0 ? "/events" : `/events?${encoded}`;
}

function EventIndexResults({ query }: { readonly query: EventListFilter }) {
  const api = useApi();
  const [rows, setRows] = useState<readonly PublicWebhookEvent[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .listWebhooks({
        q: query.q,
        eventType: query.eventType,
        processingStatus: query.processingStatus,
      })
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
            : new ApiError("REQUEST_FAILED", "", 0, "UNABLE TO LOAD EVENT"),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [api, query]);

  if (error !== null) {
    return (
      <ErrorPanel
        title="UNABLE TO LOAD EVENT"
        correlationId={error.correlationId}
        code={error.code}
      />
    );
  }
  if (rows === null) {
    return <StatusLine>LOADING EVENTS…</StatusLine>;
  }
  return (
    <EventTable
      events={rows}
      emptyTitle={
        query.eventType === undefined &&
        query.processingStatus === undefined &&
        query.q === undefined
          ? "NO EVENTS"
          : "NO EVENTS MATCH"
      }
      emptyBody={
        query.eventType === undefined &&
        query.processingStatus === undefined &&
        query.q === undefined
          ? "No webhook events are currently available."
          : "No stored webhook events match the current filter."
      }
    />
  );
}

export function EventsPage() {
  const { route, navigate } = useRouter();
  const search = route.name === "events" ? route.search : "";
  const query = useMemo(() => queryFromSearch(search), [search]);

  return (
    <>
      <header className="page-head">
        <h1 className="kicker">EVENTS</h1>
        <p>Persisted webhook events. Raw provider payloads are not stored.</p>
      </header>
      <EventFilters
        key={`filters:${search || "all"}`}
        value={query}
        onSubmit={(next) => navigate(searchFromQuery(next))}
        includePaymentSearch
      />
      <EventIndexResults key={`results:${search || "all"}`} query={query} />
    </>
  );
}
