import type { InvestigationEvidence, PublicInvestigation } from "../api/types";
import {
  ADVISORY_AUTHORITATIVE,
  AI_GENERATED_ANALYSIS,
  INVESTIGATION_UNAVAILABLE,
} from "../lib/operator-catalog";
import { Link } from "../routing/router";

function evidenceHref(item: InvestigationEvidence): string | null {
  if (item.sourceType === "EXCEPTION") {
    return `/exceptions/${encodeURIComponent(item.sourceId)}`;
  }
  if (item.sourceType === "INCIDENT") {
    return `/incidents/${encodeURIComponent(item.sourceId)}`;
  }
  if (
    item.sourceType === "WEBHOOK_EVENT" ||
    item.sourceType === "RETRY_ATTEMPT" ||
    item.sourceType === "STATE_TRANSITION"
  ) {
    return `/events/${encodeURIComponent(item.sourceId)}`;
  }
  return null;
}

export function InvestigationPanel({
  investigation,
}: {
  readonly investigation: PublicInvestigation;
}) {
  const unavailable = investigation.investigator === "unavailable";
  const actions =
    investigation.result.recommendedActions ??
    [investigation.result.recommendedAction];
  return (
    <div className="investigation">
      <p className="advisory">{ADVISORY_AUTHORITATIVE}</p>
      <p className="advisory">{AI_GENERATED_ANALYSIS}</p>
      {unavailable ? (
        <p className="advisory">{INVESTIGATION_UNAVAILABLE} — NO PAYMENT STATE CHANGED</p>
      ) : (
        <p className="advisory">AI INVESTIGATION — DOES NOT MUTATE PAYMENT STATE</p>
      )}
      <h3 className="kicker">AI INVESTIGATION</h3>
      <p className="mono investigation__meta">
        {investigation.investigationId}
        {investigation.createdAt ? ` · ${investigation.createdAt}` : ""}
        {investigation.investigator ? ` · ${investigation.investigator}` : ""}
        {investigation.result.incidentType
          ? ` · ${investigation.result.incidentType}`
          : ""}
      </p>
      <h3 className="kicker">SUMMARY</h3>
      <p>{investigation.result.summary}</p>
      {investigation.result.facts !== undefined &&
      investigation.result.facts.length > 0 ? (
        <ul className="plain-list">
          {investigation.result.facts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      ) : null}
      <h3 className="kicker">ROOT CAUSE</h3>
      <p className="mono">{investigation.result.incidentType ?? "UNKNOWN"}</p>
      <p>{investigation.result.rootCause ?? investigation.result.likelyCause}</p>
      <h3 className="kicker">EVIDENCE</h3>
      <p className="kicker">SUPPORTED BY</p>
      <ul className="evidence">
        {investigation.result.evidence.map((item) => {
          const href = evidenceHref(item);
          return (
            <li key={`${item.sourceType}-${item.sourceId}-${item.fact}`}>
              <span className="mono">
                {item.sourceType}{" "}
                {href === null ? (
                  item.sourceId
                ) : (
                  <Link href={href}>{item.sourceId}</Link>
                )}
              </span>
              <p className="evidence__support">{item.fact}</p>
            </li>
          );
        })}
      </ul>
      {investigation.result.impact !== undefined ? (
        <>
          <h3 className="kicker">IMPACT</h3>
          <p>{investigation.result.impact}</p>
        </>
      ) : null}
      <h3 className="kicker">RECOMMENDED ACTIONS</h3>
      {actions.map((action) => (
        <div key={`${action.code}-${action.detail}`}>
          <p className="mono">{action.code}</p>
          <p>{action.detail}</p>
        </div>
      ))}
      <p className="advisory">NOT EXECUTABLE</p>
      <h3 className="kicker">CONFIDENCE</h3>
      <p className="mono">{investigation.result.confidence}</p>
      {investigation.result.confidenceReason !== undefined ? (
        <p>{investigation.result.confidenceReason}</p>
      ) : null}
      <p>Confidence in the explanation, not financial certainty.</p>
      <h3 className="kicker">LIMITATIONS</h3>
      <ul>
        {investigation.result.limitations.map((row) => (
          <li key={row}>{row}</li>
        ))}
      </ul>
    </div>
  );
}
