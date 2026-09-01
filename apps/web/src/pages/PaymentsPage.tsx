import { useEffect, useState, type FormEvent } from "react";
import { ApiError, isApiError } from "../api/client";
import { useApi } from "../api/context";
import type { PublicException, PublicPayment } from "../api/types";
import { ErrorPanel, Section, SpecList, StatusLine, SyntheticMark } from "../components/chrome";
import { isSyntheticRef } from "../lib/format";
import { Link, useRouter } from "../routing/router";

function PaymentRecord({ paymentId }: { readonly paymentId: string }) {
  const api = useApi();
  const [payment, setPayment] = useState<PublicPayment | null>(null);
  const [exceptions, setExceptions] = useState<readonly PublicException[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

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
          return;
        }
        const listed = await api.listExceptions({ q: paymentId });
        if (cancelled) {
          return;
        }
        setPayment(record);
        setExceptions(listed);
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setLoading(false);
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
        <h2 className="kicker">PAYMENT NOT FOUND</h2>
        <p className="mono">{paymentId}</p>
      </section>
    );
  }
  return (
    <>
      <SyntheticMark show={isSyntheticRef(payment.provider) || isSyntheticRef(payment.paymentId)} />
      <Section title="PAYMENT">
        <SpecList
          rows={[
            { label: "Payment ID", value: payment.paymentId },
            { label: "Provider", value: payment.provider },
            { label: "State", value: payment.state },
            { label: "Currency", value: payment.currency },
            { label: "Amount (minor)", value: payment.amountMinor },
          ]}
        />
      </Section>
      <Section title="EXCEPTIONS">
        {exceptions.length === 0 ? (
          <p>No exceptions are stored for this payment.</p>
        ) : (
          <ul className="plain-list">
            {exceptions.map((row) => (
              <li key={row.exceptionId}>
                <Link href={`/exceptions/${encodeURIComponent(row.exceptionId)}`}>
                  {row.exceptionCode}
                </Link>
                <span className="mono"> {row.exceptionId}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

export function PaymentsPage({ paymentId }: { readonly paymentId: string | null }) {
  const { navigate } = useRouter();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const raw = form.get("paymentId");
    const id = typeof raw === "string" ? raw.trim() : "";
    if (id.length === 0) {
      return;
    }
    navigate(`/payments/${encodeURIComponent(id)}`);
  }

  return (
    <>
      <header className="page-head">
        <h1 className="kicker">PAYMENTS</h1>
        <p>Lookup a durable payment projection by identifier. This is not a volume report.</p>
      </header>
      <form className="filters" onSubmit={onSubmit} aria-label="Payment lookup">
        <label className="filters__search">
          Payment ID
          <input
            name="paymentId"
            defaultValue={paymentId ?? ""}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button type="submit">Load</button>
      </form>
      {paymentId === null ? (
        <section className="empty">
          <h2 className="kicker">ENTER A PAYMENT ID</h2>
          <p>Payments are loaded from the API by identifier. No catalog totals are displayed.</p>
        </section>
      ) : (
        <PaymentRecord key={paymentId} paymentId={paymentId} />
      )}
    </>
  );
}
