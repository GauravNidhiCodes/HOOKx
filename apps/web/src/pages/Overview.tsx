import { useEffect, useState } from "react";
import { ApiError, isApiError } from "../api/client";
import { useApi } from "../api/context";
import type { MetricsSummary } from "../api/types";
import { ErrorPanel, StatusLine } from "../components/chrome";
import { Link } from "../routing/router";

const PRODUCT_SENTENCE =
  "Payment webhook infrastructure that detects, contains, and recovers from delivery failures.";

const PRODUCT_STORY = [
  "Payment webhook",
  "Verify",
  "Normalize",
  "Idempotency",
  "Deterministic processing",
  "Failure / exception",
  "Retry / replay",
  "Audit trail",
  "AI investigation",
  "Operator decision",
] as const;

const ARCHITECTURE = [
  "Provider",
  "Adapter",
  "Ingestion",
  "Domain",
  "Processing",
  "Exceptions",
  "Recovery",
  "Audit",
  "Investigation",
  "Operator",
] as const;

const PRINCIPLES = [
  "Idempotent ingestion",
  "Deterministic state transitions",
  "Provider-agnostic adapters",
  "Append-only audit trail",
  "Safe retries and replay",
  "AI outside the financial decision path",
  "Synthetic test environment",
] as const;

function count(
  persisted: MetricsSummary["persisted"],
  key: "WEBHOOK_DUPLICATE" | "RETRY_SUCCEEDED",
): number {
  return persisted.auditByType[key] ?? 0;
}

function hasPersistedData(persisted: MetricsSummary["persisted"]): boolean {
  return (
    persisted.webhookEvents > 0 ||
    persisted.retries > 0 ||
    persisted.deadLetters > 0 ||
    (persisted.exceptions ?? 0) > 0
  );
}

function OverviewMetrics({ summary }: { readonly summary: MetricsSummary }) {
  if (!hasPersistedData(summary.persisted)) {
    return (
      <section className="empty">
        <h2 className="kicker">NO DATA</h2>
        <p>
          No persisted webhook events, exceptions, retries, or dead letters are
          stored yet. Run the Golden Demo to create labelled synthetic records.
        </p>
      </section>
    );
  }
  const rows = [
    { label: "Events processed", value: summary.persisted.webhookEvents },
    {
      label: "Duplicates detected",
      value: count(summary.persisted, "WEBHOOK_DUPLICATE"),
    },
    { label: "Exceptions", value: summary.persisted.exceptions ?? 0 },
    { label: "Retries", value: summary.persisted.retries },
    {
      label: "Retries succeeded",
      value: count(summary.persisted, "RETRY_SUCCEEDED"),
    },
  ] as const;
  return (
    <dl className="spec">
      {rows.map((row) => (
        <div className="spec__row" key={row.label}>
          <dt>{row.label}</dt>
          <dd className="mono">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Overview() {
  const api = useApi();
  const [summary, setSummary] = useState<MetricsSummary | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .getMetricsSummary()
      .then((loaded) => {
        if (!cancelled) {
          setSummary(loaded);
        }
      })
      .catch((caught: unknown) => {
        if (cancelled) {
          return;
        }
        setError(
          isApiError(caught)
            ? caught
            : new ApiError("REQUEST_FAILED", "", 0, "UNABLE TO LOAD OVERVIEW"),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  if (error !== null) {
    return (
      <ErrorPanel
        title="UNABLE TO LOAD OVERVIEW"
        correlationId={error.correlationId}
        code={error.code}
        next="Retry this page, or continue from Failure Lab or Incidents."
      />
    );
  }

  return (
    <>
      <header className="page-head">
        <h1 className="kicker">OVERVIEW</h1>
        <p>{PRODUCT_SENTENCE}</p>
      </header>
      <section className="section">
        <h2 className="kicker">PRODUCT STORY</h2>
        <ol className="architecture-flow" aria-label="Product story">
          {PRODUCT_STORY.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>
      <section className="section">
        <h2 className="kicker">ARCHITECTURE</h2>
        <ol className="architecture-flow" aria-label="System architecture">
          {ARCHITECTURE.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p>
          Provider payloads stop at the adapter. The domain and processing
          engine do not import HTTP, UI, a database, or the AI investigator.
          Investigation explains stored evidence. It does not change payment
          state.
        </p>
      </section>
      <section className="section">
        <h2 className="kicker">PRINCIPLES</h2>
        <ul className="principles">
          {PRINCIPLES.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      <section className="section">
        <h2 className="kicker">PERSISTED STATE</h2>
        <p>Counts come from stored rows. Missing measurements are not invented.</p>
        {summary === null ? (
          <StatusLine>LOADING OVERVIEW…</StatusLine>
        ) : (
          <OverviewMetrics summary={summary} />
        )}
      </section>
      <section className="section">
        <h2 className="kicker">GOLDEN DEMO</h2>
        <p>
          A synthetic Razorpay-shaped webhook is posted through the real ingest
          pipeline: verify, normalize, persist, fail once, retry, recover,
          incident, timeline, optional AI investigation.
        </p>
        <p>
          <Link href="/demo">RUN GOLDEN DEMO</Link>
        </p>
      </section>
    </>
  );
}
