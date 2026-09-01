import { useCallback, useEffect, useState } from "react";
import { ApiError, isApiError } from "../api/client";
import { useApi } from "../api/context";
import type { GoldenDemoRun, PublicInvestigation } from "../api/types";
import { ErrorPanel, StatusLine } from "../components/chrome";
import { InvestigationPanel } from "../components/InvestigationPanel";
import { formatClock } from "../lib/format";
import {
  AI_GENERATED_INVESTIGATION,
  AI_NO_FINANCIAL_STATE_CHANGES,
  AI_READONLY,
} from "../lib/operator-catalog";
import {
  deriveDemoSteps,
  failureClassification,
  retryExhausted,
  unexpectedDemoOutcome,
} from "../lib/demo-lifecycle";
import { Link } from "../routing/router";

const EXPLANATION =
  "Observe how HOOKX handles a webhook failure without allowing the financial state to become inconsistent.";

function RetryAttempts({ demo }: { readonly demo: GoldenDemoRun }) {
  const report = demo.run;
  const exhausted = retryExhausted(report);
  const attempt1 =
    report.retry !== null &&
    report.retry.attemptCount >= 1 &&
    (report.result.error >= 1 || report.retry.lastErrorCode !== null);
  const attempt2Recovered =
    !exhausted &&
    report.retry !== null &&
    report.retry.status === "SUCCEEDED" &&
    report.retry.attemptCount >= 2;
  const recoveredAt = report.log.find(
    (entry) => entry.lifecycle === "RETRY_SUCCEEDED",
  );
  if (!attempt1 && !attempt2Recovered && !exhausted) {
    return null;
  }
  return (
    <section className="section">
      <h2 className="kicker">RETRY</h2>
      <ul className="plain-list">
        {attempt1 ? (
          <li>
            ATTEMPT 1 FAILED
            {report.retry?.lastFailedAt !== null &&
            report.retry?.lastFailedAt !== undefined ? (
              <span className="mono">
                {" "}
                {formatClock(report.retry.lastFailedAt)}
              </span>
            ) : null}
          </li>
        ) : null}
        {attempt2Recovered ? (
          <li>
            ATTEMPT 2 RECOVERED
            {recoveredAt !== undefined ? (
              <span className="mono"> {formatClock(recoveredAt.clock)}</span>
            ) : null}
          </li>
        ) : null}
        {exhausted ? (
          <li>
            RETRY EXHAUSTED
            {report.deadLetter !== null ? (
              <span className="mono">
                {" "}
                {formatClock(report.deadLetter.deadLetteredAt)}
              </span>
            ) : null}
          </li>
        ) : null}
      </ul>
    </section>
  );
}

function Recovery({ demo }: { readonly demo: GoldenDemoRun }) {
  const report = demo.run;
  const exhausted = retryExhausted(report);
  if (exhausted) {
    return (
      <section className="section">
        <h2 className="kicker">RECOVERY</h2>
        <p>RETRY EXHAUSTED. Processing did not recover.</p>
        <p className="mono">
          EVENT {report.eventType ?? "—"} {report.eventProcessingStatus ?? "—"}
        </p>
        <p className="mono">PAYMENT {report.payment.state ?? "none"}</p>
      </section>
    );
  }
  if (report.retry?.status !== "SUCCEEDED") {
    return null;
  }
  return (
    <section className="section">
      <h2 className="kicker">RECOVERY</h2>
      <p className="mono">
        EVENT {report.eventType ?? "—"} {report.eventProcessingStatus ?? "—"}
      </p>
      <p className="mono">PAYMENT {report.payment.state ?? "none"}</p>
      {report.payment.state === null && report.eventType === "payment.authorized" ? (
        <p>
          HOOKX does not invent payment.created. A Razorpay-only authorized
          stream does not project a payment row.
        </p>
      ) : null}
    </section>
  );
}

