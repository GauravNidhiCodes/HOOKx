import { useEffect, useState, type FormEvent } from "react";
import { ApiError, isApiError } from "../api/client";
import { useApi } from "../api/context";
import type { PublicAuditEvent, PublicWebhookEvent } from "../api/types";
import { AuditHistory } from "../components/AuditHistory";
import { ErrorPanel, Section, SpecList, StatusLine, SyntheticMark } from "../components/chrome";
import { isSyntheticRef } from "../lib/format";
import { Link, useRouter } from "../routing/router";

function EventRecord({ webhookEventId }: { readonly webhookEventId: string }) {
  const api = useApi();
  const [webhook, setWebhook] = useState<PublicWebhookEvent | null>(null);
  const [audit, setAudit] = useState<readonly PublicAuditEvent[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .getWebhook(webhookEventId)
      .then(async (record) => {
        if (cancelled) {
          return;
        }
        if (record === null) {
          setMissing(true);
          setLoading(false);
          return;
        }
        const rows = await api.listWebhookAudit(webhookEventId);
        if (cancelled) {
          return;
        }
        setWebhook(record);
        setAudit(rows);
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setLoading(false);
          setError(
            isApiError(caught)
              ? caught
              : new ApiError("REQUEST_FAILED", "", 0, "UNABLE TO LOAD EVENT"),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, webhookEventId]);

  if (loading) {
    return <StatusLine>LOADING EVENT…</StatusLine>;
  }
  if (error !== null) {
    return (
      <ErrorPanel
        title="UNABLE TO LOAD EVENT"
        correlationId={error.correlationId}
        code={error.code}
      />
    );
  }
  if (missing || webhook === null) {
    return (
      <section className="empty">
        <h2 className="kicker">EVENT NOT FOUND</h2>
        <p className="mono">{webhookEventId}</p>
      </section>
    );
  }
  return (
    <>
      <SyntheticMark
        show={isSyntheticRef(webhook.provider) || isSyntheticRef(webhook.paymentId)}
      />
      <Section title="EVENT">
        <SpecList
          rows={[
            { label: "Event ID", value: webhook.webhookEventId },
            { label: "Type", value: webhook.eventType },
            { label: "Status", value: webhook.processingStatus },
            {
              label: "Payment ID",
              value: (
                <Link href={`/payments/${encodeURIComponent(webhook.paymentId)}`}>
                  {webhook.paymentId}
                </Link>
              ),
            },
            { label: "occurredAt", value: webhook.occurredAt },
            { label: "receivedAt", value: webhook.receivedAt },
          ]}
        />
      </Section>
      <Section title="AUDIT HISTORY">
        <AuditHistory events={audit} />
      </Section>
    </>
  );
}

export function EventsPage({ webhookEventId }: { readonly webhookEventId: string | null }) {
  const { navigate } = useRouter();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const raw = form.get("webhookEventId");
    const id = typeof raw === "string" ? raw.trim() : "";
    if (id.length === 0) {
      return;
    }
    navigate(`/events/${encodeURIComponent(id)}`);
  }

  return (
    <>
      <header className="page-head">
        <h1 className="kicker">EVENTS</h1>
        <p>Lookup a stored webhook by internal event id. Raw provider payloads are not stored.</p>
      </header>
      <form className="filters" onSubmit={onSubmit} aria-label="Event lookup">
        <label className="filters__search">
          Webhook event ID
          <input
            name="webhookEventId"
            defaultValue={webhookEventId ?? ""}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button type="submit">Load</button>
      </form>
      {webhookEventId === null ? (
        <section className="empty">
          <h2 className="kicker">ENTER A WEBHOOK EVENT ID</h2>
          <p>Events are loaded from persistence by identifier.</p>
        </section>
      ) : (
        <EventRecord key={webhookEventId} webhookEventId={webhookEventId} />
      )}
    </>
  );
}
