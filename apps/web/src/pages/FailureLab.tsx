import { useEffect, useState } from "react";
import { ApiError, isApiError } from "../api/client";
import { useApi } from "../api/context";
import type {
  FailureLabCatalog,
  FailureLabCatalogEntry,
  FailureLabRunReport,
  FailureLabScenarioId,
} from "../api/types";
import { ErrorPanel, StatusLine } from "../components/chrome";
import { blank, formatClock } from "../lib/format";
import { Link, useRouter } from "../routing/router";

const RESET_CONFIRM = "SYNTHETIC_FAILURE_LAB";

function lifecycleLabel(value: string): string {
  return value.replaceAll("_", " ");
}

function originLine(report: FailureLabRunReport): string {
  if (report.labels !== undefined && report.labels.length > 0) {
    return report.labels.join(" · ");
  }
  return "SYNTHETIC";
}

function isArchitectureDemo(scenario: FailureLabCatalogEntry): boolean {
  return scenario.architectureDemo === true || scenario.id === "TRANSIENT_FAILURE";
}

function isGoldenDemo(scenario: FailureLabCatalogEntry): boolean {
  return scenario.goldenDemo === true || scenario.id === "GOLDEN_DEMO";
}

function ScenarioStatus({
  report,
  executing,
}: {
  readonly report: FailureLabRunReport | undefined;
  readonly executing: boolean;
}) {
  if (executing) {
    return <p className="status-line">EXECUTING</p>;
  }
  if (report === undefined) {
    return <p className="status-line">NOT RUN</p>;
  }
  const parts = [
    `${report.result.accepted} accepted`,
    `${report.result.duplicate} duplicate`,
    `${report.result.conflict} conflict`,
    `${report.result.error} error`,
  ];
  return (
    <p className="status-line">
      {parts.join(" · ")} · STATE {blank(report.payment.state)}
    </p>
  );
}