export function Demo() {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState<GoldenDemoRun | null>(null);
  const [history, setHistory] = useState<readonly GoldenDemoRun[]>([]);
  const [investigation, setInvestigation] = useState<PublicInvestigation | null>(
    null,
  );
  const [error, setError] = useState<ApiError | null>(null);
  const [investigateError, setInvestigateError] = useState<ApiError | null>(
    null,
  );

  const loadHistory = useCallback(() => {
    void api.listGoldenDemoRuns().then(setHistory).catch(() => {
      setHistory([]);
    });
  }, [api]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  async function runDemo(): Promise<void> {
    setBusy(true);
    setError(null);
    setInvestigateError(null);
    setInvestigation(null);
    setDemo(null);
    try {
      const next = await api.runGoldenDemo();
      setDemo(next);
      loadHistory();
    } catch (caught: unknown) {
      setError(
        isApiError(caught)
          ? caught
          : new ApiError("DEMO_FAILED", "", 0, "DEMO FAILED"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function investigate(): Promise<void> {
    if (demo?.run.incidentId === null || demo?.run.incidentId === undefined) {
      return;
    }
    setInvestigateError(null);
    try {
      const result = await api.investigateIncident(demo.run.incidentId);
      setInvestigation(result);
    } catch (caught: unknown) {
      setInvestigateError(
        isApiError(caught)
          ? caught
          : new ApiError(
              "INVESTIGATION_FAILED",
              "",
              0,
              "INVESTIGATION REQUEST FAILED",
            ),
      );
    }
  }

  const unexpected =
    demo !== null && unexpectedDemoOutcome(demo.run) ? true : false;
  const steps = deriveDemoSteps(demo?.run ?? null, investigation !== null);
  const failure = demo !== null ? failureClassification(demo.run) : null;
  const incidentHref = demo?.run.links.incident ?? null;
  const eventHref = demo?.run.links.event ?? null;

  return (
    <>
      <header className="page-head">
        <h1 className="kicker">HOOKX</h1>
        <p className="kicker">PAYMENT WEBHOOK RELIABILITY ENGINE</p>
        <p className="synthetic-flag" role="note">
          SYNTHETIC DEMONSTRATION
        </p>
        <p>{EXPLANATION}</p>
      </header>

      <ol className="demo-lifecycle" aria-label="Demo lifecycle">
        {steps.map((step) => (
          <li
            key={step.id}
            className={
              step.complete ? "demo-lifecycle__step demo-lifecycle__step--done" : "demo-lifecycle__step"
            }
            aria-current={
              !step.complete &&
              steps.find((row) => !row.complete)?.id === step.id
                ? "step"
                : undefined
            }
          >
            <span className="mono">
              {step.number} {step.id}
            </span>
            <span className="mono">{step.complete ? "DONE" : "—"}</span>
          </li>
        ))}
      </ol>

      <div className="lab-follow">
        <button type="button" onClick={() => void runDemo()} disabled={busy}>
          RUN DEMO
        </button>
        <button
          type="button"
          onClick={() => void runDemo()}
          disabled={busy || demo === null}
        >
          NEW DEMO RUN
        </button>
      </div>

      <div aria-live="polite" aria-atomic="true">
        {busy ? <StatusLine>EXECUTING SYNTHETIC DEMO…</StatusLine> : null}
        {!busy && demo !== null && !unexpected ? (
          <StatusLine>DEMO RUN COMPLETE</StatusLine>
        ) : null}
      </div>

      {error !== null ? (
        <ErrorPanel
          title="DEMO FAILED"
          code={error.code}
          correlationId={error.correlationId}
          next="Retry RUN DEMO. Previous synthetic runs are left in place."
        />
      ) : null}

      {unexpected && demo !== null ? (
        <ErrorPanel
          title="DEMO FAILED"
          code="UNEXPECTED_DEMO_OUTCOME"
          correlationId={demo.correlationId}
          next="The fail-once injection did not record a processing error. Inspect the technical details."
        />
      ) : null}

      {demo !== null && !unexpected ? (
        <>
          {failure !== null ? (
            <section className="section">
              <h2 className="kicker">{failure.heading}</h2>
              <p className="mono">{failure.code}</p>
              {failure.failureClass !== null ? (
                <p className="mono">{failure.failureClass}</p>
              ) : null}
            </section>
          ) : null}

          <RetryAttempts demo={demo} />
          <Recovery demo={demo} />

          {demo.invariant.noDuplicateEconomicEffect ? (
            <section className="section">
              <h2 className="kicker">SAFETY</h2>
              <p className="synthetic-flag" role="status">
                NO DUPLICATE ECONOMIC EFFECT
              </p>
              <p className="mono">
                STORED EVENTS {demo.invariant.storedEventCount} · STATE CHANGES{" "}
                {demo.invariant.stateChange} · DUPLICATE DELIVERIES{" "}
                {demo.invariant.duplicateDeliveries}
              </p>
            </section>
          ) : null}

          {demo.run.auditCount > 0 ? (
            <section className="section">
              <h2 className="kicker">AUDIT</h2>
              <p>AUDIT TRAIL AVAILABLE</p>
              <p className="mono">{demo.run.auditCount} entries</p>
              <p className="lab-follow">
                {incidentHref !== null ? (
                  <Link href={incidentHref}>VIEW INCIDENT</Link>
                ) : null}
                {incidentHref !== null ? (
                  <Link href={`${incidentHref}#timeline`}>VIEW TIMELINE</Link>
                ) : null}
                {eventHref !== null ? (
                  <Link href={eventHref}>VIEW EVENT</Link>
                ) : null}
              </p>
            </section>
          ) : null}

          {demo.run.log.length > 0 ? (
            <section className="section">
              <h2 className="kicker">TIMELINE</h2>
              <ol className="incident-timeline">
                {demo.run.log.map((entry, index) => (
                  <li
                    className="incident-timeline__item"
                    key={`${entry.lifecycle}-${entry.clock}-${String(index)}`}
                  >
                    <span className="incident-timeline__label">
                      {entry.lifecycle.replaceAll("_", " ")}
                    </span>
                    <span className="incident-timeline__times mono">
                      {formatClock(entry.clock)}
                      {entry.decision !== null ? ` · ${entry.decision}` : ""}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {demo.run.incidentId !== null ? (
            <section className="section">
              <h2 className="kicker">INVESTIGATE</h2>
              <p className="advisory">
                {AI_GENERATED_INVESTIGATION} · {AI_READONLY} ·{" "}
                {AI_NO_FINANCIAL_STATE_CHANGES}
              </p>
              <p>
                Recovery happened through deterministic retry. Investigation
                explains stored evidence. It does not cause recovery.
              </p>
              <button
                type="button"
                onClick={() => void investigate()}
                disabled={busy}
              >
                INVESTIGATE INCIDENT
              </button>
              {investigateError !== null ? (
                <ErrorPanel
                  title="INVESTIGATION REQUEST FAILED"
                  code={investigateError.code}
                  correlationId={investigateError.correlationId}
                />
              ) : null}
              {investigation !== null ? (
                <InvestigationPanel investigation={investigation} />
              ) : null}
            </section>
          ) : null}

          <details className="payload">
            <summary>TECHNICAL DETAILS</summary>
            <dl className="spec">
              <div className="spec__row">
                <dt>DEMO RUN ID</dt>
                <dd className="mono">{demo.demoRunId}</dd>
              </div>
              <div className="spec__row">
                <dt>CORRELATION ID</dt>
                <dd className="mono">{demo.correlationId}</dd>
              </div>
              <div className="spec__row">
                <dt>PROVIDER</dt>
                <dd className="mono">{demo.run.payment.provider ?? "—"}</dd>
              </div>
              <div className="spec__row">
                <dt>EVENT ID</dt>
                <dd className="mono">
                  {demo.run.deliveries[0]?.eventKey ?? "—"}
                </dd>
              </div>
              <div className="spec__row">
                <dt>PAYMENT ID</dt>
                <dd className="mono">{demo.run.payment.paymentId}</dd>
              </div>
              <div className="spec__row">
                <dt>STARTED</dt>
                <dd className="mono">{demo.run.startedAt}</dd>
              </div>
              <div className="spec__row">
                <dt>FINISHED</dt>
                <dd className="mono">{demo.run.finishedAt}</dd>
              </div>
              <div className="spec__row">
                <dt>ATTEMPTS</dt>
                <dd className="mono">
                  {demo.run.retry?.attemptCount ?? 0} /{" "}
                  {demo.run.retryPolicy.maxAttempts} ·{" "}
                  {demo.run.retry?.status ?? "—"}
                </dd>
              </div>
            </dl>
          </details>
        </>
      ) : null}

      {history.length > 0 ? (
        <section className="section">
          <h2 className="kicker">RECENT SYNTHETIC RUNS</h2>
          <ul className="plain-list">
            {history.map((row) => (
              <li key={row.demoRunId} className="mono">
                {row.demoRunId} · {row.correlationId}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
