import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ApiError, isApiError } from "../api/client";
import { useApi } from "../api/context";
import type { PublicPaymentListItem } from "../api/types";
import { ErrorPanel, StatusLine } from "../components/chrome";
import { formatClock, isSyntheticRef } from "../lib/format";
import { Link, useRouter } from "../routing/router";

function queryFromSearch(search: string): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return params.get("q")?.trim() ?? "";
}

function PaymentIndexResults({ q }: { readonly q: string }) {
  const api = useApi();
  const [rows, setRows] = useState<readonly PublicPaymentListItem[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .listPayments(q.length > 0 ? { q } : {})
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
            : new ApiError("REQUEST_FAILED", "", 0, "UNABLE TO LOAD PAYMENT"),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [api, q]);

  if (error !== null) {
    return (
      <ErrorPanel
        title="UNABLE TO LOAD PAYMENT"
        correlationId={error.correlationId}
        code={error.code}
      />
    );
  }
  if (rows === null) {
    return <StatusLine>LOADING PAYMENTS…</StatusLine>;
  }
  if (rows.length === 0) {
    return (
      <section className="empty">
        <h2 className="kicker">NO PAYMENTS MATCH</h2>
        <p>No persisted payments match the current search.</p>
      </section>
    );
  }
  return (
    <div className="table-wrap">
      <table className="queue">
        <caption className="visually-hidden">Payments</caption>
        <thead>
          <tr>
            <th scope="col">Payment ID</th>
            <th scope="col">Provider</th>
            <th scope="col">State</th>
            <th scope="col">Created</th>
            <th scope="col">Updated</th>
            <th scope="col">Exceptions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.provider}:${row.paymentId}`}>
              <th scope="row">
                <Link
                  href={`/payments/${encodeURIComponent(row.paymentId)}`}
                  className="queue-link"
                >
                  {row.paymentId}
                </Link>
                {isSyntheticRef(row.provider) || isSyntheticRef(row.paymentId) ? (
                  <span className="inline-flag">SYNTHETIC</span>
                ) : null}
              </th>
              <td className="mono">{row.provider}</td>
              <td>{row.state}</td>
              <td className="mono" title={row.createdAt}>
                {formatClock(row.createdAt)}
              </td>
              <td className="mono" title={row.updatedAt}>
                {formatClock(row.updatedAt)}
              </td>
              <td className="mono">{String(row.exceptionCount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PaymentsPage() {
  const { route, navigate } = useRouter();
  const search = route.name === "payments" ? route.search : "";
  const q = useMemo(() => queryFromSearch(search), [search]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const raw = form.get("q");
    const next = typeof raw === "string" ? raw.trim() : "";
    navigate(next.length === 0 ? "/payments" : `/payments?q=${encodeURIComponent(next)}`);
  }

  return (
    <>
      <header className="page-head">
        <h1 className="kicker">PAYMENTS</h1>
        <p>Persisted payment projections. This is not a volume report.</p>
      </header>
      <form className="filters" onSubmit={onSubmit} aria-label="Payment search">
        <label className="filters__search">
          Payment ID
          <input
            name="q"
            defaultValue={q}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button type="submit">Apply</button>
      </form>
      <PaymentIndexResults key={`results:${search || "all"}`} q={q} />
    </>
  );
}