function RunReport({ report }: { readonly report: FailureLabRunReport }) {
  return (
    <section className="lab-report" aria-live="polite" id="lab-result">
      <h2 className="kicker">WHAT ACTUALLY HAPPENED</h2>
      <p className="synthetic-flag" role="note">
        {originLine(report)}
      </p>
      <dl className="spec">
        <div className="spec__row">
          <dt>SCENARIO</dt>
          <dd className="mono">{report.title}</dd>
        </div>
        <div className="spec__row">
          <dt>PROVIDER</dt>
          <dd className="mono">{report.payment.provider ?? "—"}</dd>
        </div>
        <div className="spec__row">
          <dt>DATA SOURCE</dt>
          <dd className="mono">SYNTHETIC</dd>
        </div>
        <div className="spec__row">
          <dt>RUN ID</dt>
          <dd className="mono">{report.runId}</dd>
        </div>
        <div className="spec__row">
          <dt>INPUT</dt>
          <dd className="mono">{report.input.deliveries} webhook deliveries</dd>
        </div>
        <div className="spec__row">
          <dt>RESULT</dt>
          <dd className="mono">
            {report.result.accepted} accepted · {report.result.duplicate}{" "}
            duplicate · {report.result.conflict} conflict · {report.result.error}{" "}
            error
          </dd>
        </div>
        <div className="spec__row">
          <dt>STATE CHANGE</dt>
          <dd className="mono">{report.stateChange}</dd>
        </div>
        <div className="spec__row">
          <dt>EXCEPTION</dt>
          <dd className="mono">
            {report.exception === null ? "none" : report.exception.exceptionCode}
          </dd>
        </div>
        <div className="spec__row">
          <dt>AUDIT</dt>
          <dd className="mono">{report.auditCount} events</dd>
        </div>
        <div className="spec__row">
          <dt>TIMELINE</dt>
          <dd className="mono">{report.log.length > 0 ? "available" : "none"}</dd>
        </div>
        <div className="spec__row">
          <dt>PAYMENT</dt>
          <dd className="mono">
            {blank(report.payment.state)} · {report.payment.paymentId}
          </dd>
        </div>
        {report.retry !== null ? (
          <div className="spec__row">
            <dt>RETRY</dt>
            <dd className="mono">
              attempt {report.retry.attemptCount} / {report.retryPolicy.maxAttempts}{" "}
              · {report.retry.status}
              {report.retry.nextAttemptAt !== null
                ? ` · next ${formatClock(report.retry.nextAttemptAt)}`
                : ""}
              {report.retry.lastErrorCode !== null
                ? ` · ${report.retry.lastErrorCode}`
                : ""}
            </dd>
          </div>
        ) : null}
        {report.deadLetter !== null ? (
          <div className="spec__row">
            <dt>DEAD LETTER</dt>
            <dd className="mono">
              {report.deadLetter.failureCode} · attempts {report.deadLetter.attemptCount}
            </dd>
          </div>
        ) : null}
        {report.replay !== null ? (
          <div className="spec__row">
            <dt>REPLAY</dt>
            <dd className="mono">
              {blank(report.replay.beforeState)} → {blank(report.replay.afterState)}
              {report.replay.delayed ? " · delayed capture" : ""}
            </dd>
          </div>
        ) : null}
        {report.input.eventOrderSent.length > 1 ? (
          <div className="spec__row">
            <dt>EVENT ORDER SENT</dt>
            <dd className="mono">{report.input.eventOrderSent.join(" → ")}</dd>
          </div>
        ) : null}
        {report.input.eventTimeOrder.length > 1 ? (
          <div className="spec__row">
            <dt>EVENT ORDER RECEIVED</dt>
            <dd className="mono">{report.input.eventTimeOrder.join(" → ")}</dd>
          </div>
        ) : null}
      </dl>
      {report.links.incident !== null ? (
        <p className="lab-follow">
          <Link href={report.links.incident}>VIEW INCIDENT</Link>
          <Link href={`${report.links.incident}#timeline`}>VIEW TIMELINE</Link>
          <Link href={`${report.links.incident}#investigation`}>INVESTIGATE</Link>
          {report.links.event !== null ? (
            <Link href={report.links.event}>VIEW EVIDENCE</Link>
          ) : null}
        </p>
      ) : null}
      {report.log.length > 0 ? (
        <div>
          <h3 className="kicker">EXECUTION LOG</h3>
          <ol className="lab-log">
            {report.log.map((entry, index) => (
              <li key={`${entry.clock}-${entry.lifecycle}-${index}`}>
                <span className="mono">{formatClock(entry.clock)}</span>{" "}
                <span>{lifecycleLabel(entry.lifecycle)}</span>
                {entry.decision !== null ? (
                  <span className="mono"> · {entry.decision}</span>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}

function ScenarioBlock({
  scenario,
  report,
  executing,
  disabled,
  onRun,
}: {
  readonly scenario: FailureLabCatalogEntry;
  readonly report: FailureLabRunReport | undefined;
  readonly executing: boolean;
  readonly disabled: boolean;
  readonly onRun: (id: FailureLabScenarioId) => void;
}) {
  const architectureDemo = isArchitectureDemo(scenario);
  const goldenDemo = isGoldenDemo(scenario);
  const demo = architectureDemo || goldenDemo;
  return (
    <article
      className={demo ? "lab-scenario lab-scenario--demo" : "lab-scenario"}
      id={
        architectureDemo
          ? "architecture-demo"
          : goldenDemo
            ? "golden-demo"
            : undefined
      }
    >
      <header className="lab-scenario__head">
        <h2>
          {scenario.number} — {scenario.title}
        </h2>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onRun(scenario.id)}
          aria-label={`Run ${scenario.title}`}
        >
          RUN
        </button>
      </header>
      {architectureDemo ? (
        <p className="synthetic-flag" role="note">
          SYNTHETIC · DEMO RUN
        </p>
      ) : null}
      {goldenDemo ? (
        <p className="synthetic-flag" role="note">
          SYNTHETIC · GOLDEN DEMO · polished view at /demo
        </p>
      ) : null}
      <p>
        <span className="kicker">WHAT WE SIMULATE</span> {scenario.explanation}
      </p>
      <p>
        <span className="kicker">WHAT HOOKX SHOULD DO</span> {scenario.expected}
      </p>
      <ScenarioStatus report={report} executing={executing} />
    </article>
  );
}

export function FailureLab() {
  const api = useApi();
  const { href } = useRouter();
  const [catalog, setCatalog] = useState<FailureLabCatalog | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [runError, setRunError] = useState<ApiError | null>(null);
  const [reports, setReports] = useState<
    Partial<Record<FailureLabScenarioId, FailureLabRunReport>>
  >({});
  const [active, setActive] = useState<FailureLabRunReport | null>(null);
  const [running, setRunning] = useState<FailureLabScenarioId | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetText, setResetText] = useState("");
  const [resetBusy, setResetBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .getFailureLabCatalog()
      .then((loaded) => {
        if (!cancelled) {
          setCatalog(loaded);
        }
      })
      .catch((caught: unknown) => {
        if (cancelled) {
          return;
        }
        setLoadError(
          isApiError(caught)
            ? caught
            : new ApiError("REQUEST_FAILED", "", 0, "UNABLE TO LOAD FAILURE LAB"),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    if (catalog === null) {
      return;
    }
    const hash = href.includes("#") ? href.slice(href.indexOf("#") + 1) : "";
    if (hash === "architecture-demo" || hash === "lab-result") {
      document.getElementById(hash)?.scrollIntoView?.();
    }
  }, [href, catalog, active]);

  async function run(id: FailureLabScenarioId): Promise<void> {
    setRunning(id);
    setRunError(null);
    try {
      const report = await api.runFailureLab(id);
      setReports((current) => ({ ...current, [id]: report }));
      setActive(report);
    } catch (caught: unknown) {
      setRunError(
        isApiError(caught)
          ? caught
          : new ApiError(
              "REQUEST_FAILED",
              "",
              0,
              "UNABLE TO RUN FAILURE LAB SCENARIO",
            ),
      );
    } finally {
      setRunning(null);
    }
  }

  async function confirmReset(): Promise<void> {
    if (resetText !== RESET_CONFIRM) {
      return;
    }
    setResetBusy(true);
    setRunError(null);
    try {
      await api.resetFailureLab(RESET_CONFIRM);
      setReports({});
      setActive(null);
      setResetOpen(false);
      setResetText("");
    } catch (caught: unknown) {
      setRunError(
        isApiError(caught)
          ? caught
          : new ApiError("REQUEST_FAILED", "", 0, "UNABLE TO RESET FAILURE LAB"),
      );
    } finally {
      setResetBusy(false);
    }
  }

  if (loadError !== null) {
    return (
      <ErrorPanel
        title="UNABLE TO LOAD FAILURE LAB"
        correlationId={loadError.correlationId}
        code={loadError.code}
        safety="This page load did not run a scenario. Production payment state is not involved."
        next="Retry this page, or return to Overview."
      />
    );
  }
  if (catalog === null) {
    return <StatusLine>LOADING FAILURE LAB…</StatusLine>;
  }

  return (
    <>
      <header className="page-head">
        <h1 className="kicker">SYNTHETIC FAILURE LAB</h1>
        <p className="synthetic-flag" role="note">
          THIS IS SYNTHETIC. {catalog.notice}
        </p>
        <p>
          Each run posts signed webhooks through ingest, validation, persistence,
          processing, retry, replay, and audit. PROVIDER is the adapter
          (SYNTHETIC or razorpay). DATA SOURCE is always SYNTHETIC. Nothing is
          sent to Razorpay. This page does not report a live connection.
        </p>
        <p>
          Operator path: run a scenario → read what actually happened → open
          the incident → inspect the timeline → investigate → inspect evidence.
        </p>
      </header>
      {catalog.scenarios.map((scenario) => (
        <ScenarioBlock
          key={scenario.id}
          scenario={scenario}
          report={reports[scenario.id]}
          executing={running === scenario.id}
          disabled={running !== null}
          onRun={(id) => {
            void run(id);
          }}
        />
      ))}
      {runError !== null ? (
        <ErrorPanel
          title="UNABLE TO RUN FAILURE LAB SCENARIO"
          correlationId={runError.correlationId}
          code={runError.code}
          safety="This Failure Lab request uses synthetic lab identifiers only. Production payment state is not involved."
          next="Retry the scenario, or continue from Overview or Incidents."
        />
      ) : null}
      {active !== null ? <RunReport report={active} /> : null}
      <section className="lab-reset">
        <h2 className="kicker">RESET LAB</h2>
        <p>
          Deletes only <span className="mono">SYNTHETIC:pay:lab-*</span> rows.
          Simulator and non-synthetic records are not touched.
        </p>
        {resetOpen ? (
          <div className="lab-reset__confirm">
            <label>
              Type {RESET_CONFIRM} to confirm
              <input
                value={resetText}
                onChange={(event) => setResetText(event.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <button
              type="button"
              disabled={resetBusy || resetText !== RESET_CONFIRM}
              onClick={() => {
                void confirmReset();
              }}
            >
              CONFIRM RESET
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setResetOpen(true)}>
            RESET LAB
          </button>
        )}
      </section>
    </>
  );
}
