import type { InvestigationEvidence, PublicInvestigation } from "../api/types";
import { ADVISORY_AUTHORITATIVE } from "../lib/operator-catalog";
import { Link } from "../routing/router";

function evidenceHref(item: InvestigationEvidence): string | null {
  if (item.sourceType === "EXCEPTION") {
    return `/exceptions/${encodeURIComponent(item.sourceId)}`;
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
  const advisory = investigation.investigator === "unavailable";
  return (
    <div className="investigation">
      <p className="advisory">{ADVISORY_AUTHORITATIVE}</p>
      {advisory ? (
        <p className="advisory">INVESTIGATION UNAVAILABLE — NO PAYMENT STATE CHANGED</p>
      ) : (
        <p className="advisory">AI INVESTIGATION — DOES NOT MUTATE PAYMENT STATE</p>
      )}
      <h3 className="kicker">SUMMARY</h3>
      <p>{investigation.result.summary}</p>
      <h3 className="kicker">EVIDENCE</h3>
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
              <p>{item.fact}</p>
            </li>
          );
        })}
      </ul>
      <h3 className="kicker">LIKELY CAUSE</h3>
      <p>{investigation.result.likelyCause}</p>
      <h3 className="kicker">RECOMMENDED ACTION</h3>
      <p className="mono">{investigation.result.recommendedAction.code}</p>
      <p>{investigation.result.recommendedAction.detail}</p>
      <p className="advisory">NOT EXECUTABLE</p>
      <h3 className="kicker">CONFIDENCE</h3>
      <p className="mono">{investigation.result.confidence}</p>
      <p>Confidence in the explanation, not that money is safe.</p>
      <h3 className="kicker">LIMITATIONS</h3>
      <ul>
        {investigation.result.limitations.map((row) => (
          <li key={row}>{row}</li>
        ))}
      </ul>
    </div>
  );
}
